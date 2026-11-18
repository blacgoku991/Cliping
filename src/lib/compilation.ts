/**
 * Compilations « best-of » : logique pure partagée par le site et le worker (aucun accès à la base ni à ffmpeg),
 * couverte par tests/compilation.test.ts.
 *
 * Une compilation met bout à bout des moments (la fenêtre [startSec, endSec] de clips existants, prise dans leur
 * source 16:9) : ouverture facultative, puis les moments dans l'ordre choisi, puis un court carton de fin.
 */

/** Un moment candidat : ce qu'il faut savoir d'un clip pour le choisir, l'ordonner et le monter. */
export interface MomentCandidate {
  clipId: string;
  title: string;
  score: number;
  /** Position du pic dans l'enregistrement d'origine (secondes), pour l'ordre chronologique */
  at: number;
  /** Fenêtre du clip dans l'enregistrement d'origine (secondes), pour repérer deux clips du même moment */
  from: number;
  to: number;
  recordingId: string | null;
  streamerId: string | null;
  createdAt: number;
  /** Durée de la fenêtre du clip */
  duration: number;
}

// ───────────────────────── Réglages ─────────────────────────

/** YouTube n'affiche les chapitres qu'à partir de 3 horodatages : c'est aussi le minimum d'une compilation. */
export const MIN_MOMENTS = 3;
export const MAX_MOMENTS = 30;
/** Nombre de moments proposé par défaut. */
export const DEFAULT_MOMENTS = 10;
/** Ouverture : flash du meilleur moment sous le titre. */
export const INTRO_SEC = 3.5;
/** Carton de fin (crédits des streamers). */
export const OUTRO_SEC = 4;
/** Durée minimale d'un chapitre YouTube. */
export const MIN_CHAPTER_SEC = 10;
/** Deux clips d'un même enregistrement qui se recouvrent à plus de cette part montrent le même moment. */
const SAME_MOMENT_OVERLAP = 0.5;

// ───────────────────────── Choix et ordre des moments ─────────────────────────

/** Même enregistrement, et des fenêtres qui se recouvrent largement (ou le même pic) : c'est le même moment. */
export function sameMoment(a: MomentCandidate, b: MomentCandidate): boolean {
  if (!a.recordingId || a.recordingId !== b.recordingId) return false;
  if (Math.abs(a.at - b.at) < 3) return true;
  const overlap = Math.min(a.to, b.to) - Math.max(a.from, b.from);
  const shorter = Math.min(a.to - a.from, b.to - b.from);
  return shorter > 0 && overlap / shorter > SAME_MOMENT_OVERLAP;
}

/**
 * Les `count` meilleurs moments, sans doublon (deux clips du même instant d'un live : on garde le mieux noté).
 * À score égal, le plus récent d'abord.
 */
export function pickBest(candidates: MomentCandidate[], count = DEFAULT_MOMENTS): MomentCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
  const kept: MomentCandidate[] = [];
  for (const c of sorted) {
    if (kept.length >= count) break;
    if (kept.some((k) => k.clipId === c.clipId || sameMoment(k, c))) continue;
    kept.push(c);
  }
  return kept;
}

export type MomentOrder = "countdown" | "chrono";

/**
 * Ordre de montage.
 * - countdown : du moins bon au meilleur (le meilleur en dernier : le spectateur reste jusqu'au bout).
 * - chrono : dans l'ordre où les moments se sont produits.
 */
export function orderMoments(moments: MomentCandidate[], order: MomentOrder): MomentCandidate[] {
  const out = [...moments];
  if (order === "countdown") out.sort((a, b) => a.score - b.score || a.createdAt - b.createdAt);
  else out.sort((a, b) => (a.recordingId === b.recordingId ? a.at - b.at : a.createdAt - b.createdAt));
  return out;
}

