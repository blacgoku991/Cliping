import { env, FONTS_DIR } from "@/lib/env";
import { runOk } from "../proc";
import { OUT_H, OUT_W } from "./captions";
import { zoomExpr, type ZoomWindow } from "./plan";

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
  /** Fenêtre du clip dans la source (utilisée quand `segments` est absent) */
  start: number;
  duration: number;
  /** Morceaux de la source mis bout à bout (cold open, coupes des temps morts) */
  segments?: Array<{ from: number; to: number }>;
  template: "BLUR" | "FULL" | "FACECAM";
  zoom: number;
  facecam?: FacecamRect | null;
  srcWidth: number;
  srcHeight: number;
  hasAudio: boolean;
  /** Nom du fichier .ass dans cwd, ou null pour aucun texte incrusté */
  assFile: string | null;
  /** Moments du zoom d'impact dans la vidéo finale (vide = pas de zoom) */
  punchZoom?: ZoomWindow[];
  /** Durée du carton de fin (image figée), 0 = aucun */
  endCardSec?: number;
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

export function segmentsOf(input: Pick<RenderInput, "segments" | "start" | "duration">): Array<{ from: number; to: number }> {
  const segs = input.segments?.filter((x) => x.to - x.from > 0.01);
  if (segs && segs.length) return segs;
  return [{ from: Math.max(0, input.start), to: Math.max(0, input.start) + Math.max(1, input.duration) }];
}

/** Zoom d'impact appliqué à une image de taille fixe w×h (le cadre ne bouge pas, l'image grossit au centre). */
function punch(windows: ZoomWindow[], w: number, h: number, fps: number): string {
  // zoompan à d=1 : une image en sortie par image en entrée ; `on/fps` donne le temps de la sortie.
  const z = zoomExpr(windows, `(on/${fps})`);
  return `,zoompan=z='${z}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${w}x${h}:fps=${fps}`;
}

