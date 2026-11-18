import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env } from "@/lib/env";
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
}

const MetadataSchema = z.object({
  titles: z
    .array(z.string())
    .describe("Exactement 3 titres de publication, d'angles différents, 70 caractères max chacun, 1 emoji max, sans hashtag. Le meilleur en premier."),
  hooks: z
    .array(z.string())
    .describe("Exactement 3 accroches incrustées en haut de la vidéo, d'angles différents : 3 à 7 mots, sans emoji ni hashtag. La meilleure en premier."),
  emphasis: z
    .array(z.string())
    .describe("2 à 8 mots (un mot chacun, tels qu'écrits dans la transcription) qui portent l'émotion ou l'info clé, à mettre en valeur dans les sous-titres. Vide si pas de transcription."),
  description: z.string().describe("Une ou deux phrases de description, sans hashtag"),
  hashtags: z.array(z.string()).describe("4 à 8 hashtags sans le #, en minuscules"),
  viralScore: z.number().describe("Potentiel du clip en format court, de 0 à 100"),
  reason: z.string().describe("Une phrase : ce qui se passe et pourquoi ça marche (ou pas)"),
});

const SYSTEM = `Tu aides un clippeur à publier des extraits de streams de jeux vidéo au format court (TikTok, YouTube Shorts).

Pour chaque extrait, on te donne le contexte du stream, la transcription de ce que dit le streamer et l'intensité des signaux qui ont déclenché la capture (volume sonore, activité du chat, action à l'écran). Tu ne vois pas l'image : appuie-toi sur la transcription, et reste général quand elle ne suffit pas à savoir ce qui se passe.

Ce que tu produis sert tel quel :
- Le titre et l'accroche doivent donner envie de regarder sans mentir sur le contenu. Pas de faux drame, pas de promesse que l'extrait ne tient pas : un titre trompeur fait fuir les spectateurs dans les deux premières secondes et pénalise le compte.
- N'invente aucun fait (nom de mission, personnage, événement) absent de la transcription ou du contexte.
- L'accroche est incrustée en gros sur la vidéo : courte, lisible d'un coup d'œil, dans le registre des clips gaming. Elle est lue pendant les deux premières secondes, avant que le spectateur décide de rester : elle doit poser une question ou une tension que l'extrait résout vraiment.
- Tu proposes trois titres et trois accroches d'angles différents (par exemple : la réaction du streamer, la situation, la question que se pose le spectateur), pour que le clippeur choisisse. Les trois doivent rester vrais : si la transcription ne dit pas ce qui se passe, reste sur ce qu'on sait (le streamer, le jeu, sa réaction) plutôt que d'inventer un enjeu.
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

  const user = [
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
  ].join("\n");

  try {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
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
    const hooks = uniq(out.hooks.map((t) => t.replace(/#\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 70))).slice(0, 3);
    if (!titles.length) {
      log("ai", "réponse sans titre, titre par défaut utilisé");
      return null;
    }
    // Seuls des mots vraiment prononcés : l'IA ne peut pas faire apparaître autre chose à l'écran.
    const spoken = new Set(ctx.transcript.split(/\s+/).map(normWord).filter(Boolean));
    const emphasis = uniq(out.emphasis.map(normWord).filter((w) => w && spoken.has(w))).slice(0, 12);
    return {
      title: titles[0]!,
      hook: hooks[0] ?? "",
      titles,
      hooks,
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