/** Numéro affiché pour le moment d'indice `index` : #N → #1 en compte à rebours, 1 → N sinon. */
export function momentNumber(index: number, total: number, countdown: boolean): number {
  return countdown ? total - index : index + 1;
}

/** Déplace un élément d'une liste (glisser-déposer, boutons monter/descendre). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const target = Math.max(0, Math.min(list.length - 1, to));
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item!);
  return out;
}

// ───────────────────────── Chronologie du montage ─────────────────────────

export interface Timeline {
  /** Durée de l'ouverture (0 = sans) */
  intro: number;
  /** Début et durée de chaque moment dans la vidéo finale */
  moments: Array<{ at: number; duration: number }>;
  /** Début du carton de fin */
  outroAt: number;
  outro: number;
  total: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Place les moments bout à bout. Les durées sont arrondies à l'image (30 i/s par défaut) : le montage
 * produit exactement ces durées, donc les chapitres tombent pile sur le début de chaque moment.
 */
export function buildTimeline(durations: number[], opts: { intro: boolean; fps?: number; introSec?: number; outroSec?: number }): Timeline {
  const fps = opts.fps ?? 30;
  const frames = (s: number) => Math.max(1, Math.round(s * fps)) / fps;
  const intro = opts.intro ? round3(frames(opts.introSec ?? INTRO_SEC)) : 0;
  let t = intro;
  const moments = durations.map((d) => {
    const duration = round3(frames(Math.max(1, d)));
    const m = { at: round3(t), duration };
    t += duration;
    return m;
  });
  const outro = round3(frames(opts.outroSec ?? OUTRO_SEC));
  return { intro, moments, outroAt: round3(t), outro, total: round3(t + outro) };
}

// ───────────────────────── Chapitres YouTube ─────────────────────────

export interface Chapter {
  at: number;
  title: string;
}

