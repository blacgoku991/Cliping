import { CAPTION_STYLE_KEYS } from "@/lib/settings";

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

// ───────────────────────── Styles de sous-titres ─────────────────────────

export const CAPTION_STYLES = CAPTION_STYLE_KEYS;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

interface StyleDef {
  /** Police ; null = celle choisie dans les réglages (style Classique) */
  font: string | null;
  size: number;
  upper: boolean;
  /** « word » : un évènement par mot (mot prononcé mis en valeur) ; « line » : un évènement par paquet */
  mode: "word" | "line";
  maxWords: number;
  maxChars: number;
  borderStyle: 1 | 3;
  outline: number;
  shadow: number;
  /** Couleur de contour / fond de boîte, format ASS &HAABBGGRR */
  outlineColour: string;
  /** Mot prononcé en couleur */
  activeColor: boolean;
  /** Agrandissement des mots forts (%) */
  emphScale: number;
  /** Petit effet d'apparition (échelle de départ en %, 100 = aucun) */
  popFrom: number;
}

const STYLES: Record<CaptionStyle, StyleDef> = {
  classic: { font: null, size: 80, upper: true, mode: "word", maxWords: 3, maxChars: 16, borderStyle: 1, outline: 7, shadow: 3, outlineColour: "&H00000000", activeColor: true, emphScale: 115, popFrom: 88 },
  impact: { font: "Anton", size: 150, upper: true, mode: "word", maxWords: 2, maxChars: 9, borderStyle: 1, outline: 10, shadow: 4, outlineColour: "&H00000000", activeColor: false, emphScale: 125, popFrom: 70 },
  boxed: { font: "Poppins ExtraBold", size: 64, upper: false, mode: "word", maxWords: 4, maxChars: 22, borderStyle: 3, outline: 16, shadow: 0, outlineColour: "&H30101010", activeColor: true, emphScale: 100, popFrom: 100 },
  karaoke: { font: "Poppins ExtraBold", size: 70, upper: true, mode: "line", maxWords: 6, maxChars: 26, borderStyle: 1, outline: 6, shadow: 2, outlineColour: "&H00000000", activeColor: true, emphScale: 112, popFrom: 100 },
  minimal: { font: "Poppins ExtraBold", size: 60, upper: false, mode: "line", maxWords: 7, maxChars: 30, borderStyle: 1, outline: 3, shadow: 2, outlineColour: "&H40000000", activeColor: false, emphScale: 100, popFrom: 100 },
};

export function isCaptionStyle(v: unknown): v is CaptionStyle {
  return typeof v === "string" && (CAPTION_STYLES as readonly string[]).includes(v);
}

export interface EndCard {
  /** Appel à l'action, ex. « Abonne-toi pour la suite » */
  title: string;
  /** Crédit du streamer, ex. « twitch.tv/inox » ; vide = rien */
  credit: string;
  /** Durée du carton (secondes) */
  duration: number;
}

export interface AssInput {
  /** Durée du montage (sans le carton de fin) */
  duration: number;
  /** Mots déjà recalés sur la vidéo finale (0 = première image du clip) */
  words: Word[];
  hook?: string;
  credit?: string;
  /** Police du style Classique */
  font: string;
  /** Couleur de mise en valeur, #RRGGBB */
  highlight: string;
  layout: CaptionLayout;
  style?: CaptionStyle;
  /** Mots forts à mettre en valeur (comparés sans accents ni ponctuation) */
  emphasis?: string[];
  /** Instants où un nouveau sous-titre doit commencer (coupes du montage) */
  breaks?: number[];
  progressBar?: boolean;
  /** Flash blanc à cet instant (retour au début après le cold open) */
  flashAt?: number | null;
  endCard?: EndCard | null;
}

export const OUT_W = 1080;
export const OUT_H = 1920;

/**
 * Zone sûre commune à TikTok et YouTube Shorts (image 1080×1920) : en dehors, les textes passent sous
 * l'interface des applis (onglets et bouton LIVE en haut, colonne de boutons à droite, légende,
 * pseudo et son en bas). On retient le plus contraignant des deux :
 * haut 220 px, bas 480 px (rien sous y = 1440), droite 170 px, gauche 60 px.
 */