export function buildFilterGraph(input: RenderInput): string {
  const fps = env.worker.renderFps;
  const parts: string[] = [];
  const template = input.template === "FACECAM" && !input.facecam ? "BLUR" : input.template;
  const segs = segmentsOf(input);

  // 1. Assemblage des morceaux (chaque morceau est une entrée ffmpeg déjà positionnée avec -ss/-t).
  let vIn = "[0:v]";
  let aIn = input.hasAudio ? "[0:a:0]" : "";
  if (segs.length > 1) {
    const pads: string[] = [];
    segs.forEach((seg, i) => {
      const d = seg.to - seg.from;
      parts.push(`[${i}:v]setpts=PTS-STARTPTS[v${i}]`);
      if (input.hasAudio) {
        // Micro-fondus de 15 ms à chaque coupe : pas de « clic » quand le son saute.
        parts.push(`[${i}:a:0]aresample=48000,asetpts=PTS-STARTPTS,afade=t=in:d=0.015,afade=t=out:st=${Math.max(0, d - 0.015).toFixed(3)}:d=0.015[a${i}]`);
        pads.push(`[v${i}][a${i}]`);
      } else {
        pads.push(`[v${i}]`);
      }
    });
    parts.push(`${pads.join("")}concat=n=${segs.length}:v=1:a=${input.hasAudio ? 1 : 0}[cv]${input.hasAudio ? "[ca]" : ""}`);
    vIn = "[cv]";
    aIn = input.hasAudio ? "[ca]" : "";
  }

  const zoomWins = input.punchZoom && input.punchZoom.length ? input.punchZoom : null;

  // 2. Mise en page verticale.
  if (template === "BLUR") {
    const z = effectiveZoom(input.srcWidth, input.srcHeight, input.zoom).toFixed(4);
    const band = blurBandHeight(input.srcWidth, input.srcHeight, input.zoom);
    parts.push(`${vIn}fps=${fps},setsar=1,split=2[bgsrc][fgsrc]`);
    // Fond : la même image, agrandie et floutée (calculée en petit pour aller vite).
    parts.push(
      `[bgsrc]scale=216:384:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=216:384,gblur=sigma=7,` +
        `scale=${OUT_W}:${OUT_H}:flags=bilinear,eq=brightness=-0.14:saturation=1.15[bg]`,
    );
    const fgScale = zoomWins ? `scale=${OUT_W}:${band}:flags=lanczos` : `scale=${OUT_W}:-2:flags=lanczos`;
    parts.push(`[fgsrc]crop=w=iw/${z}:h=ih:x=(iw-iw/${z})/2:y=0,${fgScale}${zoomWins ? punch(zoomWins, OUT_W, band, fps) : ""}[fg]`);
    parts.push(`[bg][fg]overlay=x=0:y=(H-h)/2:shortest=1[base0]`);
  } else if (template === "FACECAM") {
    const f = input.facecam!;
    const bottom = OUT_H - FACECAM_TOP_H;
    parts.push(`${vIn}fps=${fps},setsar=1,split=2[camsrc][gamesrc]`);
    parts.push(
      `[camsrc]crop=w=iw*${f.w.toFixed(4)}:h=ih*${f.h.toFixed(4)}:x=iw*${f.x.toFixed(4)}:y=ih*${f.y.toFixed(4)},` +
        `scale=${OUT_W}:${FACECAM_TOP_H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${OUT_W}:${FACECAM_TOP_H}[cam]`,
    );
    parts.push(
      `[gamesrc]scale=${OUT_W}:${bottom}:force_original_aspect_ratio=increase:flags=lanczos,crop=${OUT_W}:${bottom}` +
        `${zoomWins ? punch(zoomWins, OUT_W, bottom, fps) : ""}[game]`,
    );
    parts.push(`[cam][game]vstack=inputs=2[base0]`);
  } else {
    parts.push(
      `${vIn}fps=${fps},setsar=1,scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${OUT_W}:${OUT_H}` +
        `${zoomWins ? punch(zoomWins, OUT_W, OUT_H, fps) : ""}[base0]`,
    );
  }

  // 3. Carton de fin : la dernière image reste figée sous le texte.
  const card = input.endCardSec && input.endCardSec > 0 ? input.endCardSec : 0;
  parts.push(card ? `[base0]tpad=stop_mode=clone:stop_duration=${card.toFixed(3)}[base]` : `[base0]null[base]`);

  // setsar=1 : pixels carrés garantis, sinon certains lecteurs affichent 1080×1921.
  if (input.assFile) {
    parts.push(`[base]setsar=1,ass=filename=${escFilterArg(input.assFile)}:fontsdir=${escFilterArg(FONTS_DIR)}[v]`);
  } else {
    parts.push(`[base]setsar=1[v]`);
  }

  // 4. Son : niveau homogène d'un clip à l'autre (-14 LUFS, la cible des plateformes) + fondus anti-clic.
  if (input.hasAudio) {
    const content = segs.reduce((n, x) => n + x.to - x.from, 0);
    const fadeOut = Math.max(0, content - 0.3).toFixed(3);
    const pad = card ? `,apad=pad_dur=${card.toFixed(3)}` : "";
    parts.push(
      `${aIn}aresample=48000,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,afade=t=in:d=0.12,afade=t=out:st=${fadeOut}:d=0.3${pad}[a]`,
    );
  }
  return parts.join(";");
}

/** Arguments ffmpeg complets du montage (exposés pour les tests). */
export function renderArgs(input: RenderInput): string[] {
  const segs = segmentsOf(input);
  const args = ["-hide_banner", "-nostats", "-loglevel", "error", "-y"];
  for (const seg of segs) {
    args.push("-ss", Math.max(0, seg.from).toFixed(3), "-t", Math.max(0.05, seg.to - seg.from).toFixed(3), "-i", input.source);
  }
  args.push("-filter_complex", buildFilterGraph(input), "-map", "[v]");
  if (input.hasAudio) args.push("-map", "[a]", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2");
  args.push(
    "-c:v", "libx264", "-preset", env.worker.x264Preset, "-crf", "20",
    "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-maxrate", "10M", "-bufsize", "20M",
    "-g", String(env.worker.renderFps * 2),
    "-movflags", "+faststart",
    input.out,
  );
  return args;
}

/** Monte le clip vertical 1080×1920 final. */
export async function renderVertical(input: RenderInput): Promise<void> {
  await runOk(env.bin.ffmpeg, renderArgs(input), { cwd: input.cwd, timeoutMs: 30 * 60_000, signal: input.signal });
}

export async function makeThumbnail(video: string, out: string, atSec: number): Promise<void> {
  await runOk(
    env.bin.ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-y", "-ss", Math.max(0, atSec).toFixed(3), "-i", video, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", out],
    { timeoutMs: 60_000 },
  );
}
