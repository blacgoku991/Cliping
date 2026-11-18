/**
 * Titre, description et texte de miniature d'une compilation, proposés par Claude quand la clé est là.
 * Même patron que ./ai.ts : sorties structurées, repli côté serveur (sauf Haiku), null en cas d'échec
 * (l'appelant retombe alors sur defaultMeta()).
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { cleanLabel, cleanTag, type CompilationMeta } from "@/lib/compilation";
import { env } from "@/lib/env";
import { log } from "./proc";

export interface CompilationAiContext {
  language: string;
  streamers: string[];
  game: string;
  count: number;
  /** Un moment par entrée, dans l'ordre du montage */
  moments: Array<{ title: string; streamer: string; transcript: string }>;
  defaultHashtags: string[];
}

const Schema = z.object({
  title: z.string().describe("Titre de la vidéo YouTube, 60 à 90 caractères, sans emoji ni hashtag ni majuscules partout."),
  description: z.string().describe("Deux ou trois phrases qui présentent la compilation, sans hashtag, sans liste de chapitres."),
  thumbText: z.string().describe("Texte de la miniature : 2 à 4 mots, 24 caractères max."),
  tags: z.array(z.string()).describe("6 à 12 mots-clés de recherche YouTube, sans #."),
});

const SYSTEM = `Tu aides un clippeur à publier sur YouTube (vidéos classiques, format horizontal) des compilations des meilleurs moments de streams de jeux vidéo.

On te donne le contexte (streamers, jeu, nombre de moments) et, pour chaque moment, son titre et ce que dit le streamer. Tu ne vois pas l'image.

Ce que tu produis sert tel quel :
- Le titre est pensé pour la recherche et la page d'accueil de YouTube : il dit clairement qui, quel jeu et quoi (par exemple « les 10 meilleurs moments »), avec les mots que les spectateurs tapent. Il donne envie de cliquer sans rien promettre que la vidéo ne montre pas : pas de faux drame, pas de « vous n'allez pas y croire », pas d'événement inventé.
- La description présente la vidéo en deux ou trois phrases utiles. Les chapitres et les crédits sont ajoutés automatiquement : ne les écris pas.
- Le texte de la miniature est très court et lisible en petit (2 à 4 mots), complémentaire du titre plutôt qu'une répétition.
- N'invente aucun fait absent des titres ou des transcriptions.

Rédige dans la langue demandée.`;

let client: Anthropic | null = null;

export async function generateCompilationMeta(ctx: CompilationAiContext): Promise<CompilationMeta | null> {
  if (!env.ai.apiKey) return null;
  client ??= new Anthropic({ apiKey: env.ai.apiKey });
  const model = env.ai.model;
  // Claude Haiku n'accepte pas le repli côté serveur ; les autres modèles récents, si.
  const supportsFallback = !/haiku/i.test(model);

  const moments = ctx.moments
    .map((m, i) => {
      const said = m.transcript.trim().slice(0, 600);
      return `${i + 1}. ${m.title}${m.streamer ? ` (${m.streamer})` : ""}${said ? `\n<transcription>${said}</transcription>` : ""}`;
    })
    .join("\n");
  const user = [
    `Langue de rédaction : ${ctx.language}`,
    `Streamers : ${ctx.streamers.join(", ") || "inconnus"}`,
    `Jeu : ${ctx.game || "inconnu"}`,
    `Nombre de moments : ${ctx.count}`,
    "",
    "Moments, dans l'ordre de la vidéo :",
    moments,
  ].join("\n");

  try {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: betaZodOutputFormat(Schema) },
      ...(supportsFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    if (response.stop_reason === "refusal") {
      log("ai", `compilation : requête déclinée (${response.stop_details?.category ?? "sans catégorie"}), valeurs par défaut utilisées`);
      return null;
    }
    const out = response.parsed_output;
    if (!out || !out.title.trim()) {
      log("ai", `compilation : réponse inexploitable (stop_reason=${response.stop_reason}), valeurs par défaut utilisées`);
      return null;
    }
    return {
      title: cleanLabel(out.title, 100),
      description: out.description.replace(/#\S+/g, "").trim().slice(0, 1500),
      thumbText: cleanLabel(out.thumbText, 28),
      tags: [...new Set([...out.tags, ...ctx.defaultHashtags].map(cleanTag).filter((t) => t.length >= 2))].slice(0, 15),
    };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) log("ai", "ANTHROPIC_API_KEY refusée : vérifie la clé. Valeurs par défaut utilisées.");
    else if (err instanceof Anthropic.RateLimitError) log("ai", "limite de débit atteinte, valeurs par défaut pour cette compilation");
    else if (err instanceof Anthropic.APIError) log("ai", `erreur API ${err.status} : ${err.message}`);
    else log("ai", `erreur : ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
