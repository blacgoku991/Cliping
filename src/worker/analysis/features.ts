import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "@/lib/env";
import { runOk } from "../proc";
import { probe } from "./probe";

/** Plancher de sonie : en dessous, on considère que c'est du silence. */
export const SILENCE_LUFS = -70;

export interface MediaFeatures {
  duration: number;
  /** Sonie momentanée (LUFS, fenêtre 400 ms) échantillonnée toutes les 100 ms */
  loudness: Float32Array;
  /** Par seconde : sonie max de la seconde (LUFS) */
  audioPerSec: number[];
  /** Par seconde : intensité de changement d'image 0..1 (null = pas de mesure) */
  scenePerSec: Array<number | null>;
}

function parseMetadataFile(text: string, key: string): Array<{ t: number; v: number }> {
  const out: Array<{ t: number; v: number }> = [];
  let t = NaN;
  for (const line of text.split("\n")) {
    if (line.startsWith("frame:")) {
      const m = /pts_time:([-\d.]+)/.exec(line);
      t = m ? Number(m[1]) : NaN;
    } else if (line.startsWith(key + "=")) {
      const v = Number(line.slice(key.length + 1));
      if (Number.isFinite(t) && Number.isFinite(v)) out.push({ t, v });
    }
  }
  return out;
}

/**
 * Une seule passe ffmpeg : sonie EBU R128 (toutes les 100 ms) + score de changement de plan.
 * `startOffset`/`maxDuration` permettent d'analyser une portion (longues VOD traitées par tranches).
 */
export async function analyzeMedia(
  file: string,
  opts: { video?: "keyframes" | "full" | "off"; signal?: AbortSignal; knownDuration?: number } = {},
): Promise<MediaFeatures> {
  const mode = opts.video ?? env.worker.videoAnalysis;
  const info = await probe(file);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "cliping-an-"));
  try {
    const args: string[] = ["-hide_banner", "-nostats", "-loglevel", "error"];
    const useVideo = mode !== "off" && info.hasVideo;
    if (useVideo && mode === "keyframes") args.push("-skip_frame", "nokey");
    args.push("-i", file);

    const graph: string[] = [];
    if (info.hasAudio) {
      graph.push("[0:a:0]ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.M:file=audio.txt[ao]");
    }
    if (useVideo) {
      // En mode « full » on réduit à 4 i/s : assez pour mesurer l'agitation, 15× moins de calcul.
      const pre = mode === "full" ? "fps=4," : "";
      graph.push(
        `[0:v:0]${pre}scale=160:90,select='gte(scene,0)',metadata=mode=print:key=lavfi.scene_score:file=scene.txt[vo]`,
      );
    }
    if (graph.length === 0) throw new Error("Le fichier ne contient ni audio ni vidéo exploitable");
    args.push("-filter_complex", graph.join(";"));
    if (info.hasAudio) args.push("-map", "[ao]", "-f", "null", "-");
    if (useVideo) args.push("-map", "[vo]", "-f", "null", "-");

    await runOk(env.bin.ffmpeg, args, { cwd: tmp, timeoutMs: 6 * 3600_000, signal: opts.signal });

    const audioRaw = info.hasAudio
      ? parseMetadataFile(await readFile(path.join(tmp, "audio.txt"), "utf8").catch(() => ""), "lavfi.r128.M")
      : [];
    const sceneRaw = useVideo
      ? parseMetadataFile(await readFile(path.join(tmp, "scene.txt"), "utf8").catch(() => ""), "lavfi.scene_score")
      : [];

    // Les segments MPEG-TS ne démarrent pas forcément à 0 : on recale sur le premier horodatage.
    const t0 = Math.min(audioRaw[0]?.t ?? Infinity, sceneRaw[0]?.t ?? Infinity);
    const base = Number.isFinite(t0) ? t0 : 0;
    const lastT = Math.max(audioRaw.at(-1)?.t ?? 0, sceneRaw.at(-1)?.t ?? 0) - base;
    const duration = Math.max(opts.knownDuration ?? 0, info.duration, lastT);
    const seconds = Math.max(1, Math.ceil(duration - 0.05));

    const loudness = new Float32Array(Math.max(1, Math.ceil(duration * 10))).fill(SILENCE_LUFS);
    const audioPerSec = new Array<number>(seconds).fill(SILENCE_LUFS);
    for (const { t, v } of audioRaw) {
      const rel = t - base;
      const val = Math.max(SILENCE_LUFS, v);
      const i = Math.floor(rel * 10 + 1e-6);
      if (i >= 0 && i < loudness.length) loudness[i] = val;
      const s = Math.floor(rel);
      if (s >= 0 && s < seconds && val > audioPerSec[s]!) audioPerSec[s] = val;
    }

    const scenePerSec = new Array<number | null>(seconds).fill(null);
    if (useVideo) {
      for (const { t, v } of sceneRaw) {
        const s = Math.floor(t - base);
        if (s >= 0 && s < seconds) scenePerSec[s] = Math.max(scenePerSec[s] ?? 0, v);
      }
      // Images clés espacées (souvent 2 s) : on propage la dernière mesure sur les secondes vides (3 s max).
      let last: number | null = null;
      let age = 0;
      for (let s = 0; s < seconds; s++) {
        if (scenePerSec[s] !== null) {
          last = scenePerSec[s]!;
          age = 0;
        } else if (last !== null && ++age <= 3) {
          scenePerSec[s] = last;
        }
      }
    }
    return { duration, loudness, audioPerSec, scenePerSec };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
