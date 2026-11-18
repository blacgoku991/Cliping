/**
 * Montage d'une compilation horizontale 1920×1080 : arguments ffmpeg et textes incrustés (ASS).
 * Réutilise les briques du montage vertical (nettoyage du texte, paquets de sous-titres, mots forts).
 */
import { env, FONTS_DIR } from "@/lib/env";
import type { Timeline } from "@/lib/compilation";
import { runOk } from "../proc";
import { chunkWords, cleanBurnText, normWord, wrapLines, type Word } from "./captions";
import { escFilterArg } from "./render";

export const CW = 1920;
export const CH = 1080;
export const THUMB_W = 1280;
export const THUMB_H = 720;
/** Fondu au noir entre deux moments (de chaque côté de la coupe). */
export const DIP_SEC = 0.2;

export interface CompilationSegment {
  source: string;
  /** Fenêtre lue dans la source */
  from: number;
  /** Durée exacte attendue dans la vidéo finale (la source est allongée ou coupée pour la tenir) */
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  /** Ouverture : pas de fondu au noir à la fin (un éclair blanc fait la transition) */
  kind: "intro" | "moment";
}

export interface CompilationRenderInput {
  segments: CompilationSegment[];
  /** Carton de fin : dernière image figée */
  outroSec: number;
  out: string;
  cwd: string;
  assFile: string | null;
  fps?: number;
}

const f3 = (n: number) => Math.max(0, n).toFixed(3);

/** Une source dont le format s'écarte du 16:9 (clip vertical importé) est posée sur un fond flouté. */
function needsBackdrop(w: number, h: number): boolean {
  if (!w || !h) return false;
  return Math.abs(w / h - CW / CH) > 0.05;
}

export function compilationFilterGraph(input: CompilationRenderInput): string {
  const fps = input.fps ?? env.worker.renderFps;
  const parts: string[] = [];
  const pads: string[] = [];
  let silentIdx = input.segments.length; // les entrées silencieuses (sources sans son) suivent les sources
  input.segments.forEach((seg, i) => {
    const d = f3(seg.duration);
    const fadeIn = `fade=t=in:st=0:d=${DIP_SEC}`;
    const fadeOut = seg.kind === "moment" ? `,fade=t=out:st=${f3(seg.duration - DIP_SEC)}:d=${DIP_SEC}` : "";
    // tpad + trim : la durée produite est exactement celle prévue, même si la source est un peu courte.
    const head = `[${i}:v]setpts=PTS-STARTPTS,fps=${fps},setsar=1`;
    const tail = `tpad=stop_mode=clone:stop_duration=2,trim=duration=${d},setpts=PTS-STARTPTS,format=yuv420p,${fadeIn}${fadeOut}[v${i}]`;
    if (needsBackdrop(seg.width, seg.height)) {
      parts.push(`${head},split=2[b${i}][f${i}]`);
      parts.push(
        `[b${i}]scale=384:216:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=384:216,gblur=sigma=8,` +
          `scale=${CW}:${CH}:flags=bilinear,eq=brightness=-0.16:saturation=1.1[bg${i}]`,
      );
      parts.push(`[f${i}]scale=${CW}:${CH}:force_original_aspect_ratio=decrease:flags=lanczos[fg${i}]`);
      parts.push(`[bg${i}][fg${i}]overlay=x=(W-w)/2:y=(H-h)/2,${tail}`);
    } else {
      parts.push(`${head},scale=${CW}:${CH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${CW}:${CH},${tail}`);
    }
    // Son : chaque moment est ramené à -14 LUFS avant l'assemblage, pour un niveau homogène d'un moment à l'autre.
    const aSrc = seg.hasAudio ? `[${i}:a:0]` : `[${silentIdx++}:a]`;
    const aFadeOut = seg.kind === "moment" ? `,afade=t=out:st=${f3(seg.duration - DIP_SEC)}:d=${DIP_SEC}` : `,afade=t=out:st=${f3(seg.duration - 0.03)}:d=0.03`;
    parts.push(
      `${aSrc}aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,` +
        (seg.hasAudio ? `loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,` : "") +
        `apad=whole_dur=${d},atrim=duration=${d},asetpts=PTS-STARTPTS,afade=t=in:d=${seg.kind === "moment" ? DIP_SEC : 0.05}${aFadeOut}[a${i}]`,
    );
    pads.push(`[v${i}][a${i}]`);
  });
  parts.push(`${pads.join("")}concat=n=${input.segments.length}:v=1:a=1[cv][ca]`);
  const outro = input.outroSec > 0 ? `,tpad=stop_mode=clone:stop_duration=${f3(input.outroSec)}` : "";
  const ass = input.assFile ? `,ass=filename=${escFilterArg(input.assFile)}:fontsdir=${escFilterArg(FONTS_DIR)}` : "";
  parts.push(`[cv]setsar=1${outro}${ass}[v]`);
  parts.push(`[ca]${input.outroSec > 0 ? `apad=pad_dur=${f3(input.outroSec)},` : ""}aresample=48000[a]`);
  return parts.join(";");
}

