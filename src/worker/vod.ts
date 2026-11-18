import { readdir } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { enqueue, PermanentError } from "@/lib/jobs";
import { parseSettings } from "@/lib/settings";
import { clipDir, clipFile, ensureDir, recordingDir, removeDir } from "@/lib/storage";
import { detectOffline, snapToQuiet, type FeatureRow } from "./analysis/detector";
import { analyzeMedia } from "./analysis/features";
import { keyframeAtOrBefore, probe } from "./analysis/probe";
import { log, run, runOk } from "./proc";
import { CUT_PAD_SEC, detectorOptionsFor, fmt } from "./recorder";

const MAX_VOD_HOURS = Number(process.env.MAX_VOD_HOURS ?? 6);
/**
 * Au-dessous de cette durée, la vidéo importée est déjà un clip (clip Twitch/Kick, Short, TikTok) :
 * on la monte telle quelle au format vertical, sans chercher de moments forts.
 */
export const SHORT_VIDEO_MAX_SEC = Number(process.env.SHORT_VIDEO_MAX_SEC ?? 150);

/** Vrai si la vidéo doit être traitée comme un clip déjà prêt (et non comme un replay à analyser). */
export function isShortVideo(durationSec: number | null | undefined, options: { startSec?: number; endSec?: number }): boolean {
  if (options.startSec || options.endSec) return false; // plage demandée : l'utilisateur veut une analyse
  return !!durationSec && durationSec > 0 && durationSec <= SHORT_VIDEO_MAX_SEC;
}

interface VodOptions {
  startSec?: number;
  endSec?: number;
  maxClips?: number;
}

interface YtdlpInfo {
  title?: string;
  duration?: number;
  uploader?: string;
  channel?: string;
  is_live?: boolean;
  categories?: string[];
  extractor_key?: string;
  uploader_id?: string;
}

/** Nom crédité sur le clip pour une vidéo importée (sans chaîne suivie associée). */
export function authorFromInfo(info: YtdlpInfo): string | null {
  const key = (info.extractor_key ?? "").toLowerCase();
  // TikTok : « uploader » est le @pseudo, plus utile en crédit que le surnom affiché.
  if (key.startsWith("tiktok") && info.uploader) return `tiktok.com/@${info.uploader.replace(/^@/, "")}`;
  return info.channel ?? info.uploader ?? null;
}

function ytdlpFailure(stderr: string): string {
  const line = stderr.split("\n").filter((l) => l.includes("ERROR")).pop() ?? stderr.trim().split("\n").pop() ?? "";
  return line.replace(/^ERROR:\s*/, "").slice(0, 400) || "yt-dlp n'a rien renvoyé";
}

