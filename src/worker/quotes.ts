import { normWord, type Word } from "./render/captions";

/**
 * Citations : les phrases réellement prononcées par le streamer, classées pour servir d'accroche et de titre
 * quand l'IA n'est pas configurée. Rien n'est inventé ni reformulé : on choisit une phrase, on ne l'écrit pas.
 */

export interface Quote {
  text: string;
  start: number;
  end: number;
  score: number;
}

/** Phrases que Whisper invente sur du silence ou de la musique (génériques de sous-titrage) : jamais citées. */
export const WHISPER_HALLUCINATIONS =
  /amara\.org|sous-titr|merci d'avoir regard|abonnez-vous|n'oubliez pas de (vous abonner|liker)|thanks for watching|subtitles by/i;

/** Mots qui ne disent rien seuls (interjections, appels au chat) : une citation doit contenir au moins 2 autres mots. */
const FILLER = new Set(
  [
    "oh", "ah", "eh", "euh", "hein", "bah", "ben", "beh", "bon", "wesh", "wouaw", "waouh", "wouah", "wow", "ouah", "oula", "olala",
    "non", "oui", "ouais", "mais", "putain", "merde", "les", "gars", "frerot", "frere", "mec", "ok", "okay", "d'accord", "attends",
    "attendez", "allez", "vas", "y", "quoi", "la", "et", "alors", "genre", "voila", "hop", "oups", "aie",
  ].map(normWord),
);

/** Insultes : jamais en gros sur la vidéo ni dans le titre. */
const INSULTS = /\b(conn?ar[dt]s?|connasses?|putes?|salopes?|encul[ée]s?|fdp|ntm|b[aâ]tards?|pd|n[eè]gres?|tapettes?|gogoles?|mongols?|attard[ée]s?)\b/i;

/** Grossièretés : pas en gros sur la vidéo non plus (TikTok et YouTube peuvent limiter la diffusion d'un texte vulgaire). */
const VULGAR = /\b(couilles?|bites?|chattes?|niqu\w*|bais\w*|branl\w*)\b/i;

/** Mots qui font la chute ou l'enjeu : une phrase qui en contient retient mieux. */
const PUNCH = new Set(
  ["dingue", "fou", "folle", "ouf", "malade", "incroyable", "jamais", "secret", "secrete", "impossible", "record", "enorme", "millions",
    "million", "mort", "gagne", "perdu", "trouve", "police", "vole", "explose", "rage", "pire", "meilleur", "meilleure", "premier", "premiere"].map(normWord),
);

/** Mots qui commencent une phrase : avec une majuscule, ils marquent une nouvelle phrase même sans ponctuation ni pause. */
const STARTERS = new Set(
  [
    "je", "j'", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "ca", "c'est", "c'etait", "mais", "et", "donc", "alors", "oh",
    "ah", "non", "oui", "ouais", "attends", "attendez", "regarde", "regardez", "combien", "pourquoi", "comment", "qui", "quoi", "ou",
    "quand", "le", "la", "les", "un", "une", "ce", "cette", "y'a", "moi", "toi", "putain", "allez", "bon", "bah", "ben", "euh", "wesh",
  ].map(normWord),
);

const startsUpper = (w: string) => /^\p{Lu}/u.test(w);

const MAX_WORDS = 8;
const MAX_CHARS = 48;

const isPunct = (w: string) => /^[\p{P}\p{S}]+$/u.test(w);

