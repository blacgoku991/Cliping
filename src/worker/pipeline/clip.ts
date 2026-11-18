import { rename, writeFile } from "node:fs/promises";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PermanentError } from "@/lib/jobs";
import { effectiveEdit, parseSettings } from "@/lib/settings";
import { creditLabel } from "@/lib/sources";
import { CLIP_FILES, clipDir, clipFile, fileSize } from "@/lib/storage";
import { fallbackMetadata, generateMetadata, type MetadataContext } from "../ai";
import { analyzeMedia } from "../analysis/features";
import { probe } from "../analysis/probe";
import { env } from "@/lib/env";
import { log } from "../proc";
import { buildAss, defaultEmphasis, layoutFor, OUT_H, type Word } from "../render/captions";
import { buildPlan, mapWords, refineBounds, zoomWindows } from "../render/plan";
import { blurBandHeight, extractFrames, makeThumbnail, renderVertical, validFacecam } from "../render/render";
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

/** Durée du carton de fin. */
const END_CARD_SEC = 2.5;

/** Sonie de la source toutes les 100 ms (une passe audio seule, moins d'une seconde pour un clip). */
async function sourceLoudness(source: string): Promise<Float32Array | null> {
  try {
    return (await analyzeMedia(source, { video: "off" })).loudness;
  } catch (err) {
    log("clip", `sonie illisible, montage sans coupe des temps morts : ${err instanceof Error ? err.message : err}`);
    return null;
  }
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

    // 2. Bornes intelligentes, une seule fois à la création (ensuite c'est l'utilisateur qui décide).
    let loudness: Float32Array | null = null;
    let { startSec, endSec } = clip;
    if (settings.smartBounds && clip.renderedAt === null && clip.montage === null) {
      loudness = await sourceLoudness(source);
      const sourceDur = clip.sourceDur || (await probe(source)).duration;
      const refined = refineBounds({ start: startSec, end: endSec, peak: clip.peakSec, sourceDur, words, loudness });
      // Garde-fou : on ne dépasse pas la durée max réglée (marge de 4 s pour finir la réaction).
      if (refined.end - refined.start <= settings.clipMaxSec + 4 && refined.reasons.length) {
        log("clip", `${clipId} bornes ajustées (${refined.reasons.join(", ")}) : ${startSec.toFixed(1)}–${endSec.toFixed(1)} → ${refined.start.toFixed(1)}–${refined.end.toFixed(1)}`);
        startSec = refined.start;
        endSec = refined.end;
        await db.clip.update({ where: { id: clipId }, data: { startSec, endSec } });
      }
    }

    // 3. Titre, accroche, hashtags, note de potentiel.
    if (!clip.title) {
      const signals = (clip.signals ?? {}) as { audio?: number; chat?: number | null; scene?: number | null; detector?: number };
      // Quatre images autour du pic (mise en place, pic, réaction) : l'IA décrit ce qui se passe vraiment à l'écran.
      const peak = Math.min(Math.max(clip.peakSec, startSec), endSec);
      const shots = [peak - 3, peak - 0.5, peak + 1, peak + 3].map((t) => Math.min(Math.max(t, startSec), endSec - 0.1));
      const frames = env.ai.apiKey ? await extractFrames(source, shots).catch(() => []) : [];
      const ctx: MetadataContext = {
        frames: frames.map((f) => ({ at: `${f.t - peak >= 0 ? "+" : "−"}${Math.abs(f.t - peak).toFixed(1)} s du pic`, jpeg: f.jpeg })),
        streamer: clip.streamer?.displayName ?? clip.recording?.author ?? "",
        platform: clip.streamer?.platform ?? "OTHER",
        game: clip.recording?.category ?? clip.streamer?.liveCategory ?? null,
        streamTitle: clip.recording?.title ?? null,
        language: settings.language,
        durationSec: endSec - startSec,
        transcript: wordsToText(words, startSec, endSec),
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
          titleOptions: meta.titles,
          hookOptions: meta.hooks,
          emphasis: meta.emphasis,
          description: meta.description,
          hashtags: meta.hashtags,
          // Note finale : moitié signaux mesurés, moitié jugement de l'IA sur le contenu.
          score: meta.viralScore === null ? detectorScore : Math.round(0.55 * detectorScore + 0.45 * meta.viralScore),
          signals: { ...signals, detector: detectorScore, ai: meta.viralScore, reason: meta.reason, hookAngles: meta.hookAngles },
        },
      });
    }

    // 4. Montage.
    await renderClip(clipId, loudness);
    await db.clip.updateMany({ where: { id: clipId, status: "PROCESSING" }, data: { status: "READY", error: null } });
    log("clip", `${clipId} prêt`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.clip.updateMany({ where: { id: clipId }, data: { error: message.slice(0, 1000) } }).catch(() => {});
    throw err;
  }
}

