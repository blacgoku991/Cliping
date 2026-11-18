import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SocialPlatform } from "@prisma/client";
import { z } from "zod";
import { env } from "../env";
import {
  kitSystemPrompt,
  kitUserPrompt,
  profileSystemPrompt,
  profileUserPrompt,
  replySystemPrompt,
  replyUserPrompt,
  sanitizePlatformKit,
  sanitizeProfile,
  sanitizeReplies,
  type ClipContext,
} from "./content";
import type { PlatformKit, ProfileInput, Tone } from "./types";

/**
 * Appels à Claude pour le coach. Même patron que src/worker/ai.ts : modèle pris dans env.ai.model,
 * sorties structurées, repli côté serveur (sauf Haiku), et null en cas d'absence de clé ou d'échec
 * pour que l'appelant retombe sur les modèles génériques de content.ts.
 */

/** Sous-ensemble du client utilisé ici (permet de le simuler dans les tests). */
export interface CoachClient {
  beta: { messages: { parse: Anthropic["beta"]["messages"]["parse"] } };
}

let client: CoachClient | null = null;
let clientOverride: CoachClient | null = null;

/** Pour les tests : remplace le client Anthropic (null pour revenir au vrai). */
export function setCoachClientForTests(c: CoachClient | null): void {
  clientOverride = c;
}

export function aiAvailable(): boolean {
  return !!clientOverride || !!env.ai.apiKey;
}

export type AiFailure = "no_key" | "refused" | "invalid" | "auth" | "rate_limit" | "error";

export type AiResult<T> = { ok: true; value: T } | { ok: false; reason: AiFailure };

export function failureMessage(reason: AiFailure): string {
  switch (reason) {
    case "no_key":
      return "IA non configurée : suggestions génériques.";
    case "refused":
      return "Claude a décliné cette demande : suggestions génériques à la place.";
    case "auth":
      return "La clé ANTHROPIC_API_KEY est refusée : vérifie-la. Suggestions génériques à la place.";
    case "rate_limit":
      return "Limite d'utilisation de l'API atteinte, réessaie dans un moment. Suggestions génériques à la place.";
    case "invalid":
      return "La réponse de l'IA était inexploitable : suggestions génériques à la place.";
    default:
      return "L'IA n'a pas répondu : suggestions génériques à la place.";
  }
}

async function ask<S extends z.ZodType>(schema: S, system: string, user: string): Promise<AiResult<z.infer<S>>> {
  const c = clientOverride ?? (env.ai.apiKey ? (client ??= new Anthropic({ apiKey: env.ai.apiKey })) : null);
  if (!c) return { ok: false, reason: "no_key" };
  const model = env.ai.model;
  // Claude Haiku n'accepte pas le repli côté serveur ; les autres modèles récents, si.
  const supportsFallback = !/haiku/i.test(model);
  try {
    const response = await c.beta.messages.parse({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: betaZodOutputFormat(schema) },
      ...(supportsFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    if (response.stop_reason === "refusal") return { ok: false, reason: "refused" };
    const out = response.parsed_output;
    if (out === null || out === undefined) return { ok: false, reason: "invalid" };
    return { ok: true, value: out as z.infer<S> };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, reason: "auth" };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, reason: "rate_limit" };
    console.error("[coach] appel IA :", err instanceof Error ? err.message : err);
    return { ok: false, reason: "error" };
  }
}

// ───────────── Profil ─────────────

const ProfileSchema = z.object({
  bios: z.array(z.string()).describe("4 bios différentes, chacune sous la limite de caractères"),
  displayNames: z.array(z.string()).describe("5 noms affichés"),
  usernames: z.array(z.string()).describe("5 noms d'utilisateur, minuscules, sans @"),
  tips: z.array(z.string()).describe("2 ou 3 conseils courts pour la photo de profil et le lien"),
});

export async function generateProfile(
  platform: SocialPlatform,
  input: ProfileInput,
): Promise<AiResult<{ bios: string[]; displayNames: string[]; usernames: string[]; tips: string[] }>> {
  const res = await ask(ProfileSchema, profileSystemPrompt(), profileUserPrompt(platform, input));
  if (!res.ok) return res;
  const clean = sanitizeProfile(platform, res.value);
  // Si presque tout dépasse les limites, mieux vaut des modèles génériques valides.
  if (clean.bios.length === 0 || clean.displayNames.length + clean.usernames.length === 0) return { ok: false, reason: "invalid" };
  return { ok: true, value: clean };
}

// ───────────── Kit de publication ─────────────

const PlatformKitSchema = z.object({
  title: z.string().describe("Titre, sans hashtag"),
  caption: z.string().describe("Légende (TikTok) ou description (YouTube), crédite le streamer, sans hashtag"),
  hashtags: z.array(z.string()).describe("3 à 6 hashtags sans #, en minuscules"),
  pinnedComments: z.array(z.string()).describe("2 ou 3 commentaires à épingler"),
  replies: z
    .array(z.object({ comment: z.string().describe("Commentaire type reçu"), reply: z.string().describe("Réponse proposée") }))
    .describe("4 ou 5 réponses types"),
});

const KitSchema = z.object({
  tiktok: PlatformKitSchema.nullable().describe("Kit TikTok, ou null si TikTok n'est pas demandé"),
  youtube: PlatformKitSchema.nullable().describe("Kit YouTube Shorts, ou null si YouTube n'est pas demandé"),
});

export async function generatePublishKit(
  ctx: ClipContext,
  platforms: SocialPlatform[],
): Promise<AiResult<Partial<Record<SocialPlatform, PlatformKit>>>> {
  const res = await ask(KitSchema, kitSystemPrompt(), kitUserPrompt(ctx, platforms));
  if (!res.ok) return res;
  const out: Partial<Record<SocialPlatform, PlatformKit>> = {};
  for (const p of platforms) {
    const raw = p === "TIKTOK" ? res.value.tiktok : res.value.youtube;
    const kit = raw ? sanitizePlatformKit(p, raw) : null;
    if (kit) out[p] = kit;
  }
  if (Object.keys(out).length === 0) return { ok: false, reason: "invalid" };
  return { ok: true, value: out };
}

// ───────────── Réponses ─────────────

const RepliesSchema = z.object({ replies: z.array(z.string()).describe("3 réponses possibles") });

export async function generateReplies(comment: string, tone: Tone, context: string): Promise<AiResult<string[]>> {
  const res = await ask(RepliesSchema, replySystemPrompt(), replyUserPrompt(comment, tone, context));
  if (!res.ok) return res;
  const replies = sanitizeReplies(res.value.replies);
  return replies.length ? { ok: true, value: replies } : { ok: false, reason: "invalid" };
}