/** 75 → « 01:15 » ; au-delà d'une heure, « 1:02:03 ». */
export function chapterTime(sec: number, longForm = false): string {
  const s = Math.max(0, Math.floor(sec + 1e-6));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return longForm || h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${String(m).padStart(2, "0")}:${r}`;
}

/** Titre de chapitre : une ligne, sans emoji ni caractère qui casserait la description. */
export function cleanLabel(text: string, max = 80): string {
  const out = text
    .replace(/#\p{L}[\p{L}\p{N}_]*/gu, "")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, "")
    .replace(/[<>\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—:·|]+\s*/, "");
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}

/**
 * Chapitres de la vidéo, selon les règles de YouTube :
 * premier horodatage à 00:00, au moins 3 horodatages croissants, chaque chapitre d'au moins 10 s.
 *
 * Le premier chapitre commence à 0 (il englobe l'ouverture). Un moment trop court pour faire un chapitre
 * est rattaché au chapitre précédent (son titre s'y ajoute). S'il reste moins de 3 chapitres valides,
 * renvoie [] : mieux vaut pas de chapitres que des horodatages que YouTube ignorerait.
 */
export function buildChapters(timeline: Timeline, titles: string[]): Chapter[] {
  const raw: Array<{ at: number; end: number; title: string }> = timeline.moments.map((m, i) => ({
    at: i === 0 ? 0 : m.at,
    end: m.at + m.duration,
    title: cleanLabel(titles[i] ?? "") || `Moment ${i + 1}`,
  }));
  if (raw.length) raw[raw.length - 1]!.end = timeline.total; // le carton de fin appartient au dernier chapitre
  const merged: typeof raw = [];
  for (const c of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.end - prev.at < MIN_CHAPTER_SEC) {
      prev.end = c.end;
      prev.title = cleanLabel(`${prev.title} / ${c.title}`, 100);
      continue;
    }
    merged.push({ ...c });
  }
  // Dernier chapitre trop court : rattaché à l'avant-dernier.
  const last = merged[merged.length - 1];
  if (last && merged.length > 1 && last.end - last.at < MIN_CHAPTER_SEC) {
    const prev = merged[merged.length - 2]!;
    prev.end = last.end;
    prev.title = cleanLabel(`${prev.title} / ${last.title}`, 100);
    merged.pop();
  }
  if (merged.length < 3) return [];
  return merged.map((c) => ({ at: round3(c.at), title: c.title }));
}

/**
 * Titres des moments à partir des titres des clips. Sans IA, beaucoup de clips portent le même titre générique
 * (« X sur GTA 6 ») : les doublons sont alors distingués par l'instant du live où le moment s'est produit.
 */
export function momentLabels(moments: Array<{ title: string; at: number }>, max = 80): string[] {
  const base = moments.map((m) => cleanLabel(m.title, max - 16));
  const count = new Map<string, number>();
  for (const b of base) count.set(b.toLowerCase(), (count.get(b.toLowerCase()) ?? 0) + 1);
  return base.map((b, i) => {
    if (!b) return `Moment à ${chapterTime(moments[i]!.at, moments[i]!.at >= 3600).replace(/^0(\d:)/, "$1")} du live`;
    if ((count.get(b.toLowerCase()) ?? 0) < 2) return b;
    const t = chapterTime(moments[i]!.at, moments[i]!.at >= 3600).replace(/^0(\d:)/, "$1");
    return `${b}, à ${t} du live`;
  });
}

/** Vérifie qu'une liste de chapitres respecte les règles de YouTube (utilisé par les tests et avant publication). */
export function chaptersValid(chapters: Chapter[], total: number): boolean {
  if (chapters.length < 3 || chapters[0]!.at !== 0) return false;
  for (let i = 0; i < chapters.length; i++) {
    const end = chapters[i + 1]?.at ?? total;
    if (end - chapters[i]!.at < MIN_CHAPTER_SEC) return false;
  }
  return true;
}

export function chaptersText(chapters: Chapter[], total: number): string {
  const long = total >= 3600;
  return chapters.map((c) => `${chapterTime(c.at, long)} ${c.title}`).join("\n");
}

// ───────────────────────── Titre, description, miniature par défaut ─────────────────────────

const GAME_ALIASES: Array<[RegExp, string]> = [
  [/^grand theft auto vi$/i, "GTA 6"],
  [/^grand theft auto v$/i, "GTA 5"],
  [/^grand theft auto online$/i, "GTA Online"],
  [/^just chatting$/i, ""],
];

export function shortGame(category: string | null | undefined): string {
  const c = (category ?? "").trim();
  for (const [re, alias] of GAME_ALIASES) if (re.test(c)) return alias;
  return c;
}

export interface MetaContext {
  /** Noms des streamers, du plus présent au moins présent */
  streamers: string[];
  game: string;
  count: number;
  /** « live » : best-of d'un live précis ; « streamer » ; « day » ; « manual » */
  kind: "recording" | "streamer" | "day" | "manual";
  /** Titres des moments, dans l'ordre */
  moments: string[];
}

export interface CompilationMeta {
  title: string;
  description: string;
  thumbText: string;
  tags: string[];
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} et ${names[1]}`;
  return `${names.slice(0, 2).join(", ")} et ${names.length - 2} autre${names.length > 3 ? "s" : ""}`;
}

