"use server";

import type { Prisma, SocialPlatform } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { failureMessage, generateProfile, generatePublishKit, generateReplies } from "@/lib/coach/ai";
import { templateKit, templateProfile, templateReplies, transcriptText, type ClipContext } from "@/lib/coach/content";
import { ALL_ITEM_IDS } from "@/lib/coach/guide";
import { parseCoachState, parsePublishKit, parseTone, type KitSource, type ProfileKit, type PublishKit } from "@/lib/coach/types";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { parseSettings } from "@/lib/settings";
import type { FormState } from "./auth";

const SOURCE_LABEL: Record<string, string> = { TWITCH: "Twitch", KICK: "Kick", YOUTUBE: "YouTube", OTHER: "" };

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/** Coche ou décoche un conseil de la liste de contrôle. */
export async function toggleCoachItem(itemId: string, done: boolean): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!ALL_ITEM_IDS.includes(itemId)) return { ok: false };
  const row = await db.user.findUnique({ where: { id: user.id }, select: { coach: true } });
  const state = parseCoachState(row?.coach);
  if (done) state.done[itemId] = new Date().toISOString();
  else delete state.done[itemId];
  await db.user.update({ where: { id: user.id }, data: { coach: json(state) } });
  revalidatePath("/app/coach");
  return { ok: true };
}

function splitList(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\n]+/)) {
    const t = part.replace(/^@+/, "").trim().slice(0, 40);
    if (t) seen.add(t);
  }
  return [...seen].slice(0, 6);
}

/** Génère des bios et des idées de nom pour un compte connecté, ou un brouillon pour un compte à créer. */
export async function saveProfileKit(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const target = String(form.get("target") ?? "");
  const niche = String(form.get("niche") ?? "").trim().slice(0, 120);
  const tone = parseTone(form.get("tone"));
  const streamers = splitList(String(form.get("streamers") ?? ""));
  const language = parseSettings(user.settings).language;

  let platform: SocialPlatform;
  let accountId: string | null = null;
  if (target.startsWith("account:")) {
    const account = await db.socialAccount.findFirst({ where: { id: target.slice(8), userId: user.id }, select: { id: true, platform: true } });
    if (!account) return { error: "Compte introuvable." };
    platform = account.platform;
    accountId = account.id;
  } else if (target === "draft:TIKTOK" || target === "draft:YOUTUBE") {
    platform = target.slice(6) as SocialPlatform;
  } else {
    return { error: "Choisis un compte." };
  }
  if (!niche) return { error: "Décris ta niche en quelques mots (par ex. « fails et fous rires GTA 6 »)." };

  const input = { niche, tone, streamers, language };
  const ai = await generateProfile(platform, input);
  const base = templateProfile(platform, input);
  const kit: ProfileKit = ai.ok
    ? { ...base, ...ai.value, tips: ai.value.tips.length ? ai.value.tips : base.tips, source: "ai", generatedAt: new Date().toISOString() }
    : { ...base, generatedAt: new Date().toISOString() };

  if (accountId) {
    await db.socialAccount.update({ where: { id: accountId }, data: { profileKit: json(kit) } });
  } else {
    const row = await db.user.findUnique({ where: { id: user.id }, select: { coach: true } });
    const state = parseCoachState(row?.coach);
    state.drafts[platform] = kit;
    await db.user.update({ where: { id: user.id }, data: { coach: json(state) } });
  }
  revalidatePath("/app/coach/profil");
  if (ai.ok) return { ok: "Propositions prêtes." };
  return { ok: ai.reason === "no_key" ? "Propositions génériques prêtes (IA non configurée)." : failureMessage(ai.reason) };
}

