/**
 * Tâche « compilation.render » : propose titre/description (IA ou défaut), monte la vidéo 1920×1080,
 * génère la miniature 1280×720 et calcule les chapitres.
 */
import { rename, rm, writeFile } from "node:fs/promises";
import type { Prisma } from "@prisma/client";
import {
  buildChapters,
  buildTimeline,
  cleanLabel,
  defaultMeta,
  montageSignature,
  momentNumber,
  OUTRO_SEC,
  shortGame,
  type MetaContext,
} from "@/lib/compilation";
import { compilationDir, compilationFile, COMPILATION_FILES } from "@/lib/compilation-files";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { PermanentError } from "@/lib/jobs";
import { parseSettings } from "@/lib/settings";
import { creditLabel } from "@/lib/sources";
import { clipFile, ensureDir, fileSize } from "@/lib/storage";
import { probe, type MediaInfo } from "./analysis/probe";
import { generateCompilationMeta } from "./compilation-ai";
import { log } from "./proc";
import { defaultEmphasis, type Word } from "./render/captions";
import { mapWords } from "./render/plan";
import {
  buildCompilationAss,
  buildThumbAss,
  renderCompilationVideo,
  renderThumbnail,
  type CompilationSegment,
  type MomentText,
} from "./render/compilation";
import { wordsToText } from "./transcribe";

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

async function load(id: string) {
  return db.compilation.findUnique({
    where: { id },
    include: {
      user: { select: { settings: true } },
      items: {
        orderBy: { position: "asc" },
        include: { clip: { include: { streamer: true, recording: { select: { author: true, category: true } } } } },
      },
    },
  });
}
type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;
type LoadedItem = Loaded["items"][number];

function streamerName(item: LoadedItem): string {
  return item.clip.streamer?.displayName ?? item.clip.recording?.author ?? "";
}

function creditOf(item: LoadedItem): string {
  const s = item.clip.streamer;
  return s ? creditLabel(s.platform, s.login, s.displayName) : (item.clip.recording?.author ?? "");
}