export function cleanTag(tag: string): string {
  return tag
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

/**
 * Titre et description neutres, pensés pour la recherche YouTube (qui, quel jeu, quoi) sans rien promettre
 * que la vidéo ne montre pas.
 */
export function defaultMeta(ctx: MetaContext): CompilationMeta {
  const who = listNames(ctx.streamers);
  const game = ctx.game;
  const n = ctx.count;
  const best = `les ${n} meilleurs moments`;
  let title: string;
  if (ctx.streamers.length === 1 && game) title = `${who} sur ${game} : ${best}${ctx.kind === "recording" ? " du live" : ""}`;
  else if (ctx.streamers.length === 1) title = `${who} : ${best}${ctx.kind === "recording" ? " du live" : ""}`;
  else if (game) title = `${game} : ${best} des streamers${who ? ` (${who})` : ""}`;
  else title = `Best-of : ${best} des lives`;
  title = title.charAt(0).toUpperCase() + title.slice(1);
  if (title.length > 100) title = `${title.slice(0, 99).trimEnd()}…`;

  const description = [
    `${n} moments forts${ctx.streamers.length ? ` de ${who}` : ""}${game ? ` sur ${game}` : ""}, réunis dans une seule vidéo.`,
    "Les chapitres ci-dessous permettent d'aller directement à chaque moment.",
  ].join(" ");
  const thumbBase = ctx.streamers.length === 1 ? ctx.streamers[0]! : game || "Best-of";
  return {
    title,
    description,
    thumbText: cleanLabel(`TOP ${n} ${thumbBase}`, 28),
    tags: [...new Set([...ctx.streamers, game, game ? `${game} best of` : "", "best of", "meilleurs moments", "compilation"].map(cleanTag).filter(Boolean))].slice(0, 12),
  };
}

export interface Credit {
  name: string;
  /** Lien vers la chaîne (https://twitch.tv/…), ou null */
  url: string | null;
}

/**
 * Description publiée : texte de l'utilisateur, chapitres, crédits des streamers, hashtags (YouTube en affiche 3
 * au-dessus du titre). Tient dans la limite de YouTube (5 000 octets).
 */
export function fullDescription(input: { text: string; chapters: Chapter[]; total: number; credits: Credit[]; tags: string[] }): string {
  const parts: string[] = [];
  const text = input.text.replace(/[<>]/g, "").trim();
  if (text) parts.push(text);
  if (input.chapters.length >= 3) parts.push(`Chapitres :\n${chaptersText(input.chapters, input.total)}`);
  if (input.credits.length) {
    parts.push(
      `Merci aux streamers, allez les suivre :\n${input.credits.map((c) => `• ${c.name}${c.url ? ` : ${c.url}` : ""}`).join("\n")}`,
    );
  }
  const hashtags = input.tags
    .map((t) => cleanTag(t).replace(/ /g, ""))
    .filter((t) => t.length >= 2)
    .slice(0, 3)
    .map((t) => `#${t}`);
  if (hashtags.length) parts.push(hashtags.join(" "));
  let out = parts.join("\n\n");
  const enc = new TextEncoder();
  // Rare (texte très long) : on raccourcit le texte libre, jamais les chapitres ni les crédits.
  while (enc.encode(out).length > 4900 && parts.length && parts[0] === text && text.length > 0) {
    parts[0] = `${parts[0]!.slice(0, Math.floor(parts[0]!.length * 0.8)).trimEnd()}…`;
    out = parts.join("\n\n");
  }
  return out;
}

/** Lien public vers la chaîne d'un streamer, pour la description. */
export function channelUrl(platform: string, login: string): string | null {
  if (!login) return null;
  if (platform === "TWITCH") return `https://www.twitch.tv/${login}`;
  if (platform === "KICK") return `https://kick.com/${login}`;
  if (platform === "YOUTUBE") return login.startsWith("@") ? `https://www.youtube.com/${login}` : null;
  if (platform === "TIKTOK") return `https://www.tiktok.com/@${login.replace(/^@/, "")}`;
  return null;
}

/** Empreinte de ce qui change le montage : sert à signaler « modifiée depuis le dernier montage ». */
export function montageSignature(input: {
  items: Array<{ clipId: string; label: string; start: number; end: number }>;
  countdown: boolean;
  captions: boolean;
  intro: boolean;
  title: string;
}): string {
  return JSON.stringify([
    input.items.map((i) => [i.clipId, i.label, Math.round(i.start * 10), Math.round(i.end * 10)]),
    input.countdown,
    input.captions,
    input.intro,
    input.intro ? input.title : "",
  ]);
}
