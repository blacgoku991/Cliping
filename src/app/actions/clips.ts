"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { PLATFORMS } from "@/lib/platforms";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/session";
import { CAPTION_STYLE_KEYS, effectiveEdit, parseSettings, type ClipEdit } from "@/lib/settings";
import { clipDir, removeDir } from "@/lib/storage";
import type { FormState } from "./auth";

function tagsFrom(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,]+/)) {
    const t = part.replace(/^#+/, "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (t.length >= 2) seen.add(t.slice(0, 40));
  }
  return [...seen].slice(0, 15);
}

/** Enregistre les modifications d'un clip et le remonte si quelque chose de visible a changé. */
export async function updateClip(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const clip = await db.clip.findFirst({ where: { id, userId: user.id }, include: { streamer: { select: { facecam: true } } } });
  if (!clip) return { error: "Clip introuvable." };
  if (clip.status === "PROCESSING") return { error: "Ce clip est encore en cours de montage." };

  const title = String(form.get("title") ?? "").trim().slice(0, 100);
  if (!title) return { error: "Le titre ne peut pas être vide." };
  const hook = String(form.get("hook") ?? "").trim().slice(0, 70);
  const description = String(form.get("description") ?? "").trim().slice(0, 1500);
  const hashtags = tagsFrom(String(form.get("hashtags") ?? ""));
  const captions = form.get("captions") === "on";
  const templateRaw = String(form.get("template") ?? clip.template);
  const template = templateRaw === "FULL" || templateRaw === "FACECAM" || templateRaw === "BLUR" ? templateRaw : clip.template;
  if (template === "FACECAM" && !clip.streamer?.facecam) {
    return { error: "Le template Facecam demande de définir la zone de la webcam dans les réglages de la chaîne." };
  }

  const startSec = Number(form.get("startSec"));
  const endSec = Number(form.get("endSec"));
  const max = clip.sourceDur || clip.endSec;
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec > max + 0.05) return { error: "Bornes du clip invalides." };
  if (endSec - startSec < 5) return { error: "Un clip doit durer au moins 5 secondes." };
  if (endSec - startSec > 180) return { error: "Un clip ne peut pas dépasser 3 minutes (limite des formats courts)." };

  // Options de montage : on ne garde sur le clip que ce qui diffère des réglages par défaut,
  // pour qu'un changement de défaut s'applique encore aux clips qu'on n'a pas personnalisés.
  const defaults = parseSettings(user.settings);
  const before = effectiveEdit(defaults, clip.edit);
  const styleRaw = String(form.get("captionStyle") ?? before.captionStyle);
  const after: ClipEdit = {
    captionStyle: (CAPTION_STYLE_KEYS as readonly string[]).includes(styleRaw) ? (styleRaw as ClipEdit["captionStyle"]) : before.captionStyle,
    coldOpen: form.get("coldOpen") === "on",
    trimSilence: form.get("trimSilence") === "on",
    punchZoom: form.get("punchZoom") === "on",
    progressBar: form.get("progressBar") === "on",
    endCard: form.get("endCard") === "on",
  };
  const base = effectiveEdit(defaults, {});
  const edit: Partial<ClipEdit> = {};
  for (const k of Object.keys(after) as Array<keyof ClipEdit>) {
    if (after[k] !== base[k]) (edit as Record<string, unknown>)[k] = after[k];
  }
  const editChanged = (Object.keys(after) as Array<keyof ClipEdit>).some((k) => after[k] !== before[k]);

  const needsRender =
    hook !== clip.hook || captions !== clip.captions || template !== clip.template || editChanged ||
    Math.abs(startSec - clip.startSec) > 0.05 || Math.abs(endSec - clip.endSec) > 0.05;

  await db.clip.update({
    where: { id },
    data: { title, hook, description, hashtags, captions, template, startSec, endSec, edit: edit as Prisma.InputJsonValue, error: null },
  });
  if (needsRender) await enqueue("clip.render", { clipId: id }, { maxAttempts: 2 });
  revalidatePath(`/app/clips/${id}`);
  return { ok: needsRender ? "Enregistré. Le clip est en cours de remontage (une dizaine de secondes)…" : "Enregistré." };
}

