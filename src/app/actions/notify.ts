"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { encrypt, sha256 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { NOTIFY_TYPES, parsePrefs } from "@/lib/notify-plan";
import { sendToChannel } from "@/lib/notify/send";
import { isAllowedPushEndpoint, parseDiscordWebhook, parseNtfyTarget, pushServiceLabel } from "@/lib/notify/targets";
import { requireUser } from "@/lib/session";

const PATH = "/app/autopilot/notifications";
const MAX_CHANNELS = 10;

async function ensureSettings(userId: string) {
  await db.notifySettings.upsert({ where: { userId }, update: {}, create: { userId } });
}

async function addChannel(userId: string, kind: string, label: string, config: object, target: string): Promise<FormState> {
  const count = await db.notifyChannel.count({ where: { userId } });
  const targetHash = sha256(`${kind}:${target}`);
  const existing = await db.notifyChannel.findUnique({ where: { userId_targetHash: { userId, targetHash } } });
  if (!existing && count >= MAX_CHANNELS) return { error: `${MAX_CHANNELS} canaux maximum : supprime-en un.` };
  let configEnc: string;
  try {
    configEnc = encrypt(JSON.stringify(config));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Chiffrement impossible." };
  }
  await db.notifyChannel.upsert({
    where: { userId_targetHash: { userId, targetHash } },
    update: { configEnc, label, enabled: true, lastError: null, failures: 0 },
    create: { userId, kind, label, configEnc, targetHash },
  });
  await ensureSettings(userId);
  revalidatePath(PATH);
  return { ok: existing ? "Canal mis à jour." : "Canal ajouté. Envoie-toi un test pour vérifier." };
}

/** Abonnement Web Push transmis par le navigateur après l'accord de l'utilisateur. */
export async function savePushSubscription(sub: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }, device: string): Promise<FormState> {
  const user = await requireUser();
  const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub?.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const auth = typeof sub?.keys?.auth === "string" ? sub.keys.auth : "";
  if (!isAllowedPushEndpoint(endpoint)) return { error: "Ce navigateur utilise un service de notification inconnu : abonnement refusé." };
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) return { error: "Abonnement incomplet : réessaie." };
  const label = `${pushServiceLabel(endpoint)}${device ? ` · ${device.slice(0, 40)}` : ""}`;
  return addChannel(user.id, "WEBPUSH", label, { endpoint, keys: { p256dh, auth } }, endpoint);
}

export async function addNtfyChannel(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const target = parseNtfyTarget(String(form.get("topic") ?? ""));
  if ("error" in target) return { error: target.error };
  const token = String(form.get("token") ?? "").trim();
  if (token && !/^[A-Za-z0-9_-]{8,128}$/.test(token)) return { error: "Jeton d'accès ntfy invalide." };
  return addChannel(user.id, "NTFY", `ntfy · ${target.topic.slice(0, 6)}…`, { ...target, ...(token ? { token } : {}) }, `${target.server}/${target.topic}`);
}

export async function addDiscordChannel(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const target = parseDiscordWebhook(String(form.get("url") ?? ""));
  if ("error" in target) return { error: target.error };
  return addChannel(user.id, "DISCORD", "Discord", target, target.url);
}

export async function removeChannel(form: FormData): Promise<void> {
  const user = await requireUser();
  await db.notifyChannel.deleteMany({ where: { id: String(form.get("id") ?? ""), userId: user.id } });
  revalidatePath(PATH);
}

export async function toggleChannel(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const ch = await db.notifyChannel.findFirst({ where: { id, userId: user.id } });
  if (ch) await db.notifyChannel.update({ where: { id }, data: { enabled: !ch.enabled } });
  revalidatePath(PATH);
}

/** Envoie tout de suite un message de test sur un canal et dit si ça a marché. */
export async function testChannel(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const ch = await db.notifyChannel.findFirst({ where: { id: String(form.get("id") ?? ""), userId: user.id } });
  if (!ch) return { error: "Canal introuvable (déjà supprimé ?)." };
  const res = await sendToChannel(ch, {
    title: "Cliping : test réussi",
    body: "Tu recevras ici les clips à valider, les échecs de publication et le résumé du jour.",
    url: PATH,
    tag: "test",
  });
  await db.notification.create({
    data: { userId: user.id, type: "test", refKey: `test:${ch.id}:${Date.now()}`, title: "Test", body: `Test envoyé sur ${ch.label}`, url: PATH, status: res.ok ? "SENT" : "SKIPPED", sentAt: res.ok ? new Date() : null },
  });
  revalidatePath(PATH);
  if (res.ok) return { ok: "Envoyé. S'il n'arrive pas d'ici une minute, vérifie les réglages de notification du téléphone." };
  return { error: res.gone ? `${res.error} Le canal a été retiré : réactive les notifications.` : res.error };
}

export async function saveNotifyPrefs(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const types = Object.fromEntries(NOTIFY_TYPES.map((t) => [t, form.get(`type_${t}`) === "on"]));
  const quietOn = form.get("quietOn") === "on";
  const prefs = parsePrefs({
    types,
    quiet: quietOn ? { from: Number(form.get("quietFrom")), to: Number(form.get("quietTo")) } : null,
    groupMin: Number(form.get("groupMin")),
    digestHour: Number(form.get("digestHour")),
    tz: String(form.get("tz") ?? ""),
  });
  await db.notifySettings.upsert({
    where: { userId: user.id },
    update: { prefs: prefs as unknown as Prisma.InputJsonValue },
    create: { userId: user.id, prefs: prefs as unknown as Prisma.InputJsonValue },
  });
  revalidatePath(PATH);
  return { ok: "Préférences enregistrées." };
}