export const SAFE_ZONE = { top: 220, bottom: 1440, left: 60, right: OUT_W - 170 } as const;
/** Marges de retour à la ligne des textes (largeur utile 820 px) */
const SAFE_MARGIN_L = 90;
const SAFE_MARGIN_R = 170;
/** Les textes sont centrés sur la largeur utile, donc légèrement à gauche du centre de l'image. */
export const SAFE_CENTER_X = Math.round((SAFE_MARGIN_L + OUT_W - SAFE_MARGIN_R) / 2);

/** Emplacements des textes selon le template (en pixels, image 1080×1920), tous dans la zone sûre. */
export function layoutFor(template: "BLUR" | "FULL" | "FACECAM", bandHeight: number): CaptionLayout {
  if (template === "BLUR") {
    const top = Math.round((OUT_H - bandHeight) / 2);
    const bottom = top + bandHeight;
    return {
      // Juste sous la bande de gameplay, ou sur son bas quand elle descend trop : jamais sous la zone sûre.
      captionY: Math.min(bottom + 90, 1340),
      hookY: Math.max(360, Math.round((210 + top) / 2)),
      hookDuration: null,
      credit: { x: 64, y: Math.max(top - 14, 260), an: 1 },
    };
  }
  if (template === "FACECAM") {
    return { captionY: 690, hookY: 1300, hookDuration: 4, credit: { x: 64, y: 240, an: 7 } };
  }
  return { captionY: 1300, hookY: 380, hookDuration: null, credit: { x: 64, y: 240, an: 7 } };
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
    // Les espaces insécables restent (« citation » : le guillemet ne part pas seul à la ligne).
    .replace(/[^\S\u00A0]+/g, " ")
    .trim();
}

/** Forme de comparaison d'un mot : minuscules, sans accents ni ponctuation. */
export function normWord(w: string): string {
  return w
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']/gu, "")
    .replace(/^'+|'+$/g, "");
}

/** Mots qui claquent dans un clip gaming, utilisés quand l'IA ne propose rien. */
const STRONG_WORDS = new Set(
  [
    "non", "quoi", "jamais", "incroyable", "fou", "folle", "dingue", "ouf", "mort", "morts", "tue", "gg", "wtf", "omg", "wow",
    "oh", "ah", "attends", "regarde", "frerot", "enorme", "impossible", "direct", "boom", "go", "vas", "cours", "vite", "pardon",
    "no", "what", "insane", "crazy", "dead", "wait", "look", "never", "huge", "bro", "run", "nooo", "noooon", "jpp", "mdr", "ptdr",
  ].map(normWord),
);