export function compilationArgs(input: CompilationRenderInput): string[] {
  const fps = input.fps ?? env.worker.renderFps;
  const args = ["-hide_banner", "-nostats", "-loglevel", "error", "-y", "-progress", "pipe:1"];
  for (const seg of input.segments) {
    // Un peu plus que nécessaire : trim/atrim coupent à la durée exacte.
    args.push("-ss", f3(seg.from), "-t", f3(seg.duration + 0.5), "-i", seg.source);
  }
  for (const seg of input.segments) {
    if (!seg.hasAudio) args.push("-f", "lavfi", "-t", f3(seg.duration + 0.5), "-i", "anullsrc=r=48000:cl=stereo");
  }
  args.push("-filter_complex", compilationFilterGraph(input), "-map", "[v]", "-map", "[a]");
  args.push(
    "-c:v", "libx264", "-preset", env.worker.x264Preset, "-crf", "20",
    "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(fps),
    "-maxrate", "16M", "-bufsize", "32M",
    "-g", String(fps * 2),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    input.out,
  );
  return args;
}

/** Monte la compilation ; `onProgress` reçoit les secondes déjà produites. */
export async function renderCompilationVideo(input: CompilationRenderInput, onProgress?: (sec: number) => void): Promise<void> {
  await runOk(env.bin.ffmpeg, compilationArgs(input), {
    cwd: input.cwd,
    timeoutMs: 3 * 3600_000,
    onStdoutLine: (line) => {
      const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
      if (m && onProgress) onProgress(Number(m[1]) / 1e6);
    },
  });
}

// ───────────────────────── Textes incrustés ─────────────────────────

export interface MomentText {
  number: number;
  label: string;
  /** Crédit du streamer (« twitch.tv/pseudo »), vide = aucun */
  credit: string;
  /** Mots recalés sur la vidéo finale */
  words: Word[];
  emphasis: string[];
}

export interface CompilationAssInput {
  timeline: Timeline;
  moments: MomentText[];
  /** Titre affiché sur l'ouverture */
  introTitle: string;
  /** Petit sur-titre de l'ouverture (« TOP 10 ») */
  introKicker: string;
  /** Noms crédités sur le carton de fin */
  outroCredits: string[];
  highlight: string;
  captions: boolean;
}

function assColor(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "&H8D4DFF&";
  return `&H${m[3]}${m[2]}${m[1]}&`.toUpperCase();
}

function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

const RECT = (w: number, h: number) => `m 0 0 l ${w} 0 ${w} ${h} 0 ${h}`;

/** Durée d'affichage du repère « numéro + titre » au début de chaque moment. */
export const MARKER_SEC = 4.5;