/** (Re)monte final.mp4 à partir de source.mp4 et des réglages actuels du clip. */
export async function renderClip(clipId: string, knownLoudness: Float32Array | null = null): Promise<void> {
  const t0 = Date.now();
  const clip = await db.clip.findUnique({
    where: { id: clipId },
    include: { streamer: true, recording: { select: { author: true } }, user: { select: { settings: true } } },
  });
  if (!clip) throw new PermanentError(`Clip ${clipId} introuvable (supprimé ?)`);
  const settings = parseSettings(clip.user.settings);
  const edit = effectiveEdit(settings, clip.edit);
  const source = clipFile(clipId, "source");
  if ((await fileSize(source)) === null) throw new PermanentError("Le fichier source du clip a disparu");

  const info = await probe(source);
  if (!info.hasVideo || info.width === 0) throw new PermanentError("Le fichier source ne contient pas de vidéo");
  const start = Math.max(0, Math.min(clip.startSec, info.duration - 1));
  const end = Math.min(info.duration, Math.max(clip.endSec, start + 1));

  const facecam = validFacecam(clip.streamer?.facecam);
  const template = clip.template === "FACECAM" && !facecam ? "BLUR" : clip.template;
  const band = template === "BLUR" ? blurBandHeight(info.width, info.height, settings.zoom) : OUT_H;

  // Plan de montage : cold open, coupes des temps morts (calées sur la parole même si les sous-titres sont masqués).
  const transcript = asWords(clip.transcript);
  const loudness = edit.trimSilence && info.hasAudio ? (knownLoudness ?? (await sourceLoudness(source))) : null;
  const plan = buildPlan({
    start,
    end,
    peak: Math.min(Math.max(clip.peakSec, start), end),
    loudness,
    words: transcript,
    coldOpen: edit.coldOpen,
    trimSilence: edit.trimSilence,
    fps: env.worker.renderFps,
  });

  const mapped = mapWords(plan.segments, clip.captions ? transcript : []);
  const inWindow = transcript.filter((w) => w.e > start && w.s < end);
  const emphasis = clip.emphasis.length ? clip.emphasis : defaultEmphasis(inWindow);
  const hook = settings.showHook ? clip.hook : "";
  const streamerCredit = clip.streamer
    ? creditLabel(clip.streamer.platform, clip.streamer.login, clip.streamer.displayName)
    : (clip.recording?.author ?? "");
  const credit = settings.showCredit ? streamerCredit : "";
  const endCardSec = edit.endCard ? END_CARD_SEC : 0;

  const ass = buildAss({
    duration: plan.duration,
    words: mapped.words,
    breaks: mapped.breaks,
    hook,
    credit,
    font: settings.captionFont,
    highlight: settings.captionColor,
    layout: layoutFor(template, band),
    style: edit.captionStyle,
    emphasis,
    progressBar: edit.progressBar,
    flashAt: plan.teaserDur > 0 ? plan.teaserDur : null,
    // Le crédit du streamer reste sur le carton même si l'incrustation en coin est désactivée.
    endCard: endCardSec ? { title: settings.endCardText, credit: streamerCredit, duration: endCardSec } : null,
  });
  const hasText = /^Dialogue:/m.test(ass);
  if (hasText) await writeFile(clipFile(clipId, "captions"), ass, "utf8");

  // On monte dans un fichier temporaire : l'ancien final.mp4 reste lisible pendant le rendu.
  const tmpOut = clipFile(clipId, "final") + ".tmp.mp4";
  await renderVertical({
    source,
    out: tmpOut,
    cwd: clipDir(clipId),
    start,
    duration: end - start,
    segments: plan.segments,
    template,
    zoom: settings.zoom,
    facecam,
    srcWidth: info.width,
    srcHeight: info.height,
    hasAudio: info.hasAudio,
    assFile: hasText ? CLIP_FILES.captions : null,
    punchZoom: edit.punchZoom ? zoomWindows(plan, Math.min(Math.max(clip.peakSec, start), end)) : [],
    endCardSec,
  });
  await rename(tmpOut, clipFile(clipId, "final"));

  // Miniature prise au moment fort (dans le corps du clip, pas dans le cold open).
  await makeThumbnail(clipFile(clipId, "final"), clipFile(clipId, "thumb"), Math.min(plan.peakOut + 0.3, plan.duration - 0.2)).catch((e) =>
    log("clip", `miniature impossible pour ${clipId} : ${e instanceof Error ? e.message : e}`),
  );

  const montage = {
    duration: plan.duration + endCardSec,
    teaserDur: plan.teaserDur,
    removed: plan.removed,
    cuts: plan.cuts,
    peakOut: plan.peakOut,
    endCard: endCardSec,
    style: edit.captionStyle,
    renderMs: Date.now() - t0,
  };
  log(
    "clip",
    `${clipId} monté en ${(montage.renderMs / 1000).toFixed(1)} s — ${montage.duration.toFixed(1)} s` +
      (plan.teaserDur ? `, cold open ${plan.teaserDur.toFixed(1)} s` : "") +
      (plan.removed ? `, ${plan.removed.toFixed(1)} s de temps morts retirés (${plan.cuts} coupe(s))` : ""),
  );
  await db.clip.update({
    where: { id: clipId },
    data: { hasFinal: true, renderedAt: new Date(), sourceDur: info.duration, startSec: start, endSec: end, error: null, montage },
  });
}