/** Mots forts par défaut : liste d'exclamations, nombres, mots criés (MAJUSCULES ou « ! »). */
export function defaultEmphasis(words: Word[]): string[] {
  const out = new Set<string>();
  for (const { w } of words) {
    const n = normWord(w);
    if (!n) continue;
    if (STRONG_WORDS.has(n) || /^\d+$/.test(n) || /!$/.test(w.trim()) || (w.replace(/[^\p{L}]/gu, "").length >= 3 && w === w.toUpperCase())) out.add(n);
  }
  return [...out].slice(0, 30);
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

/**
 * Regroupe les mots par paquets (1 à 3 par défaut : lisible d'un coup d'œil sur mobile).
 * `breaks` : instants qui forcent un nouveau paquet (coupes du montage).
 */
export function chunkWords(words: Word[], maxWords = 3, maxChars = 16, breaks: number[] = []): Chunk[] {
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
      const cut = breaks.some((b) => prev.s < b - 1e-6 && word.s >= b - 1e-6);
      if (cur.length >= maxWords || len > maxChars || pause || sentenceEnd || cut) flush();
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

const RECT = (w: number, h: number) => `m 0 0 l ${w} 0 ${w} ${h} 0 ${h}`;

export function buildAss(input: AssInput): string {
  const { layout } = input;
  const styleName: CaptionStyle = input.style ?? "classic";
  const st = STYLES[styleName];
  const hi = assColor(input.highlight);
  const white = "&HFFFFFF&";
  const capFont = st.font ?? input.font;
  const capSize = st.font ? st.size : input.font === "Anton" ? 96 : 80;
  const endAt = input.duration;
  const total = input.duration + (input.endCard?.duration ?? 0);
  // Karaoké : la couleur « principale » est celle des mots déjà prononcés, la « secondaire » celle des mots à venir.
  const capPrimary = styleName === "karaoke" ? `&H00${hi.slice(2, 8)}` : "&H00FFFFFF";
  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${OUT_W}`,
    `PlayResY: ${OUT_H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${capFont},${capSize},${capPrimary},&H00FFFFFF,${st.outlineColour},&H78000000,0,0,0,0,100,100,0,0,${st.borderStyle},${st.outline},${st.shadow},5,${SAFE_MARGIN_L},${SAFE_MARGIN_R},0,1`,
    `Style: Hook,Anton,88,&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,0,0,0,0,100,100,1,0,1,7,3,5,${SAFE_MARGIN_L},${SAFE_MARGIN_R},0,1`,
    `Style: Credit,Poppins ExtraBold,30,&H28FFFFFF,&H28FFFFFF,&H50000000,&H78000000,0,0,0,0,100,100,0,0,1,2,1,7,0,0,0,1`,
    `Style: Shape,Poppins ExtraBold,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: CardTitle,Anton,118,&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,0,0,0,0,100,100,1,0,1,8,3,5,${SAFE_MARGIN_L},${SAFE_MARGIN_R},0,1`,
    `Style: CardSub,Poppins ExtraBold,50,&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,0,0,0,0,100,100,0,0,1,4,2,5,${SAFE_MARGIN_L},${SAFE_MARGIN_R},0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const event = (layer: number, s: number, e: number, style: string, text: string) =>
    lines.push(`Dialogue: ${layer},${assTime(s)},${assTime(e)},${style},,0,0,0,,${text}`);

  const credit = input.credit ? cleanBurnText(input.credit) : "";
  if (credit) {
    event(0, 0, endAt, "Credit", `{\\an${layout.credit.an}\\pos(${layout.credit.x},${layout.credit.y})}${credit}`);
  }

  const hook = input.hook ? cleanBurnText(input.hook).toUpperCase() : "";
  if (hook) {
    const wrapped = wrapLines(hook, 22, 3).join("\\N");
    const end = layout.hookDuration ? Math.min(endAt, layout.hookDuration) : endAt;
    event(1, 0, end, "Hook", `{\\an5\\pos(${SAFE_CENTER_X},${layout.hookY})\\fad(120,${layout.hookDuration ? 200 : 0})}${wrapped}`);
  }

  // ── Sous-titres ──
  const emph = new Set((input.emphasis ?? []).map(normWord).filter(Boolean));
  // Ponctuation transcrite comme un mot à part (« incroyable » « ! ») : on la recolle au mot précédent.
  const glued: Word[] = [];
  for (const x of [...input.words].sort((a, b) => a.s - b.s)) {
    const prev = glued[glued.length - 1];
    if (prev && !/[\p{L}\p{N}]/u.test(x.w) && x.s - prev.e < 1) {
      glued[glued.length - 1] = { ...prev, w: `${prev.w}${/^[!?:;»]/.test(x.w.trim()) ? " " : ""}${x.w.trim()}`, e: Math.max(prev.e, x.e) };
    } else glued.push(x);
  }
  const words = glued
    .map((x) => {
      const clean = cleanBurnText(x.w);
      return { w: st.upper ? clean.toUpperCase() : clean, s: x.s, e: Math.max(x.e, x.s + 0.05), strong: emph.has(normWord(x.w)) };
    })
    .filter((x) => x.w && x.e > 0 && x.s < endAt)
    .map((x) => ({ ...x, s: Math.max(0, x.s), e: Math.min(endAt, x.e) }));
  const strongAt = new Map(words.map((x) => [x as Word, x.strong]));
  const isStrong = (w: Word) => strongAt.get(w) === true;

  /** Balises d'un mot : couleur et taille fixées explicitement (pas de \r, qui casserait l'animation). */
  const tagged = (text: string, color: string, scale: number, pop: boolean, extra = "") => {
    const from = pop ? Math.round((scale * st.popFrom) / 100) : scale;
    const anim = from !== scale ? `\\t(0,90,\\fscx${scale}\\fscy${scale})` : "";
    return `{\\c${color}\\fscx${from}\\fscy${from}${anim}${extra}}${text}`;
  };
  const pos = `\\an5\\pos(${SAFE_CENTER_X},${layout.captionY})`;

  for (const chunk of chunkWords(words, st.maxWords, st.maxChars, input.breaks ?? [])) {
    if (st.mode === "line") {
      // Un seul évènement pour le paquet.
      let text: string;
      if (styleName === "karaoke") {
        let t = chunk.start;
        text = chunk.words
          .map((x) => {
            const gap = Math.max(0, Math.round((x.s - t) * 100));
            const dur = Math.max(1, Math.round((x.e - Math.max(x.s, t)) * 100));
            t = x.e;
            const scale = isStrong(x) ? st.emphScale : 100;
            return `${gap ? `{\\k${gap}}` : ""}{\\kf${dur}\\fscx${scale}\\fscy${scale}}${x.w}`;
          })
          .join(" ");
      } else {
        text = chunk.words.map((x) => (isStrong(x) ? `{\\c${hi}}${x.w}{\\c${white}}` : x.w)).join(" ");
      }
      const fade = styleName === "minimal" ? "\\fad(80,60)" : "";
      event(2, chunk.start, chunk.end, "Caption", `{${pos}${fade}}${text}`);
      continue;
    }
    chunk.words.forEach((word, i) => {
      const from = i === 0 ? chunk.start : word.s;
      const next = chunk.words[i + 1];
      const to = next ? next.s : chunk.end;
      if (to - from < 0.02) return;
      const text = chunk.words
        .map((x, j) => {
          const active = j === i;
          const strong = isStrong(x);
          const color = (active && st.activeColor) || strong ? hi : white;
          const scale = strong ? st.emphScale : 100;
          // Apparition : tout le paquet au premier mot ; en Impact, chaque mot « tombe ».
          const pop = styleName === "impact" ? active : i === 0;
          const tilt = styleName === "impact" ? (strong && active ? "\\frz-3" : "\\frz0") : "";
          return tagged(x.w, color, scale, pop, tilt);
        })
        .join(" ");
      event(2, from, to, "Caption", `{${pos}}${text}`);
    });
  }

  // ── Barre de progression : fine, en haut, remplie en continu sur toute la durée ──
  if (input.progressBar && endAt > 1) {
    const ms = Math.round(endAt * 1000);
    event(4, 0, endAt, "Shape", `{\\an7\\pos(0,0)\\bord0\\shad0\\c&H000000&\\1a&H90&\\p1}${RECT(OUT_W, 12)}`);
    event(5, 0, endAt, "Shape", `{\\an7\\pos(0,0)\\bord0\\shad0\\c${hi}\\1a&H10&\\fscx0\\t(0,${ms},\\fscx100)\\p1}${RECT(OUT_W, 12)}`);
  }

  // ── Flash blanc au retour au début (après le cold open) ──
  if (input.flashAt && input.flashAt > 0 && input.flashAt < endAt) {
    event(6, input.flashAt, Math.min(endAt, input.flashAt + 0.3), "Shape", `{\\an7\\pos(0,0)\\bord0\\shad0\\c&HFFFFFF&\\1a&H30&\\t(0,280,\\1a&HFF&)\\p1}${RECT(OUT_W, OUT_H)}`);
  }

  // ── Carton de fin : image figée assombrie + appel à l'action + crédit ──
  if (input.endCard && input.endCard.duration > 0) {
    const c = input.endCard;
    event(7, endAt, total, "Shape", `{\\an7\\pos(0,0)\\bord0\\shad0\\c&H000000&\\1a&HFF&\\t(0,250,\\1a&H50&)\\p1}${RECT(OUT_W, OUT_H)}`);
    const title = wrapLines(cleanBurnText(c.title).toUpperCase(), 14, 3).join("\\N");
    if (title) {
      event(8, endAt + 0.1, total, "CardTitle", `{\\an5\\pos(${SAFE_CENTER_X},${OUT_H / 2 - 90})\\fscx80\\fscy80\\t(0,140,\\fscx100\\fscy100)\\fad(120,0)}${title}`);
    }
    const cred = cleanBurnText(c.credit);
    if (cred) {
      event(8, endAt + 0.25, total, "CardSub", `{\\an5\\pos(${SAFE_CENTER_X},${OUT_H / 2 + 130})\\fad(150,0)}Clip : {\\c${hi}}${cred}`);
    }
  }
  return lines.join("\n") + "\n";
}