/** Découpe la transcription en phrases : ponctuation finale, ou silence de plus de 0,7 s entre deux mots. */
export function sentences(words: Word[]): Array<{ words: Word[] }> {
  const out: Array<{ words: Word[] }> = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) out.push({ words: cur });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    // Whisper ne ponctue pas toujours : une pause, ou une majuscule en début de phrase, en marque aussi la fin.
    if (prev && !isPunct(w.w)) {
      const gap = w.s - prev.e;
      const capital = startsUpper(w.w) && (gap > 0.25 || STARTERS.has(normWord(w.w)) || /^\p{Lu}'/u.test(w.w));
      if (gap > 0.6 || capital) flush();
    }
    cur.push(w);
    if (/[.!?…]["»”]?$/.test(w.w)) flush();
  }
  flush();
  // Une phrase trop longue pour une accroche peut contenir une proposition qui tient seule (« …, moi ça me dérange pas »).
  const parts: Array<{ words: Word[] }> = [];
  for (const s of out) {
    const n = s.words.filter((w) => !isPunct(w.w)).length;
    if (n <= MAX_WORDS) {
      parts.push(s);
      continue;
    }
    let clause: Word[] = [];
    for (const w of s.words) {
      clause.push(w);
      if (/,$/.test(w.w)) {
        parts.push({ words: clause });
        clause = [];
      }
    }
    if (clause.length) parts.push({ words: clause });
  }
  return parts;
}

/** Texte d'une phrase, typographie française : espace insécable avant ? et !, pas de point final. */
export function sentenceText(words: Word[]): string {
  let text = words
    .map((w) => w.w)
    .join(" ")
    .replace(/\s+([,.;:!?…])/g, "$1")
    .replace(/[,;:]+$/, "")
    .replace(/\.+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  text = text.replace(/\s*([!?]+)/g, " $1");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Les meilleures citations de l'extrait [start, end], la meilleure en premier.
 * Critères : proche du moment fort, courte (lisible en une seconde), avec du sens (pas que des interjections),
 * une exclamation, une question ou un mot qui fait la chute ; jamais d'insulte ni de phrase inventée par Whisper.
 */
export function pickQuotes(words: Word[], opts: { start: number; end: number; peak: number }, max = 3): Quote[] {
  const inWindow = words.filter((w) => w.e > opts.start && w.s < opts.end);
  const out: Quote[] = [];
  const seen = new Set<string>();
  for (const s of sentences(inWindow)) {
    const text = sentenceText(s.words);
    const tokens = s.words.filter((w) => !isPunct(w.w)).map((w) => normWord(w.w)).filter(Boolean);
    if (tokens.length < 2 || tokens.length > MAX_WORDS || text.length > MAX_CHARS) continue;
    // Un mot masqué par Whisper (« b***h ») ou mal entendu n'a rien à faire dans une accroche.
    if (WHISPER_HALLUCINATIONS.test(text) || INSULTS.test(text) || VULGAR.test(text) || /\*/.test(text)) continue;
    const meaningful = tokens.filter((t) => !FILLER.has(t));
    if (meaningful.length < 2) continue;
    const key = tokens.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);

    const start = s.words[0]!.s;
    const end = s.words[s.words.length - 1]!.e;
    const dist = Math.abs((start + end) / 2 - opts.peak);
    let score = Math.max(0, 1 - dist / 15);
    if (/!/.test(text)) score += 0.3;
    if (/\?/.test(text)) score += 0.25;
    // Lisible en une seconde : 3 à 6 mots, c'est l'idéal ; 7 ou 8, ça passe encore.
    if (tokens.length >= 3) score += tokens.length <= 6 ? 0.3 : 0.2;
    if (meaningful.length >= 3) score += 0.1;
    if (tokens.some((t) => PUNCH.has(t))) score += 0.2;
    // Un nom propre (personnage, lieu, joueur) rend la phrase précise à cet extrait.
    // (le premier mot ne compte pas : Whisper met toujours une majuscule en début de phrase).
    if (s.words.slice(1).some((w) => startsUpper(w.w) && !STARTERS.has(normWord(w.w)) && !/^\p{Lu}'/u.test(w.w))) score += 0.15;
    if (tokens.includes("putain") || tokens.includes("merde")) score -= 0.15;
    out.push({ text, start, end, score: Math.round(score * 100) / 100 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

/** « Quote » avec des espaces insécables : le guillemet ne se retrouve jamais seul en bout de ligne. */
export function quoted(text: string): string {
  return `« ${text} »`;
}

/** Emoji d'appoint d'un titre, d'après ce que dit la phrase (jamais plus d'un). */
export function quoteEmoji(text: string): string {
  const t = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/\b(mdr|ptdr|haha\w*|jpp)\b/.test(t)) return "😂";
  if (/\b(dingue|fou|folle|ouf|malade|incroyable|secret|secrete)\b/.test(t)) return "🤯";
  if (/\?/.test(text)) return "🤔";
  if (/!/.test(text)) return "😱";
  return "👀";
}