/** Noms des streamers, du plus présent au moins présent. */
export function streamersOf(items: LoadedItem[]): string[] {
  const count = new Map<string, number>();
  for (const it of items) {
    const n = streamerName(it);
    if (n) count.set(n, (count.get(n) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

function gameOf(items: LoadedItem[]): string {
  const count = new Map<string, number>();
  for (const it of items) {
    const g = shortGame(it.clip.recording?.category ?? it.clip.streamer?.liveCategory ?? "");
    if (g) count.set(g, (count.get(g) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/** Titre, description, mots-clés et texte de miniature, si l'utilisateur ne les a pas encore fixés. */
async function ensureMeta(c: Loaded): Promise<Loaded> {
  if (!c.metaPending) return c;
  const settings = parseSettings(c.user.settings);
  const origin = (c.origin ?? {}) as { kind?: MetaContext["kind"] };
  const streamers = streamersOf(c.items);
  const game = gameOf(c.items);
  const fallback = defaultMeta({
    streamers,
    game,
    count: c.items.length,
    kind: origin.kind ?? "manual",
    moments: c.items.map((i) => i.label),
  });
  const ai = await generateCompilationMeta({
    language: settings.language,
    streamers,
    game,
    count: c.items.length,
    moments: c.items.map((i) => ({
      title: i.label || i.clip.title,
      streamer: streamerName(i),
      transcript: wordsToText(asWords(i.clip.transcript), i.clip.startSec, i.clip.endSec),
    })),
    defaultHashtags: settings.defaultHashtags,
  });
  const meta = ai ?? fallback;
  // Les champs déjà remplis par l'utilisateur sont gardés.
  await db.compilation.update({
    where: { id: c.id },
    data: {
      title: c.title || meta.title,
      description: c.description || meta.description,
      thumbText: c.thumbText || meta.thumbText,
      tags: c.tags.length ? c.tags : meta.tags,
      metaPending: false,
    },
  });
  return (await load(c.id))!;
}

/** Le moment le plus fort (meilleur score) : il sert à l'ouverture et à la miniature. */
function strongest(items: LoadedItem[]): LoadedItem {
  return [...items].sort((a, b) => b.clip.score - a.clip.score)[0]!;
}

async function makeThumb(c: Loaded, best: LoadedItem, highlight: string): Promise<boolean> {
  const dir = compilationDir(c.id);
  const kicker = `TOP ${c.items.length}`;
  const text = c.thumbText.replace(new RegExp(`^${kicker}\\s*`, "i"), "") || c.title;
  await writeFile(compilationFile(c.id, "thumbAss"), buildThumbAss(text, kicker, highlight), "utf8");
  // Image prise juste après le pic : la réaction plutôt que l'instant d'avant.
  const at = Math.min(Math.max(best.clip.peakSec + 0.4, best.clip.startSec), best.clip.endSec - 0.1);
  try {
    await renderThumbnail({ source: clipFile(best.clip.id, "source"), atSec: at, cwd: dir, assFile: COMPILATION_FILES.thumbAss, out: compilationFile(c.id, "thumb") });
    return true;
  } catch (err) {
    log("compilation", `miniature impossible pour ${c.id} : ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

export async function renderCompilation(id: string, thumbOnly = false): Promise<void> {
  const t0 = Date.now();
  let c = await load(id);
  if (!c) throw new PermanentError(`Compilation ${id} introuvable (supprimée ?)`);
  if (c.items.length < 3) throw new PermanentError("Il faut au moins 3 moments pour monter une compilation.");
  const settings = parseSettings(c.user.settings);
  await ensureDir(compilationDir(id));

  // Sources présentes ? (un clip non publié est supprimé au bout de quelques jours)
  const infos = new Map<string, MediaInfo>();
  for (const it of c.items) {
    const src = clipFile(it.clip.id, "source");
    if ((await fileSize(src)) === null) throw new PermanentError(`La vidéo source du moment « ${it.label || it.clip.title} » a été supprimée : retire-le de la compilation.`);
    if (!thumbOnly) infos.set(it.clip.id, await probe(src));
  }

  c = await ensureMeta(c);
  const best = strongest(c.items);

  if (thumbOnly) {
    const ok = await makeThumb(c, best, settings.captionColor);
    await db.compilation.update({ where: { id }, data: { hasThumb: ok, renderedAt: c.renderedAt ?? new Date() } });
    return;
  }

  await db.compilation.update({ where: { id }, data: { status: "RENDERING", progress: 0, error: null } });
  const fps = env.worker.renderFps;
  const timeline = buildTimeline(
    c.items.map((i) => i.clip.endSec - i.clip.startSec),
    { intro: c.intro, fps, outroSec: OUTRO_SEC },
  );

  const segments: CompilationSegment[] = [];
  if (timeline.intro > 0) {
    const info = infos.get(best.clip.id)!;
    // Ouverture : le pic du meilleur moment, juste avant qu'il arrive (on ne gâche pas la chute).
    const from = Math.max(best.clip.startSec, best.clip.peakSec - timeline.intro + 0.6);
    segments.push({ source: clipFile(best.clip.id, "source"), from, duration: timeline.intro, width: info.width, height: info.height, hasAudio: info.hasAudio, kind: "intro" });
  }
  const moments: MomentText[] = c.items.map((it, i) => {
    const info = infos.get(it.clip.id)!;
    const slot = timeline.moments[i]!;
    segments.push({ source: clipFile(it.clip.id, "source"), from: it.clip.startSec, duration: slot.duration, width: info.width, height: info.height, hasAudio: info.hasAudio, kind: "moment" });
    const transcript = asWords(it.clip.transcript);
    const mapped = c!.captions ? mapWords([{ from: it.clip.startSec, to: it.clip.startSec + slot.duration, kind: "body" }], transcript).words : [];
    const inWindow = transcript.filter((w) => w.e > it.clip.startSec && w.s < it.clip.endSec);
    return {
      number: momentNumber(i, c!.items.length, c!.countdown),
      label: it.label || cleanLabel(it.clip.title) || `Moment ${i + 1}`,
      credit: settings.showCredit ? creditOf(it) : "",
      words: mapped.map((w) => ({ ...w, s: w.s + slot.at, e: w.e + slot.at })),
      emphasis: it.clip.emphasis.length ? it.clip.emphasis : defaultEmphasis(inWindow),
    };
  });

  const ass = buildCompilationAss({
    timeline,
    moments,
    introTitle: c.title,
    introKicker: c.countdown ? `Top ${c.items.length}` : `${c.items.length} moments`,
    // Le crédit reste sur le carton de fin même si l'incrustation en coin est désactivée.
    outroCredits: [...new Set(c.items.map(creditOf).filter(Boolean))],
    highlight: settings.captionColor,
    captions: c.captions,
  });
  await writeFile(compilationFile(id, "captions"), ass, "utf8");

  const tmpOut = compilationFile(id, "final") + ".tmp.mp4";
  let lastWrite = 0;
  try {
    await renderCompilationVideo(
      { segments, outroSec: timeline.outro, out: tmpOut, cwd: compilationDir(id), assFile: COMPILATION_FILES.captions, fps },
      (sec) => {
        if (Date.now() - lastWrite < 3000) return;
        lastWrite = Date.now();
        void db.compilation.update({ where: { id }, data: { progress: Math.min(0.99, sec / timeline.total) } }).catch(() => {});
      },
    );
  } catch (err) {
    await rm(tmpOut, { force: true }).catch(() => {});
    throw err;
  }
  await rename(tmpOut, compilationFile(id, "final"));
  const out = await probe(compilationFile(id, "final"));
  const hasThumb = await makeThumb(c, best, settings.captionColor);

  const chapters = buildChapters(timeline, moments.map((m) => `#${m.number} ${m.label}`));
  const renderMs = Date.now() - t0;
  const montage = {
    duration: out.duration,
    planned: timeline.total,
    intro: timeline.intro,
    outro: timeline.outro,
    moments: c.items.map((it, i) => ({ clipId: it.clip.id, at: timeline.moments[i]!.at, duration: timeline.moments[i]!.duration, label: moments[i]!.label, number: moments[i]!.number })),
    signature: montageSignature({
      items: c.items.map((i) => ({ clipId: i.clip.id, label: i.label, start: i.clip.startSec, end: i.clip.endSec })),
      countdown: c.countdown,
      captions: c.captions,
      intro: c.intro,
      title: c.title,
    }),
    renderMs,
  };
  await db.compilation.update({
    where: { id },
    data: {
      status: "READY",
      hasFinal: true,
      hasThumb,
      progress: 1,
      renderedAt: new Date(),
      error: null,
      montage: montage as Prisma.InputJsonValue,
      chapters: chapters as unknown as Prisma.InputJsonValue,
    },
  });
  log(
    "compilation",
    `${id} montée en ${(renderMs / 1000).toFixed(1)} s — ${c.items.length} moments, ${out.duration.toFixed(1)} s (prévu ${timeline.total.toFixed(1)} s), ${chapters.length} chapitres`,
  );
}

/** Échec définitif d'un montage : la compilation repasse en échec avec un message lisible. */
export async function markCompilationFailed(id: string, message: string): Promise<void> {
  await db.compilation
    .updateMany({ where: { id }, data: { status: "FAILED", error: `Montage échoué : ${message}`.slice(0, 1000) } })
    .catch(() => {});
}