export function buildCompilationAss(input: CompilationAssInput): string {
  const hi = assColor(input.highlight);
  const { timeline } = input;
  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${CW}`,
    `PlayResY: ${CH}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Sous-titres horizontaux : une ligne lisible en bas de l'image, au-dessus de la barre de lecture YouTube.
    "Style: Sub,Poppins ExtraBold,58,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,4,2,2,160,160,70,1",
    "Style: Number,Anton,104,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,4,0,0,0,1",
    "Style: Label,Anton,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,0,0,0,0,100,100,1,0,1,4,2,4,0,0,0,1",
    "Style: Credit,Poppins ExtraBold,36,&H20FFFFFF,&H20FFFFFF,&H60000000,&H78000000,0,0,0,0,100,100,0,0,1,2,1,9,0,0,0,1",
    "Style: Kicker,Poppins ExtraBold,56,&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,0,0,0,0,100,100,6,0,1,3,1,5,0,0,0,1",
    "Style: Title,Anton,104,&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,0,0,0,0,100,100,1,0,1,7,3,5,140,140,0,1",
    "Style: Small,Poppins ExtraBold,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,0,0,0,0,100,100,0,0,1,3,1,5,140,140,0,1",
    "Style: Shape,Poppins ExtraBold,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const ev = (layer: number, s: number, e: number, style: string, text: string) => {
    if (e - s > 0.02) lines.push(`Dialogue: ${layer},${assTime(s)},${assTime(e)},${style},,0,0,0,,${text}`);
  };

  // ── Ouverture : image assombrie, sur-titre, titre, puis éclair blanc vers le premier moment ──
  if (timeline.intro > 0) {
    const end = timeline.intro;
    ev(0, 0, end, "Shape", `{\\an7\\pos(0,0)\\bord0\\shad0\\c&H000000&\\1a&H70&\\p1}${RECT(CW, CH)}`);
    const kicker = cleanBurnText(input.introKicker).toUpperCase();
    if (kicker) ev(2, 0.1, end, "Kicker", `{\\an5\\pos(${CW / 2},${CH / 2 - 170})\\c${hi}\\fad(150,0)}${kicker}`);
    const title = wrapLines(cleanBurnText(input.introTitle).toUpperCase(), 30, 3).join("\\N");
    if (title) ev(2, 0.15, end, "Title", `{\\an5\\pos(${CW / 2},${CH / 2 + 40})\\fscx85\\fscy85\\t(0,180,\\fscx100\\fscy100)\\fad(150,0)}${title}`);
    ev(6, end, end + 0.3, "Shape", `{\\an7\\pos(0,0)\\bord0\\shad0\\c&HFFFFFF&\\1a&H30&\\t(0,280,\\1a&HFF&)\\p1}${RECT(CW, CH)}`);
  }

  input.moments.forEach((m, i) => {
    const slot = timeline.moments[i];
    if (!slot) return;
    const start = slot.at;
    const end = slot.at + slot.duration;

    // ── Repère : numéro dans une pastille aux couleurs de la marque + titre du moment, en bas à gauche ──
    const mEnd = Math.min(end - DIP_SEC, start + MARKER_SEC);
    const label = wrapLines(cleanBurnText(m.label).toUpperCase(), 34, 2);
    const baseY = 860;
    ev(3, start + 0.15, mEnd, "Shape", `{\\an7\\move(10,${baseY - 75},70,${baseY - 75},0,220)\\bord0\\shad0\\c${hi}\\fad(120,200)\\p1}${RECT(170, 150)}`);
    ev(4, start + 0.15, mEnd, "Number", `{\\an5\\move(95,${baseY},155,${baseY},0,220)\\fad(120,200)}#${m.number}`);
    if (label.length) {
      ev(4, start + 0.3, mEnd, "Label", `{\\an4\\move(220,${baseY},270,${baseY},0,240)\\fad(160,200)}${label.join("\\N")}`);
    }

    // ── Crédit du streamer, discret en haut à droite pendant tout le moment ──
    const credit = cleanBurnText(m.credit);
    if (credit) ev(1, start + 0.2, end - DIP_SEC, "Credit", `{\\an9\\pos(${CW - 48},40)\\fad(200,150)}${credit}`);

    // ── Sous-titres : paquets d'une ligne (format long : on lit des phrases, pas des mots qui sautent) ──
    if (!input.captions || !m.words.length) return;
    const emph = new Set(m.emphasis.map(normWord).filter(Boolean));
    const words = m.words
      .map((w) => ({ w: cleanBurnText(w.w), s: Math.max(start, w.s), e: Math.min(end - DIP_SEC, Math.max(w.e, w.s + 0.05)) }))
      .filter((w) => w.w && w.e > w.s);
    for (const chunk of chunkWords(words, 9, 44)) {
      // Le repère (en bas à gauche, au-dessus) et les sous-titres (en bas, centrés) ne se chevauchent pas.
      const text = chunk.words.map((x) => (emph.has(normWord(x.w)) ? `{\\c${hi}}${x.w}{\\c&HFFFFFF&}` : x.w)).join(" ");
      ev(2, chunk.start, Math.min(chunk.end, end - DIP_SEC), "Sub", text);
    }
  });

  // ── Carton de fin : image figée assombrie + remerciements aux streamers ──
  if (timeline.outro > 0) {
    const s = timeline.outroAt;
    const e = timeline.total;
    ev(7, s, e, "Shape", `{\\an7\\pos(0,0)\\bord0\\shad0\\c&H000000&\\1a&HFF&\\t(0,300,\\1a&H48&)\\p1}${RECT(CW, CH)}`);
    ev(8, s + 0.15, e, "Title", `{\\an5\\pos(${CW / 2},${CH / 2 - 70})\\fad(200,0)}MERCI D'AVOIR REGARDÉ`);
    const names = input.outroCredits.map(cleanBurnText).filter(Boolean);
    if (names.length) {
      const list = wrapLines(names.join(" · "), 60, 2).join("\\N");
      ev(8, s + 0.35, e, "Small", `{\\an5\\pos(${CW / 2},${CH / 2 + 80})\\fad(200,0)}Streamers : {\\c${hi}}${list}{\\c&HFFFFFF&}\\NLiens vers leurs chaînes dans la description`);
    }
  }
  return lines.join("\n") + "\n";
}

