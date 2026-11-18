/** Mot transcrit : texte + début/fin en secondes. */
export interface Word {
  w: string;
  s: number;
  e: number;
}

export interface CaptionLayout {
  /** Centre vertical des sous-titres */
  captionY: number;
  /** Centre vertical du titre d'accroche */
  hookY: number;
  /** Durée d'affichage de l'accroche (secondes) ; null = tout le clip */
  hookDuration: number | null;
  credit: { x: number; y: number; an: number };
}

export interface AssInput {
  duration: number;
  /** Mots déjà recalés sur le début du clip (0 = première image du clip) */
  words: Word[];
  hook?: string;
  credit?: string;
  font: string;
  /** Couleur du mot en cours, #RRGGBB */
  highlight: string;
  layout: CaptionLayout;
}

export const OUT_W = 1080;
export const OUT_H = 1920;

/** Emplacements des textes selon le template (en pixels, image 1080×1920). */
export function layoutFor(template: "BLUR" | "FULL" | "FACECAM", bandHeight: number): CaptionLayout {
  if (template === "BLUR") {
    const top = Math.round((OUT_H - bandHeight) / 2);
    const bottom = top + bandHeight;
    return {
      // Sous la bande de gameplay, sans descendre dans la zone masquée par l'interface TikTok/Shorts.
      captionY: Math.min(bottom + 120, 1500),
      hookY: Math.max(300, Math.round((210 + top) / 2)),
      hookDuration: null,
      credit: { x: 40, y: Math.max(top - 14, 250), an: 1 },
    };
  }
  if (template === "FACECAM") {
    return { captionY: 690, hookY: 1400, hookDuration: 4, credit: { x: 36, y: 190, an: 7 } };
  }
  return { captionY: 1380, hookY: 340, hookDuration: null, credit: { x: 36, y: 190, an: 7 } };
}

/** #RRGGBB → &HBBGGRR& (ordre des couleurs ASS) */
function assColor(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "&H00E6FF&";
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

/**
 * Nettoie un texte destiné à être incrusté : pas d'accolades ni d'antislash (syntaxe ASS),
 * pas d'emoji (les polices d'incrustation n'en contiennent pas).
 */
export function cleanBurnText(text: string): string {
  return text
    .replace(/[{}\\]/g, "")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Coupe un titre en lignes équilibrées (\N = retour à la ligne ASS). */
export function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1]!.replace(/[\s.,;:!?-]*$/, "") + "…";
    return kept;
  }
  return lines;
}

interface Chunk {
  words: Word[];
  start: number;
  end: number;
}

/** Regroupe les mots par paquets de 1 à 3 (lisible d'un coup d'œil sur mobile). */
export function chunkWords(words: Word[], maxWords = 3, maxChars = 16): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) chunks.push({ words: cur, start: cur[0]!.s, end: cur[cur.length - 1]!.e });
    cur = [];
  };
  for (const word of words) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const len = cur.reduce((n, x) => n + x.w.length + 1, 0) + word.w.length;
      const pause = word.s - prev.e > 0.6;
      const sentenceEnd = /[.!?…]$/.test(prev.w);
      if (cur.length >= maxWords || len > maxChars || pause || sentenceEnd) flush();
    }
    cur.push(word);
  }
  flush();
  // Un paquet reste affiché jusqu'au suivant s'il arrive vite, sinon disparaît peu après son dernier mot.
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]!;
    const next = chunks[i + 1];
    c.end = next && next.start - c.end < 0.4 ? next.start : c.end + 0.2;
    if (c.end - c.start < 0.25) c.end = c.start + 0.25;
    if (next && c.end > next.start) c.end = next.start;
  }
  return chunks;
}

export function buildAss(input: AssInput): string {
  const { layout } = input;
  const hi = assColor(input.highlight);
  const hookFont = "Anton";
  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${OUT_W}`,
    `PlayResY: ${OUT_H}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${input.font},${input.font === "Anton" ? 96 : 80},&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,0,0,0,0,100,100,0,0,1,7,3,5,50,50,0,1`,
    `Style: Hook,${hookFont},88,&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,0,0,0,0,100,100,1,0,1,7,3,5,60,60,0,1`,
    `Style: Credit,Poppins ExtraBold,30,&H28FFFFFF,&H28FFFFFF,&H50000000,&H78000000,0,0,0,0,100,100,0,0,1,2,1,7,0,0,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const event = (layer: number, s: number, e: number, style: string, text: string) =>
    lines.push(`Dialogue: ${layer},${assTime(s)},${assTime(e)},${style},,0,0,0,,${text}`);

  const credit = input.credit ? cleanBurnText(input.credit) : "";
  if (credit) {
    event(0, 0, input.duration, "Credit", `{\\an${layout.credit.an}\\pos(${layout.credit.x},${layout.credit.y})}${credit}`);
  }

  const hook = input.hook ? cleanBurnText(input.hook).toUpperCase() : "";
  if (hook) {
    const wrapped = wrapLines(hook, 22, 3).join("\\N");
    const end = layout.hookDuration ? Math.min(input.duration, layout.hookDuration) : input.duration;
    event(1, 0, end, "Hook", `{\\an5\\pos(${OUT_W / 2},${layout.hookY})\\fad(120,${layout.hookDuration ? 200 : 0})}${wrapped}`);
  }

  const words = input.words
    .map((x) => ({ w: cleanBurnText(x.w).toUpperCase(), s: x.s, e: Math.max(x.e, x.s + 0.05) }))
    .filter((x) => x.w && x.e > 0 && x.s < input.duration)
    .map((x) => ({ ...x, s: Math.max(0, x.s), e: Math.min(input.duration, x.e) }));

  for (const chunk of chunkWords(words)) {
    chunk.words.forEach((word, i) => {
      const from = i === 0 ? chunk.start : word.s;
      const next = chunk.words[i + 1];
      const to = next ? next.s : chunk.end;
      if (to - from < 0.02) return;
      const text = chunk.words
        .map((x, j) => (j === i ? `{\\c${hi}}${x.w}{\\c&HFFFFFF&}` : x.w))
        .join(" ");
      // Petit effet « pop » à l'apparition du paquet.
      const pop = i === 0 ? "\\fscx88\\fscy88\\t(0,90,\\fscx100\\fscy100)" : "";
      event(2, from, to, "Caption", `{\\an5\\pos(${OUT_W / 2},${layout.captionY})${pop}}${text}`);
    });
  }
  return lines.join("\n") + "\n";
}
