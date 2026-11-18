import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env } from "@/lib/env";
import { HOOK_ANGLES, type HookAngle } from "@/lib/settings";
import { log } from "./proc";
import { normWord } from "./render/captions";

const uniq = (xs: string[]) => xs.filter((x, i) => x && xs.indexOf(x) === i);

export interface ClipMetadata {
  title: string;
  hook: string;
  /** Trois propositions de titre (la première = `title`) */
  titles: string[];
  /** Trois propositions d'accroche (la première = `hook`) */
  hooks: string[];
  /** Angle de chaque accroche (même ordre que `hooks`) */
  hookAngles: HookAngle[];
  /** Mots de la transcription à mettre en valeur dans les sous-titres (forme normalisée) */
  emphasis: string[];
  description: string;
  hashtags: string[];
  /** 0..100, null quand l'IA n'a pas été consultée */
  viralScore: number | null;
  reason: string;
}

export interface MetadataContext {
  streamer: string;
  platform: string;
  game: string | null;
  streamTitle: string | null;
  language: string;
  durationSec: number;
  transcript: string;
  signals: { audio: number; chat: number | null; scene: number | null };
  defaultHashtags: string[];
  /** Images JPEG tirées de l'extrait autour du moment fort, dans l'ordre chronologique (peut être vide) */
  frames?: Array<{ at: string; jpeg: Buffer }>;
}

export { HOOK_ANGLES, type HookAngle };

/** Formules creuses qui iraient sur n'importe quel clip : jamais retenues comme accroche. */
const GENERIC_HOOKS = [
  "regardez ca", "regarde ca", "incroyable", "c'est incroyable", "c'est fou", "trop fou", "wow", "omg", "wtf", "attendez la fin",
  "attends la fin", "regardez jusqu'a la fin", "vous allez pas croire", "vous n'allez pas croire", "moment epique", "moment fou",
  "le moment", "ca part en vrille", "dingue", "watch this", "insane", "crazy", "wait for it", "you won't believe",
].map((h) => h.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());

function hookKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Accroche recevable : 2 à 7 mots, pas une formule creuse, pas d'emoji ni de hashtag. */
export function isGoodHook(text: string): boolean {
  const key = hookKey(text);
  const words = key.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 7) return false;
  if (/[#\p{Extended_Pictographic}]/u.test(text)) return false;
  return !GENERIC_HOOKS.includes(key.replace(/ ?!+$/, ""));
}

/**
 * Garde les 3 meilleures accroches : d'abord celles que le modèle a classées, puis les autres candidates,
 * en écartant les formules creuses, les doublons et en préférant des angles différents.
 */
export function pickHooks(
  best: Array<{ angle: string; text: string }>,
  candidates: Array<{ angle: string; text: string }>,
): Array<{ angle: HookAngle; text: string }> {
  const out: Array<{ angle: HookAngle; text: string }> = [];
  const seen = new Set<string>();
  const pool = [...best, ...candidates]
    .map((h) => ({ angle: (HOOK_ANGLES as readonly string[]).includes(h.angle) ? (h.angle as HookAngle) : "curiosite", text: h.text.replace(/#\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 70) }))
    .filter((h) => h.text && isGoodHook(h.text));
  // Premier passage : un angle par accroche ; second passage : on complète si besoin.
  for (const pass of [0, 1]) {
    for (const h of pool) {
      if (out.length >= 3) break;
      const k = hookKey(h.text);
      if (seen.has(k)) continue;
      if (pass === 0 && out.some((o) => o.angle === h.angle)) continue;
      seen.add(k);
      out.push(h);
    }
  }
  return out;
}

const MetadataSchema = z.object({
  titles: z
    .array(z.string())
    .describe("Exactement 3 titres de publication, d'angles différents, 70 caractères max chacun, 1 emoji max, sans hashtag. Le meilleur en premier."),
  hookCandidates: z
    .array(z.object({ angle: z.enum(HOOK_ANGLES), text: z.string() }))
    .describe("6 à 8 accroches candidates, au moins une par angle quand c'est possible honnêtement : curiosite, enjeu, reaction, citation (mots réellement prononcés), question"),
  hooks: z
    .array(z.object({ angle: z.enum(HOOK_ANGLES), text: z.string() }))
    .describe("Les 3 meilleures candidates selon les critères, d'angles différents, la meilleure en premier"),
  emphasis: z
    .array(z.string())
    .describe("2 à 8 mots (un mot chacun, tels qu'écrits dans la transcription) qui portent l'émotion ou l'info clé, à mettre en valeur dans les sous-titres. Vide si pas de transcription."),
  description: z.string().describe("Une ou deux phrases de description, sans hashtag"),
  hashtags: z.array(z.string()).describe("4 à 8 hashtags sans le #, en minuscules"),
  viralScore: z.number().describe("Potentiel du clip en format court, de 0 à 100"),
  reason: z.string().describe("Une phrase : ce qui se passe et pourquoi ça marche (ou pas)"),
});

const SYSTEM = `Tu aides un clippeur à publier des extraits de streams de jeux vidéo au format court (TikTok, YouTube Shorts).

Pour chaque extrait, on te donne le contexte du stream, la transcription de ce que dit le streamer, l'intensité des signaux qui ont déclenché la capture (volume sonore, activité du chat, action à l'écran) et, quand c'est possible, quelques images tirées de l'extrait autour du moment fort, dans l'ordre chronologique. Décris ce que montrent réellement les images et la transcription ; quand ni l'une ni l'autre ne permet de savoir ce qui se passe, reste général.

Ce que tu produis sert tel quel :
- Le titre et l'accroche doivent donner envie de regarder sans mentir sur le contenu. Pas de faux drame, pas de promesse que l'extrait ne tient pas : un titre trompeur fait fuir les spectateurs dans les deux premières secondes et pénalise le compte.
- N'invente aucun fait (nom de mission, personnage, événement) absent de la transcription ou du contexte.
- L'accroche est incrustée en gros sur la vidéo et lue pendant les deux premières secondes, avant que le spectateur décide de rester. Écris d'abord 6 à 8 candidates sous des angles vraiment différents :
  - curiosite : un détail précis de la situation qui donne envie de voir la suite ;
  - enjeu : ce qui est en jeu à ce moment (une course-poursuite, une mission, de l'argent) ;
  - reaction : la réaction du streamer, telle qu'on la voit ou l'entend ;
  - citation : une phrase courte réellement prononcée, entre guillemets si besoin ;
  - question : la question que se pose le spectateur et à laquelle l'extrait répond.
  Puis garde les 3 meilleures, d'angles différents, selon ces critères : lisible en une seconde, 7 mots au plus, précise à cet extrait, fidèle à ce que montrent les images et la transcription. Écarte toute formule creuse qui irait sur n'importe quel clip (« REGARDEZ ÇA », « INCROYABLE », « ATTENDEZ LA FIN ») : elles ne retiennent personne. Si l'extrait ne permet pas d'écrire un angle sans inventer, saute cet angle.
- Les trois titres suivent la même règle : des angles différents, rien qui ne soit dans l'extrait.
- Les mots mis en valeur dans les sous-titres sont des mots réellement prononcés dans la transcription : exclamations, chiffres, le mot qui fait la chute. Peu nombreux, sinon plus rien ne ressort.
- Les hashtags mélangent le jeu, le streamer et le type de moment.
- Le score de potentiel est honnête : un extrait où il ne se passe rien d'identifiable (transcription vide ou banale, signaux faibles) mérite une note basse. Mieux vaut écarter un clip moyen que le publier.

Rédige dans la langue demandée.`;

const GAME_ALIASES: Array<[RegExp, string]> = [
  [/^grand theft auto vi$/i, "GTA 6"],
  [/^grand theft auto v$/i, "GTA 5"],
  [/^grand theft auto online$/i, "GTA Online"],
  [/^just chatting$/i, ""],
];

export function shortGameName(category: string | null | undefined): string {
  const c = (category ?? "").trim();
  for (const [re, alias] of GAME_ALIASES) if (re.test(c)) return alias;
  return c;
}

function cleanTag(tag: string): string {
  return tag
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 40);
}

export function mergeHashtags(...lists: string[][]): string[] {
  const seen = new Set<string>();
  for (const list of lists) for (const t of list) {
    const c = cleanTag(t);
    if (c.length >= 2) seen.add(c);
  }
  return [...seen].slice(0, 10);
}

/** Titre neutre quand l'IA n'est pas configurée : on décrit sans rien inventer. */
export function fallbackMetadata(ctx: MetadataContext, seed: string): ClipMetadata {
  const game = shortGameName(ctx.game);
  const who = ctx.streamer.trim();
  let variants: string[];
  if (who && game) variants = [`${who} sur ${game} 🔥`, `Le moment de ${who} sur ${game} 😱`, `${who} en live sur ${game} 👀`];
  else if (who) variants = [`${who} en live 🔥`, `Le moment de ${who} 😱`, `${who} en direct 👀`];
  else if (game) variants = [`Moment fort sur ${game} 🔥`, `Ça part en vrille sur ${game} 😱`, `${game} : le moment à voir 👀`];
  else variants = ["Le moment à ne pas rater 🔥", "Moment fort du live 😱", "Extrait du live 👀"];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const k = h % variants.length;
  const titles = [...variants.slice(k), ...variants.slice(0, k)];
  // Accroches neutres : on ne sait pas ce qui se passe, on n'invente rien.
  const hooks = (
    who && game
      ? [`${who} sur ${game}`, `Le moment de ${who}`, `${game} en live`]
      : who
        ? [`Le moment de ${who}`, `${who} en live`, `${who} en direct`]
        : game
          ? [`Moment fort sur ${game}`, `${game} en live`, `Ça se passe sur ${game}`]
          : ["", "Moment fort du live", "Extrait du live"]
  ).filter((x, i, a) => a.indexOf(x) === i);
  return {
    title: titles[0]!,
    hook: hooks[0] ?? "",
    titles,
    hooks,
    hookAngles: [],
    emphasis: [],
    description: `Extrait du live${who ? ` de ${who}` : ""}${game ? ` sur ${game}` : ""}.`,
    hashtags: mergeHashtags(ctx.defaultHashtags, [who, game]),
    viralScore: null,
    reason: "",
  };
}

let client: Anthropic | null = null;

/**
 * Demande à Claude un titre, une accroche, une description, des hashtags et une note de potentiel.
 * Renvoie null si l'IA n'est pas configurée ou si l'appel échoue : l'appelant retombe sur fallbackMetadata().
 */
export async function generateMetadata(ctx: MetadataContext): Promise<ClipMetadata | null> {
  if (!env.ai.apiKey) return null;
  client ??= new Anthropic({ apiKey: env.ai.apiKey });
  const model = env.ai.model;
  // Claude Haiku n'accepte pas le repli côté serveur ; les autres modèles récents, si.
  const supportsFallback = !/haiku/i.test(model);

  const text = [
    `Langue de rédaction : ${ctx.language}`,
    `Streamer : ${ctx.streamer ? `${ctx.streamer} (${ctx.platform})` : "inconnu"}`,
    `Jeu / catégorie : ${ctx.game || "inconnu"}`,
    `Titre du live : ${ctx.streamTitle || "inconnu"}`,
    `Durée de l'extrait : ${Math.round(ctx.durationSec)} s`,
    `Signaux au moment fort (écart par rapport à l'habitude du stream, en sigmas) : son ${ctx.signals.audio}` +
      (ctx.signals.chat !== null ? `, chat ${ctx.signals.chat}` : ", chat non mesuré") +
      (ctx.signals.scene !== null ? `, action à l'écran ${ctx.signals.scene}` : ""),
    `Hashtags habituels du clippeur : ${ctx.defaultHashtags.map((t) => "#" + t).join(" ") || "aucun"}`,
    "",
    "Transcription de l'extrait :",
    ctx.transcript.trim() ? `<transcription>\n${ctx.transcript.trim()}\n</transcription>` : "(aucune parole détectée ou transcription désactivée)",
    "",
    ctx.frames?.length
      ? `Images de l'extrait ci-dessus (${ctx.frames.map((f) => f.at).join(", ")}).`
      : "(pas d'image disponible pour cet extrait)",
  ].join("\n");
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const f of ctx.frames ?? []) {
    content.push({ type: "text", text: `Image ${f.at} :` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.jpeg.toString("base64") } });
  }
  content.push({ type: "text", text });

  try {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { effort: "low", format: betaZodOutputFormat(MetadataSchema) },
      ...(supportsFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    if (response.stop_reason === "refusal") {
      log("ai", `requête déclinée par le modèle (${response.stop_details?.category ?? "sans catégorie"}), titre par défaut utilisé`);
      return null;
    }
    const out = response.parsed_output;
    if (!out) {
      log("ai", `réponse inexploitable (stop_reason=${response.stop_reason}), titre par défaut utilisé`);
      return null;
    }
    const titles = uniq(out.titles.map((t) => t.replace(/#\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 95))).slice(0, 3);
    const picked = pickHooks(out.hooks, out.hookCandidates);
    if (!titles.length) {
      log("ai", "réponse sans titre, titre par défaut utilisé");
      return null;
    }
    // Seuls des mots vraiment prononcés : l'IA ne peut pas faire apparaître autre chose à l'écran.
    const spoken = new Set(ctx.transcript.split(/\s+/).map(normWord).filter(Boolean));
    const emphasis = uniq(out.emphasis.map(normWord).filter((w) => w && spoken.has(w))).slice(0, 12);
    return {
      title: titles[0]!,
      hook: picked[0]?.text ?? "",
      titles,
      hooks: picked.map((h) => h.text),
      hookAngles: picked.map((h) => h.angle),
      emphasis,
      description: out.description.trim().slice(0, 600),
      hashtags: mergeHashtags(out.hashtags, ctx.defaultHashtags),
      viralScore: Math.round(Math.min(100, Math.max(0, out.viralScore))),
      reason: out.reason.trim().slice(0, 300),
    };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      log("ai", "ANTHROPIC_API_KEY refusée : vérifie la clé. Titres par défaut utilisés.");
    } else if (err instanceof Anthropic.RateLimitError) {
      log("ai", "limite de débit atteinte, titre par défaut utilisé pour ce clip");
    } else if (err instanceof Anthropic.APIError) {
      log("ai", `erreur API ${err.status} : ${err.message}`);
    } else {
      log("ai", `erreur : ${err instanceof Error ? err.message : err}`);
    }
    return null;
  }
}
