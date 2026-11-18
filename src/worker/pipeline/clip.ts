import { rename, writeFile } from "node:fs/promises";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PermanentError } from "@/lib/jobs";
import { parseSettings } from "@/lib/settings";
import { creditLabel } from "@/lib/sources";
import { CLIP_FILES, clipDir, clipFile, fileSize } from "@/lib/storage";
import { fallbackMetadata, generateMetadata, type MetadataContext } from "../ai";
import { probe } from "../analysis/probe";
import { log } from "../proc";
import { buildAss, layoutFor, OUT_H, type Word } from "../render/captions";
import { blurBandHeight, makeThumbnail, renderVertical, validFacecam } from "../render/render";
import { transcribe, wordsToText } from "../transcribe";

function asWords(json: Prisma.JsonValue | null): Word[] {
  if (!Array.isArray(json)) return [];
  const out: Word[] = [];
  for (const item of json) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const { w, s, e } = item as Record<string, unknown>;
      if (typeof w === "string" && typeof s === "number" && typeof e === "number") out.push({ w, s, e });
    }
  }
  return out;
}

/**
 * Traitement complet d'un clip fraîchement découpé :
 * transcription → titre/accroche/hashtags → montage vertical → miniature.
 */
export async function processClip(clipId: string): Promise<void> {
  const clip = await db.clip.findUnique({
    where: { id: clipId },
    include: { streamer: true, recording: true, user: { select: { settings: true } } },
  });
  if (!clip) throw new PermanentError(`Clip ${clipId} introuvable (supprimé ?)`);
  const settings = parseSettings(clip.user.settings);
  const source = clipFile(clipId, "source");
  if ((await fileSize(source)) === null) throw new PermanentError("Le fichier source du clip a disparu");

  try {
    // 1. Sous-titres : on transcrit tout le fichier source (marges comprises) pour pouvoir re-découper ensuite.
    let words = asWords(clip.transcript);
    if (clip.transcript === null && settings.captions) {
      const result = await transcribe(source, settings.language);
      if (result) {
        words = result;
        await db.clip.update({ where: { id: clipId }, data: { transcript: result as unknown as Prisma.InputJsonValue } });
      }
    }

    // 2. Titre, accroche, hashtags, note de potentiel.
    if (!clip.title) {
      const signals = (clip.signals ?? {}) as { audio?: number; chat?: number | null; scene?: number | null; detector?: number };
      const ctx: MetadataContext = {
        streamer: clip.streamer?.displayName ?? clip.recording?.author ?? "",
        platform: clip.streamer?.platform ?? "OTHER",
        game: clip.recording?.category ?? clip.streamer?.liveCategory ?? null,
        streamTitle: clip.recording?.title ?? null,
        language: settings.language,
        durationSec: clip.endSec - clip.startSec,
        transcript: wordsToText(words, clip.startSec, clip.endSec),
        signals: { audio: signals.audio ?? 0, chat: signals.chat ?? null, scene: signals.scene ?? null },
        defaultHashtags: settings.defaultHashtags,
      };
      const ai = await generateMetadata(ctx);
      const meta = ai ?? fallbackMetadata(ctx, clipId);
      const detectorScore = signals.detector ?? clip.score;
      await db.clip.update({
        where: { id: clipId },
        data: {
          title: meta.title,
          hook: meta.hook,
          description: meta.description,
          hashtags: meta.hashtags,
          // Note finale : moitié signaux mesurés, moitié jugement de l'IA sur le contenu.
          score: meta.viralScore === null ? detectorScore : Math.round(0.55 * detectorScore + 0.45 * meta.viralScore),
          signals: { ...signals, detector: detectorScore, ai: meta.viralScore, reason: meta.reason },
        },
      });
    }

    // 3. Montage.
    await renderClip(clipId);
    await db.clip.updateMany({ where: { id: clipId, status: "PROCESSING" }, data: { status: "READY", error: null } });
    log("clip", `${clipId} prêt`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.clip.updateMany({ where: { id: clipId }, data: { error: message.slice(0, 1000) } }).catch(() => {});
    throw err;
  }
}

/** (Re)monte final.mp4 à partir de source.mp4 et des réglages actuels du clip. */
export async function renderClip(clipId: string): Promise<void> {
  const clip = await db.clip.findUnique({
    where: { id: clipId },
    include: { streamer: true, recording: { select: { author: true } }, user: { select: { settings: true } } },
  });
  if (!clip) throw new PermanentError(`Clip ${clipId} introuvable (supprimé ?)`);
  const settings = parseSettings(clip.user.settings);
  const source = clipFile(clipId, "source");
  if ((await fileSize(source)) === null) throw new PermanentError("Le fichier source du clip a disparu");

  const info = await probe(source);
  if (!info.hasVideo || info.width === 0) throw new PermanentError("Le fichier source ne contient pas de vidéo");
  const start = Math.max(0, Math.min(clip.startSec, info.duration - 1));
  const end = Math.min(info.duration, Math.max(clip.endSec, start + 1));
  const duration = end - start;

  const facecam = validFacecam(clip.streamer?.facecam);
  const template = clip.template === "FACECAM" && !facecam ? "BLUR" : clip.template;
  const band = template === "BLUR" ? blurBandHeight(info.width, info.height, settings.zoom) : OUT_H;

  const words = clip.captions ? asWords(clip.transcript).map((x) => ({ w: x.w, s: x.s - start, e: x.e - start })) : [];
  const hook = settings.showHook ? clip.hook : "";
  const credit = !settings.showCredit
    ? ""
    : clip.streamer
      ? creditLabel(clip.streamer.platform, clip.streamer.login, clip.streamer.displayName)
      : (clip.recording?.author ?? "");

  let assFile: string | null = null;
  if (words.length || hook || credit) {
    const ass = buildAss({
      duration,
      words,
      hook,
      credit,
      font: settings.captionFont,
      highlight: settings.captionColor,
      layout: layoutFor(template, band),
    });
    await writeFile(clipFile(clipId, "captions"), ass, "utf8");
    assFile = CLIP_FILES.captions;
  }

  // On monte dans un fichier temporaire : l'ancien final.mp4 reste lisible pendant le rendu.
  const tmpOut = clipFile(clipId, "final") + ".tmp.mp4";
  await renderVertical({
    source,
    out: tmpOut,
    cwd: clipDir(clipId),
    start,
    duration,
    template,
    zoom: settings.zoom,
    facecam,
    srcWidth: info.width,
    srcHeight: info.height,
    hasAudio: info.hasAudio,
    assFile,
  });
  await rename(tmpOut, clipFile(clipId, "final"));

  // Miniature prise au moment fort (ou au milieu si le pic est hors de la fenêtre).
  const peakRel = clip.peakSec >= start && clip.peakSec <= end ? clip.peakSec - start : duration / 2;
  await makeThumbnail(clipFile(clipId, "final"), clipFile(clipId, "thumb"), Math.min(peakRel, duration - 0.2)).catch((e) =>
    log("clip", `miniature impossible pour ${clipId} : ${e instanceof Error ? e.message : e}`),
  );

  await db.clip.update({
    where: { id: clipId },
    data: { hasFinal: true, renderedAt: new Date(), sourceDur: info.duration, startSec: start, endSec: end, error: null },
  });
}
