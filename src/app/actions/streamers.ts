"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { streamKey } from "@/lib/discovery";
import { allowedHostsLabel, isAllowedSourceUrl, normalizeSourceUrl } from "@/lib/hosts";
import { enqueue } from "@/lib/jobs";
import { requireUser } from "@/lib/session";
import { parseChannel, type SourcePlatformName } from "@/lib/sources";
import type { FormState } from "./auth";

const MAX_STREAMERS = Number(process.env.MAX_STREAMERS_PER_USER ?? 50);

export async function addStreamer(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const input = String(form.get("channel") ?? "");
  const platform = String(form.get("platform") ?? "TWITCH") as SourcePlatformName;
  const parsed = parseChannel(input, ["TWITCH", "KICK", "YOUTUBE", "TIKTOK"].includes(platform) ? platform : "TWITCH");
  if (!parsed) {
    return { error: "Chaîne non reconnue. Colle l'adresse de la chaîne (twitch.tv/pseudo, kick.com/pseudo, youtube.com/@pseudo, tiktok.com/@pseudo)." };
  }
  if (parsed.platform === "OTHER" && !isAllowedSourceUrl(parsed.url)) {
    return { error: `Cette source n'est pas autorisée. Plateformes acceptées : ${allowedHostsLabel()}.` };
  }
  if ((await db.streamer.count({ where: { userId: user.id } })) >= MAX_STREAMERS) {
    return { error: `Limite de ${MAX_STREAMERS} chaînes atteinte.` };
  }
  const exists = await db.streamer.findUnique({
    where: { userId_platform_login: { userId: user.id, platform: parsed.platform, login: parsed.login } },
  });
  if (exists?.autoFollowed) {
    // Suivie par le mode automatique : elle passe en suivi manuel, le mode auto ne la retirera plus.
    await db.streamer.update({ where: { id: exists.id }, data: { autoFollowed: false, autoViewers: null, enabled: true } });
    revalidatePath("/app/streamers");
    return { ok: `${exists.displayName} est maintenant suivie à la main (elle ne sera plus retirée automatiquement).` };
  }
  if (exists) return { error: `${parsed.displayName} est déjà dans ta liste.` };
  await db.streamer.create({
    data: {
      userId: user.id,
      platform: parsed.platform,
      login: parsed.login,
      url: parsed.url,
      displayName: parsed.displayName,
      gameFilter: String(form.get("gameFilter") ?? "").trim().slice(0, 300),
    },
  });
  revalidatePath("/app/streamers");
  return { ok: `${parsed.displayName} ajouté. Le prochain live sera capté automatiquement.` };
}

function num(v: FormDataEntryValue | null): number {
  return Number(String(v ?? "").replace(",", "."));
}

export async function updateStreamer(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const quality = String(form.get("quality") ?? "best").trim();
  if (!/^[a-z0-9,_]{1,60}$/i.test(quality)) return { error: "Qualité invalide (ex. best, 1080p60, 720p60,best)." };

  let facecam: { x: number; y: number; w: number; h: number } | null = null;
  if (form.get("facecamOn") === "on") {
    const r = { x: num(form.get("fx")) / 100, y: num(form.get("fy")) / 100, w: num(form.get("fw")) / 100, h: num(form.get("fh")) / 100 };
    const valid = [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.x >= 0 && r.y >= 0 && r.w >= 0.05 && r.h >= 0.05 && r.x + r.w <= 1.001 && r.y + r.h <= 1.001;
    if (!valid) return { error: "Zone facecam invalide : les valeurs sont des pourcentages de l'image, et la zone doit rester dans le cadre." };
    facecam = r;
  }
  const res = await db.streamer.updateMany({
    where: { id, userId: user.id },
    data: {
      gameFilter: String(form.get("gameFilter") ?? "").trim().slice(0, 300),
      quality,
      facecam: facecam ?? Prisma.DbNull,
    },
  });
  if (res.count === 0) return { error: "Chaîne introuvable." };
  revalidatePath("/app/streamers");
  return { ok: "Réglages enregistrés." };
}

export async function toggleStreamer(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const s = await db.streamer.findFirst({ where: { id, userId: user.id } });
  if (s) await db.streamer.update({ where: { id }, data: { enabled: !s.enabled } });
  revalidatePath("/app/streamers");
}

export async function deleteStreamer(form: FormData): Promise<void> {
  const user = await requireUser();
  const s = await db.streamer.findFirst({ where: { id: String(form.get("id") ?? ""), userId: user.id } });
  if (!s) return;
  if (s.autoFollowed) {
    // Retirée à la main : le mode automatique ne doit pas la reprendre au prochain passage.
    const d = await db.discovery.findUnique({ where: { userId: user.id } });
    const key = streamKey(s);
    if (d && !d.excluded.includes(key)) {
      await db.discovery.update({ where: { id: d.id }, data: { excluded: [...d.excluded, key].slice(-200) } });
    }
  }
  await db.streamer.delete({ where: { id: s.id } });
  revalidatePath("/app/streamers");
}

/** Chaîne ajoutée par le mode automatique que l'utilisateur veut garder : elle devient « manuelle ». */
export async function keepStreamer(form: FormData): Promise<void> {
  const user = await requireUser();
  await db.streamer.updateMany({
    where: { id: String(form.get("id") ?? ""), userId: user.id, autoFollowed: true },
    data: { autoFollowed: false, autoViewers: null, enabled: true },
  });
  revalidatePath("/app/streamers");
}

function parseTime(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(v);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
}

export async function importVod(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const raw = String(form.get("url") ?? "").trim();
  if (!isAllowedSourceUrl(raw)) return { error: `Lien non accepté. Colle un lien de replay, de clip ou de vidéo ${allowedHostsLabel()}.` };
  const url = normalizeSourceUrl(raw);
  const start = parseTime(String(form.get("start") ?? ""));
  const end = parseTime(String(form.get("end") ?? ""));
  if (Number.isNaN(start) || Number.isNaN(end)) return { error: "Format d'heure invalide. Utilise h:mm:ss ou mm:ss (ex. 1:23:45)." };
  if (start !== null && end !== null && end <= start) return { error: "La fin doit être après le début." };
  const maxClips = Math.round(Number(form.get("maxClips") ?? 0));
  const pending = await db.recording.count({ where: { userId: user.id, source: "VOD", status: { in: ["PENDING", "PROCESSING"] } } });
  if (pending >= 3) return { error: "3 imports sont déjà en cours. Attends qu'un se termine." };

  const recording = await db.recording.create({
    data: {
      userId: user.id,
      source: "VOD",
      sourceUrl: url,
      status: "PENDING",
      options: {
        ...(start !== null ? { startSec: start } : {}),
        ...(end !== null ? { endSec: end } : {}),
        ...(maxClips >= 1 && maxClips <= 50 ? { maxClips } : {}),
      },
    },
  });
  await enqueue("vod.import", { recordingId: recording.id }, { maxAttempts: 2 });
  revalidatePath("/app/streamers");
  return {
    ok: "Import lancé. Une vidéo courte (clip, Short, TikTok) devient directement un clip ; un replay est analysé pour en extraire les moments forts. Résultat dans « Clips ».",
  };
}

export async function deleteRecording(form: FormData): Promise<void> {
  const user = await requireUser();
  await db.recording.deleteMany({
    where: { id: String(form.get("id") ?? ""), userId: user.id, status: { in: ["DONE", "FAILED"] } },
  });
  revalidatePath("/app/streamers");
}