/** Génère (ou régénère) le kit de publication d'un clip et le conserve sur le clip. */
export async function saveClipKit(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const tone = parseTone(form.get("tone"));
  const clip = await db.clip.findFirst({
    where: { id, userId: user.id },
    include: { streamer: { select: { displayName: true, platform: true } }, recording: { select: { author: true, title: true, category: true } } },
  });
  if (!clip) return { error: "Clip introuvable." };
  if (clip.status === "PROCESSING") return { error: "Attends la fin du montage du clip." };

  const connected = await db.socialAccount.findMany({ where: { userId: user.id }, select: { platform: true }, distinct: ["platform"] });
  const platforms: SocialPlatform[] = connected.length ? connected.map((a) => a.platform).sort().reverse() : ["TIKTOK", "YOUTUBE"];
  const signals = (clip.signals ?? {}) as ClipContext["signals"];
  const ctx: ClipContext = {
    streamer: clip.streamer?.displayName ?? clip.recording?.author ?? "",
    sourcePlatform: clip.streamer ? (SOURCE_LABEL[clip.streamer.platform] ?? "") : "",
    game: clip.recording?.category ?? "",
    streamTitle: clip.recording?.title ?? "",
    title: clip.title,
    hook: clip.hook,
    description: clip.description,
    hashtags: clip.hashtags,
    transcript: transcriptText(clip.transcript, clip.startSec, clip.endSec),
    durationSec: clip.endSec - clip.startSec,
    signals: { audio: signals.audio, chat: signals.chat ?? null, scene: signals.scene ?? null },
    language: parseSettings(user.settings).language,
  };

  const ai = await generatePublishKit(ctx, platforms);
  const fallback = templateKit(ctx, platforms, tone);
  const source: KitSource = ai.ok ? "ai" : "template";
  const kit: PublishKit = {
    // Une plateforme que l'IA n'a pas su traiter garde le modèle générique.
    platforms: ai.ok ? { ...fallback.platforms, ...ai.value } : fallback.platforms,
    source,
    generatedAt: new Date().toISOString(),
  };
  await db.clip.update({ where: { id }, data: { publishKit: json(kit) } });
  revalidatePath(`/app/clips/${id}`);
  if (ai.ok) return { ok: "Kit prêt." };
  return { ok: ai.reason === "no_key" ? "Kit générique prêt (IA non configurée)." : failureMessage(ai.reason) };
}

/** Applique au clip le titre proposé par le kit pour une plateforme. */
export async function applyKitTitle(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const platform = String(form.get("platform") ?? "");
  const clip = await db.clip.findFirst({ where: { id, userId: user.id }, select: { id: true, publishKit: true, status: true } });
  if (!clip) return { error: "Clip introuvable." };
  const kit = parsePublishKit(clip.publishKit);
  const title = platform === "TIKTOK" || platform === "YOUTUBE" ? kit?.platforms[platform]?.title?.trim().slice(0, 100) : undefined;
  if (!title) return { error: "Aucun titre proposé pour cette plateforme." };
  // Le titre n'est pas incrusté dans la vidéo : pas besoin de remonter le clip.
  await db.clip.update({ where: { id }, data: { title } });
  revalidatePath(`/app/clips/${id}`);
  revalidatePath("/app/clips");
  return { ok: "Titre appliqué au clip." };
}

export interface RepliesState {
  error?: string;
  replies?: string[];
  source?: KitSource;
  note?: string;
}

/** Propose quelques réponses à un commentaire collé par l'utilisateur. Rien n'est enregistré. */
export async function suggestReplies(_prev: RepliesState, form: FormData): Promise<RepliesState> {
  await requireUser();
  const comment = String(form.get("comment") ?? "").trim();
  const tone = parseTone(form.get("tone"));
  const context = String(form.get("context") ?? "").trim();
  if (!comment) return { error: "Colle le commentaire auquel tu veux répondre." };
  if (comment.length > 1500) return { error: "Ce commentaire est trop long (1 500 caractères max.)." };

  const ai = await generateReplies(comment, tone, context);
  if (ai.ok) return { replies: ai.value, source: "ai" };
  return {
    replies: templateReplies(comment, tone),
    source: "template",
    note: ai.reason === "no_key" ? undefined : failureMessage(ai.reason),
  };
}
