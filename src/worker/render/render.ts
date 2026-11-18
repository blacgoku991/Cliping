import { env, FONTS_DIR } from "@/lib/env";
import { runOk } from "../proc";
import { OUT_H, OUT_W } from "./captions";

export interface FacecamRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RenderInput {
  source: string;
  out: string;
  /** Dossier de travail (contient captions.ass) */
  cwd: string;
  start: number;
  duration: number;
  template: "BLUR" | "FULL" | "FACECAM";
  zoom: number;
  facecam?: FacecamRect | null;
  srcWidth: number;
  srcHeight: number;
  hasAudio: boolean;
  /** Nom du fichier .ass dans cwd, ou null pour aucun texte incrusté */
  assFile: string | null;
  signal?: AbortSignal;
}

export const FACECAM_TOP_H = 672;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Échappe une valeur d'option dans un filtergraph ffmpeg. */
export function escFilterArg(value: string): string {
  return value.replace(/([\\':,;\[\]])/g, "\\$1");
}

/** Hauteur de la bande de gameplay du template BLUR, pour placer les textes autour. */
export function blurBandHeight(srcWidth: number, srcHeight: number, zoom: number): number {
  const z = effectiveZoom(srcWidth, srcHeight, zoom);
  return Math.min(OUT_H, even((OUT_W * srcHeight * z) / srcWidth));
}

function effectiveZoom(srcWidth: number, srcHeight: number, zoom: number): number {
  // Au-delà, la bande dépasserait la hauteur de l'image.
  const max = (OUT_H * srcWidth) / (OUT_W * srcHeight);
  return Math.max(1, Math.min(zoom, max));
}

export function validFacecam(f: unknown): FacecamRect | null {
  if (!f || typeof f !== "object") return null;
  const r = f as Record<string, unknown>;
  const n = (k: string) => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : NaN);
  const rect = { x: n("x"), y: n("y"), w: n("w"), h: n("h") };
  if ([rect.x, rect.y, rect.w, rect.h].some(Number.isNaN)) return null;
  if (rect.x < 0 || rect.y < 0 || rect.w < 0.05 || rect.h < 0.05 || rect.x + rect.w > 1.001 || rect.y + rect.h > 1.001) return null;
  return rect;
}

export function buildFilterGraph(input: RenderInput): string {
  const fps = env.worker.renderFps;
  const parts: string[] = [];
  const template = input.template === "FACECAM" && !input.facecam ? "BLUR" : input.template;

  if (template === "BLUR") {
    const z = effectiveZoom(input.srcWidth, input.srcHeight, input.zoom).toFixed(4);
    parts.push(`[0:v]fps=${fps},setsar=1,split=2[bgsrc][fgsrc]`);
    // Fond : la même image, agrandie et floutée (calculée en petit pour aller vite).
    parts.push(
      `[bgsrc]scale=216:384:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=216:384,gblur=sigma=7,` +
        `scale=${OUT_W}:${OUT_H}:flags=bilinear,eq=brightness=-0.14:saturation=1.15[bg]`,
    );
    parts.push(`[fgsrc]crop=w=iw/${z}:h=ih:x=(iw-iw/${z})/2:y=0,scale=${OUT_W}:-2:flags=lanczos[fg]`);
    parts.push(`[bg][fg]overlay=x=0:y=(H-h)/2:shortest=1[base]`);
  } else if (template === "FACECAM") {
    const f = input.facecam!;
    const bottom = OUT_H - FACECAM_TOP_H;
    parts.push(`[0:v]fps=${fps},setsar=1,split=2[camsrc][gamesrc]`);
    parts.push(
      `[camsrc]crop=w=iw*${f.w.toFixed(4)}:h=ih*${f.h.toFixed(4)}:x=iw*${f.x.toFixed(4)}:y=ih*${f.y.toFixed(4)},` +
        `scale=${OUT_W}:${FACECAM_TOP_H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${OUT_W}:${FACECAM_TOP_H}[cam]`,
    );
    parts.push(
      `[gamesrc]scale=${OUT_W}:${bottom}:force_original_aspect_ratio=increase:flags=lanczos,crop=${OUT_W}:${bottom}[game]`,
    );
    parts.push(`[cam][game]vstack=inputs=2[base]`);
  } else {
    parts.push(
      `[0:v]fps=${fps},setsar=1,scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${OUT_W}:${OUT_H}[base]`,
    );
  }

  // setsar=1 : pixels carrés garantis, sinon certains lecteurs affichent 1080×1921.
  if (input.assFile) {
    parts.push(`[base]setsar=1,ass=filename=${escFilterArg(input.assFile)}:fontsdir=${escFilterArg(FONTS_DIR)}[v]`);
  } else {
    parts.push(`[base]setsar=1[v]`);
  }
  return parts.join(";");
}

/** Monte le clip vertical 1080×1920 final. */
export async function renderVertical(input: RenderInput): Promise<void> {
  const dur = Math.max(1, input.duration);
  const args = [
    "-hide_banner", "-nostats", "-loglevel", "error", "-y",
    "-ss", Math.max(0, input.start).toFixed(3),
    "-t", dur.toFixed(3),
    "-i", input.source,
    "-filter_complex", buildFilterGraph(input),
    "-map", "[v]",
  ];
  if (input.hasAudio) {
    const fadeOut = Math.max(0, dur - 0.3).toFixed(3);
    args.push(
      "-map", "0:a:0",
      // Niveau sonore homogène d'un clip à l'autre (-14 LUFS, la cible des plateformes) + fondus anti-clic.
      "-af", `aresample=48000,loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.12,afade=t=out:st=${fadeOut}:d=0.3`,
      "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    );
  }
  args.push(
    "-c:v", "libx264", "-preset", env.worker.x264Preset, "-crf", "20",
    "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-maxrate", "10M", "-bufsize", "20M",
    "-g", String(env.worker.renderFps * 2),
    "-movflags", "+faststart",
    input.out,
  );
  await runOk(env.bin.ffmpeg, args, { cwd: input.cwd, timeoutMs: 30 * 60_000, signal: input.signal });
}

export async function makeThumbnail(video: string, out: string, atSec: number): Promise<void> {
  await runOk(
    env.bin.ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-y", "-ss", Math.max(0, atSec).toFixed(3), "-i", video, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", out],
    { timeoutMs: 60_000 },
  );
}
