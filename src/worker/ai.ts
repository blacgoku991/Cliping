import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env } from "@/lib/env";
import { log } from "./proc";

export interface ClipMetadata {
  title: string;
  hook: string;
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
  title: z.string().describe("Titre de la publication, 70 caractères max, 1 emoji max, sans hashtag"),
  hook: z.string().describe("Accroche incrustée en haut de la vidéo : 3 à 7 mots, sans emoji ni hashtag"),
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
- L'accroche est incrustée en gros sur la vidéo : courte, lisible d'un coup d'œil, dans le registre des clips gaming.
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
  const variants = game
    ? [`${ctx.streamer} sur ${game} 🔥`, `Le moment de ${ctx.streamer} sur ${game} 😱`, `${ctx.streamer} en live sur ${game} 👀`]
    : [`${ctx.streamer} en live 🔥`, `Le moment de ${ctx.streamer} 😱`, `${ctx.streamer} en direct 👀`];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    title: variants[h % variants.length]!,
    hook: game ? `${ctx.streamer} sur ${game}` : ctx.streamer,
    description: game ? `Extrait du live de ${ctx.streamer} sur ${game}.` : `Extrait du live de ${ctx.streamer}.`,
    hashtags: mergeHashtags(ctx.defaultHashtags, [ctx.streamer, game]),
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
    `Streamer : ${ctx.streamer} (${ctx.platform})`,
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
    return {
      title: out.title.replace(/#\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 95),
      hook: out.hook.replace(/#\S+/g, "").trim().slice(0, 70),
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