/** Importe une VOD (ou n'importe quelle vidéo lisible par yt-dlp) et en extrait les meilleurs moments. */
export async function importVod(recordingId: string): Promise<void> {
  const recording = await db.recording.findUnique({ where: { id: recordingId }, include: { user: { select: { settings: true } } } });
  if (!recording) throw new PermanentError("Import supprimé");
  const settings = parseSettings(recording.user.settings);
  const options = (recording.options ?? {}) as VodOptions;
  const dir = recordingDir(recordingId);
  const setProgress = (progress: number) =>
    db.recording.update({ where: { id: recordingId }, data: { progress } }).catch(() => {});

  try {
    await removeDir(dir); // repart propre si c'est une nouvelle tentative
    await ensureDir(dir);
    await db.recording.update({ where: { id: recordingId }, data: { status: "PROCESSING", progress: 0.02, error: null } });

    // 1. Métadonnées
    const meta = await run(
      env.bin.ytdlp,
      [...env.worker.ytdlpArgs, "--dump-single-json", "--no-playlist", "--no-warnings", recording.sourceUrl],
      { timeoutMs: 120_000, maxBuffer: 32 * 1024 * 1024 },
    );
    if (meta.code !== 0) throw new PermanentError(`Vidéo inaccessible : ${ytdlpFailure(meta.stderr)}`);
    const info = JSON.parse(meta.stdout) as YtdlpInfo;
    if (info.is_live) throw new PermanentError("C'est un live en cours : ajoute plutôt la chaîne dans « Streamers » pour le capter en direct.");

    const from = Math.max(0, options.startSec ?? 0);
    const to = options.endSec && options.endSec > from ? options.endSec : (info.duration ?? 0);
    const span = to > from ? to - from : (info.duration ?? 0);
    if (span > MAX_VOD_HOURS * 3600) {
      throw new PermanentError(
        `Vidéo trop longue (${fmt(span)}). Limite : ${MAX_VOD_HOURS} h par import — indique une plage de début/fin pour la traiter par morceaux.`,
      );
    }
    await db.recording.update({
      where: { id: recordingId },
      data: { title: info.title?.slice(0, 300) ?? null, author: authorFromInfo(info), category: info.categories?.[0] ?? null },
    });
    const short = isShortVideo(info.duration, options);

    // 2. Téléchargement (1080p max : inutile de prendre plus pour une sortie 1080×1920)
    const dlArgs = [
      ...env.worker.ytdlpArgs,
      "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
      "--merge-output-format", "mp4",
      "--no-playlist", "--no-warnings", "--newline", "--no-part",
      "-o", path.join(dir, "vod.%(ext)s"),
    ];
    if (options.startSec || options.endSec) {
      dlArgs.push("--download-sections", `*${from}-${options.endSec && options.endSec > from ? options.endSec : "inf"}`);
    }
    let lastPct = 0;
    const dl = await run(env.bin.ytdlp, [...dlArgs, recording.sourceUrl], {
      timeoutMs: 6 * 3600_000,
      onStdoutLine: (line) => {
        const m = /\[download\]\s+([\d.]+)%/.exec(line);
        if (m) {
          const pct = Number(m[1]);
          if (pct - lastPct >= 5) {
            lastPct = pct;
            void setProgress(0.02 + (pct / 100) * 0.5);
          }
        }
      },
    });
    if (dl.code !== 0) throw new Error(`Téléchargement impossible : ${ytdlpFailure(dl.stderr)}`);
    const file = (await readdir(dir)).find((n) => n.startsWith("vod."));
    if (!file) throw new Error("Téléchargement terminé mais fichier introuvable");
    const vod = path.join(dir, file);
    await setProgress(0.55);

    if (short) {
      await importAsClip(recording.id, recording.userId, recording.streamerId, vod, settings);
      return;
    }

    // 3. Analyse complète puis sélection des meilleurs moments
    const features = await analyzeMedia(vod);
    await setProgress(0.8);
    const rows: FeatureRow[] = features.audioPerSec.map((audio, s) => ({ audio, scene: features.scenePerSec[s] ?? null, chat: null }));
    const limit = options.maxClips ?? Math.max(3, Math.ceil((features.duration / 3600) * settings.maxClipsPerHour));
    const highlights = detectOffline(rows, detectorOptionsFor(settings, false), limit);
    log("vod", `${recording.sourceUrl} : ${fmt(features.duration)} analysés, ${highlights.length} moment(s) retenu(s)`);

    // 4. Découpe des sources (sans réencodage, calée sur une image clé)
    let made = 0;
    for (const h of highlights) {
      const start = Math.max(0, snapToQuiet(features.loudness, h.start));
      const end = Math.min(features.duration, Math.max(snapToQuiet(features.loudness, h.end, { before: 1, after: 1.5 }), start + 5));
      const wantFrom = Math.max(0, start - CUT_PAD_SEC);
      const cutTo = Math.min(features.duration, end + CUT_PAD_SEC);
      const origin = (await keyframeAtOrBefore(vod, wantFrom).catch(() => null)) ?? wantFrom;

      const clip = await db.clip.create({
        data: {
          userId: recording.userId,
          recordingId,
          streamerId: recording.streamerId,
          status: "PROCESSING",
          template: settings.template === "FACECAM" ? "BLUR" : settings.template,
          originSec: origin + from,
          peakSec: h.peak + 0.5 - origin,
          startSec: start - origin,
          endSec: end - origin,
          sourceDur: cutTo - origin,
          score: h.score,
          signals: { ...h.parts, detector: h.score, raw: h.raw },
          captions: settings.captions,
        },
      });
      try {
        await ensureDir(clipDir(clip.id));
        await runOk(
          env.bin.ffmpeg,
          ["-hide_banner", "-loglevel", "error", "-y",
            // +10 ms : on vise juste après l'image clé pour que ffmpeg parte bien de celle-ci et pas de la précédente.
            "-ss", (origin + 0.01).toFixed(3), "-i", vod, "-t", (cutTo - origin).toFixed(3),
            "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart",
            clipFile(clip.id, "source")],
          { timeoutMs: 300_000 },
        );
        await enqueue("clip.process", { clipId: clip.id });
        made++;
      } catch (err) {
        await db.clip.delete({ where: { id: clip.id } }).catch(() => {});
        await removeDir(clipDir(clip.id));
        log("vod", `découpe impossible à ${fmt(h.peak)} : ${err instanceof Error ? err.message : err}`);
      }
    }

    await db.recording.update({
      where: { id: recordingId },
      data: {
        status: "DONE",
        progress: 1,
        endedAt: new Date(),
        durationSec: features.duration,
        error: made === 0 ? "Aucun moment fort détecté. Essaie une sensibilité plus élevée dans les réglages." : null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.recording.update({ where: { id: recordingId }, data: { error: message.slice(0, 1000) } }).catch(() => {});
    throw err;
  } finally {
    await removeDir(dir);
  }
}

/**
 * Vidéo courte (clip existant) : elle devient directement un clip, de la première à la dernière seconde,
 * envoyé au montage vertical (sous-titres, titre, crédit) comme n'importe quel moment fort.
 */
async function importAsClip(
  recordingId: string,
  userId: string,
  streamerId: string | null,
  vod: string,
  settings: ReturnType<typeof parseSettings>,
): Promise<void> {
  const info = await probe(vod);
  if (!info.hasVideo || info.duration < 1) throw new PermanentError("La vidéo téléchargée est vide ou illisible.");
  if (info.duration < 5) throw new PermanentError("Vidéo trop courte (moins de 5 secondes) pour en faire un clip.");
  const dur = Math.min(info.duration, 180); // limite des formats courts
  // Vidéo déjà verticale : pas de fond flouté, elle remplit l'écran telle quelle.
  const portrait = info.height > info.width;
  const template = portrait ? "FULL" : settings.template === "FACECAM" ? "BLUR" : settings.template;
  const clip = await db.clip.create({
    data: {
      userId,
      recordingId,
      streamerId,
      status: "PROCESSING",
      template,
      originSec: 0,
      peakSec: dur / 2,
      startSec: 0,
      endSec: dur,
      sourceDur: info.duration,
      score: 0,
      signals: { imported: true },
      captions: settings.captions,
    },
  });
  try {
    await ensureDir(clipDir(clip.id));
    await runOk(
      env.bin.ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-y", "-i", vod,
        "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", clipFile(clip.id, "source")],
      { timeoutMs: 300_000 },
    );
  } catch (err) {
    await db.clip.delete({ where: { id: clip.id } }).catch(() => {});
    await removeDir(clipDir(clip.id));
    throw err;
  }
  await enqueue("clip.process", { clipId: clip.id });
  await db.recording.update({
    where: { id: recordingId },
    data: { status: "DONE", progress: 1, endedAt: new Date(), durationSec: info.duration, error: null, options: { kind: "clip" } },
  });
  log("vod", `clip importé tel quel (${fmt(info.duration)}) → ${clip.id}`);
}

/** Appelé quand l'import a définitivement échoué (plus de nouvelle tentative). */
export async function markVodFailed(recordingId: string, message: string): Promise<void> {
  await db.recording
    .update({ where: { id: recordingId }, data: { status: "FAILED", endedAt: new Date(), error: message.slice(0, 1000) } })
    .catch(() => {});
}