export async function setClipStatus(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "");
  if (status !== "APPROVED" && status !== "REJECTED" && status !== "READY") return;
  await db.clip.updateMany({ where: { id, userId: user.id, status: { in: ["READY", "APPROVED", "REJECTED"] } }, data: { status } });
  revalidatePath("/app/clips");
  revalidatePath(`/app/clips/${id}`);
}

export async function deleteClip(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const res = await db.clip.deleteMany({ where: { id, userId: user.id } });
  if (res.count) await removeDir(clipDir(id));
  revalidatePath("/app/clips");
  redirect("/app/clips");
}

export async function retryClip(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const res = await db.clip.updateMany({ where: { id, userId: user.id, status: "FAILED" }, data: { status: "PROCESSING", error: null } });
  if (res.count) await enqueue("clip.process", { clipId: id });
  revalidatePath(`/app/clips/${id}`);
}

/** Programme la publication d'un clip sur un ou plusieurs comptes. */
export async function publishClip(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const clip = await db.clip.findFirst({ where: { id, userId: user.id } });
  if (!clip) return { error: "Clip introuvable." };
  if (!clip.hasFinal || clip.status === "PROCESSING") return { error: "Le montage n'est pas terminé." };

  const accountIds = form.getAll("account").map(String);
  if (accountIds.length === 0) return { error: "Choisis au moins un compte." };
  const accounts = await db.socialAccount.findMany({ where: { id: { in: accountIds }, userId: user.id } });
  if (accounts.length === 0) return { error: "Compte introuvable." };
  const invalid = accounts.find((a) => !a.valid);
  if (invalid) return { error: `Le compte « ${invalid.displayName} » doit être reconnecté avant de publier.` };

  let scheduledAt = new Date();
  const when = String(form.get("scheduledAt") ?? "");
  if (when) {
    const d = new Date(when);
    if (Number.isNaN(d.getTime())) return { error: "Date de publication invalide." };
    if (d.getTime() < Date.now() - 60_000) return { error: "La date de publication est déjà passée." };
    if (d.getTime() > Date.now() + 60 * 86_400_000) return { error: "Tu peux programmer jusqu'à 60 jours à l'avance." };
    scheduledAt = d;
  }

  // Un même clip ne part pas deux fois sur le même compte.
  const already = await db.publication.findMany({
    where: { clipId: id, accountId: { in: accounts.map((a) => a.id) }, status: { in: ["QUEUED", "UPLOADING", "PROCESSING", "PUBLISHED"] } },
    select: { accountId: true },
  });
  const skip = new Set(already.map((p) => p.accountId));
  const targets = accounts.filter((a) => !skip.has(a.id));
  if (targets.length === 0) return { error: "Ce clip est déjà publié ou programmé sur ces comptes." };

  for (const account of targets) {
    const adapter = PLATFORMS[account.platform];
    const wanted = String(form.get(`privacy_${account.platform}`) ?? adapter.defaultPrivacy);
    const privacy = adapter.privacyOptions.some((o) => o.value === wanted) ? wanted : adapter.defaultPrivacy;
    const pub = await db.publication.create({
      data: { userId: user.id, clipId: id, accountId: account.id, title: clip.title, description: clip.description, privacy, scheduledAt },
    });
    await enqueue("publish", { publicationId: pub.id }, { runAt: scheduledAt, maxAttempts: 3 });
  }
  if (clip.status === "READY") await db.clip.update({ where: { id }, data: { status: "APPROVED" } });
  revalidatePath(`/app/clips/${id}`);
  revalidatePath("/app/queue");
  const n = targets.length;
  return { ok: when ? `Programmé sur ${n} compte${n > 1 ? "s" : ""}.` : `Envoi lancé sur ${n} compte${n > 1 ? "s" : ""}. Suis l'avancement dans « Publications ».` };
}

export async function cancelPublication(form: FormData): Promise<void> {
  const user = await requireUser();
  await db.publication.updateMany({ where: { id: String(form.get("id") ?? ""), userId: user.id, status: "QUEUED" }, data: { status: "CANCELED" } });
  revalidatePath("/app/queue");
}

export async function retryPublication(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const res = await db.publication.updateMany({
    where: { id, userId: user.id, status: { in: ["FAILED", "CANCELED"] } },
    data: { status: "QUEUED", error: null, scheduledAt: new Date() },
  });
  if (res.count) await enqueue("publish", { publicationId: id }, { maxAttempts: 3 });
  revalidatePath("/app/queue");
}