// ───────────────────────── Miniature 1280×720 ─────────────────────────

/** Coupe en lignes de longueurs proches (pas de mot orphelin sur la dernière ligne), au plus `maxLines`. */
export function balancedLines(text: string, maxChars: number, maxLines: number): string[] {
  for (let n = 1; n <= maxLines; n++) {
    const width = Math.max(Math.ceil(text.length / n) + 2, ...text.split(" ").map((w) => w.length));
    const lines = wrapLines(text, Math.min(width, maxChars), maxLines + 1);
    if (lines.length <= n && lines.every((l) => l.length <= maxChars)) return lines;
  }
  return wrapLines(text, maxChars, maxLines);
}

export function buildThumbAss(text: string, kicker: string, highlight: string): string {
  const hi = assColor(highlight);
  const lines = balancedLines(cleanBurnText(text).toUpperCase(), 13, 3);
  const size = lines.length >= 3 ? 118 : 140;
  const out = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${THUMB_W}`,
    `PlayResY: ${THUMB_H}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Big,Anton,${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,1,0,1,10,6,1,60,60,60,1`,
    "Style: Kick,Anton,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,1,0,1,0,0,7,0,0,0,1",
    "Style: Shape,Anton,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const ev = (layer: number, style: string, t: string) => out.push(`Dialogue: ${layer},0:00:00.00,0:00:10.00,${style},,0,0,0,,${t}`);
  // Dégradé sombre à gauche pour que le texte se détache de n'importe quelle image.
  for (let i = 0; i < 8; i++) {
    const alpha = Math.round(0x40 + i * 0x18).toString(16).toUpperCase().padStart(2, "0");
    ev(0, "Shape", `{\\an7\\pos(${i * 100},0)\\bord0\\shad0\\c&H000000&\\1a&H${alpha}&\\p1}${RECT(100, THUMB_H)}`);
  }
  // Mise en valeur de la dernière ligne (souvent le nom ou le chiffre) dans la couleur de la marque.
  const body = lines.map((l, i) => (i === lines.length - 1 && lines.length > 1 ? `{\\c${hi}}${l}{\\c&HFFFFFF&}` : l)).join("\\N");
  if (body) ev(2, "Big", `{\\an1\\pos(60,${THUMB_H - 50})}${body}`);
  const k = cleanBurnText(kicker).toUpperCase();
  if (k) {
    const w = Math.max(140, Math.round(k.length * 27 + 50));
    ev(1, "Shape", `{\\an7\\pos(48,44)\\bord0\\shad0\\c${hi}\\p1}${RECT(w, 92)}`);
    ev(2, "Kick", `{\\an7\\pos(72,52)}${k}`);
  }
  return out.join("\n") + "\n";
}

/** Miniature : image du moment le plus fort, contrastée, avec un texte court. JPEG bien sous la limite de 2 Mo de YouTube. */
export async function renderThumbnail(opts: { source: string; atSec: number; cwd: string; assFile: string; out: string }): Promise<void> {
  const vf =
    `scale=${THUMB_W}:${THUMB_H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${THUMB_W}:${THUMB_H},` +
    `eq=contrast=1.12:saturation=1.3:brightness=0.02,unsharp=5:5:0.6,setsar=1,` +
    `ass=filename=${escFilterArg(opts.assFile)}:fontsdir=${escFilterArg(FONTS_DIR)}`;
  await runOk(
    env.bin.ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-y", "-ss", f3(opts.atSec), "-i", opts.source, "-frames:v", "1", "-vf", vf, "-q:v", "3", opts.out],
    { cwd: opts.cwd, timeoutMs: 120_000 },
  );
}
