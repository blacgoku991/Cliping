"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ACTIVE_PUB, planAccountsFor } from "@/lib/batch";
import { cleanLabel, cleanTag, DEFAULT_MOMENTS, MAX_MOMENTS, MIN_MOMENTS, momentLabels, montageSignature, orderMoments, pickBest } from "@/lib/compilation";
import { compilationDir } from "@/lib/compilation-files";
import { candidatesFor, ELIGIBLE, toCandidate, type ProposalKind } from "@/lib/compilation-proposals";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { PLATFORMS } from "@/lib/platforms";
import { checkPlan } from "@/lib/schedule";
import { requireUser } from "@/lib/session";
import { removeDir } from "@/lib/storage";
import type { FormState } from "./auth";

const LABEL_MAX = 80;

async function startRender(id: string, thumbOnly = false): Promise<void> {
  if (!thumbOnly) await db.compilation.update({ where: { id }, data: { status: "RENDERING", progress: 0, error: null } });
  await enqueue("compilation.render", { compilationId: id, ...(thumbOnly ? { thumbOnly: true } : {}) }, { maxAttempts: 2 });
}

/** « Faire le best-of » : choisit les meilleurs moments d'un live, d'un streamer ou des dernières 24 h, et lance le montage. */
export async function createFromProposal(form: FormData): Promise<void> {
  const user = await requireUser();
  const kind = String(form.get("kind") ?? "") as ProposalKind;
  const id = String(form.get("id") ?? "");
  if (!["recording", "streamer", "day"].includes(kind)) redirect("/app/compilations");
  if (kind === "recording" && !(await db.recording.findFirst({ where: { id, userId: user.id }, select: { id: true } }))) redirect("/app/compilations");
  if (kind === "streamer" && !(await db.streamer.findFirst({ where: { id, userId: user.id }, select: { id: true } }))) redirect("/app/compilations");

  const picked = orderMoments(pickBest(await candidatesFor(user.id, kind, id), DEFAULT_MOMENTS), "countdown");
  if (picked.length < MIN_MOMENTS) redirect("/app/compilations?error=moments");
  const labels = momentLabels(picked, LABEL_MAX);
  const comp = await db.compilation.create({
    data: {
      userId: user.id,
      origin: { kind, id },
      items: { create: picked.map((p, i) => ({ clipId: p.clipId, position: i, label: labels[i]! })) },
    },
  });
  await startRender(comp.id);
  revalidatePath("/app/compilations");
  redirect(`/app/compilations/${comp.id}`);
}

/** Compilation composée à la main : les clips cochés, dans l'ordre choisi (le meilleur à la fin par défaut). */
export async function createManual(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const ids = [...new Set(form.getAll("clip").map(String))];
  if (ids.length < MIN_MOMENTS) return { error: `Choisis au moins ${MIN_MOMENTS} clips (YouTube n'affiche les chapitres qu'à partir de 3).` };
  if (ids.length > MAX_MOMENTS) return { error: `${MAX_MOMENTS} moments au maximum par compilation.` };
  const clips = await db.clip.findMany({
    where: { id: { in: ids }, userId: user.id, ...ELIGIBLE },
    select: { id: true, title: true, score: true, originSec: true, peakSec: true, startSec: true, endSec: true, recordingId: true, streamerId: true, createdAt: true, hasFinal: true },
  });
  if (clips.length < MIN_MOMENTS) return { error: "Certains clips ne sont plus disponibles (écartés ou supprimés). Recharge la page." };
  const order = String(form.get("order") ?? "countdown") === "chrono" ? "chrono" : "countdown";
  const picked = orderMoments(clips.map(toCandidate), order);
  const labels = momentLabels(picked, LABEL_MAX);
  const comp = await db.compilation.create({
    data: {
      userId: user.id,
      countdown: order === "countdown",
      origin: { kind: "manual" },
      items: { create: picked.map((p, i) => ({ clipId: p.clipId, position: i, label: labels[i]! })) },
    },
  });
  revalidatePath("/app/compilations");
  redirect(`/app/compilations/${comp.id}`);
}

interface ItemInput {
  clipId: string;
  label: string;
}

function parseItems(raw: string): ItemInput[] | null {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data) || data.length > MAX_MOMENTS) return null;
    const out: ItemInput[] = [];
    for (const d of data) {
      if (!d || typeof d !== "object") return null;
      const { clipId, label } = d as Record<string, unknown>;
      if (typeof clipId !== "string" || typeof label !== "string") return null;
      out.push({ clipId, label: cleanLabel(label, LABEL_MAX) });
    }
    return out;
  } catch {
    return null;
  }
}

function tagsFrom(raw: string): string[] {
  return [...new Set(raw.split(/[,\n]+/).map(cleanTag).filter((t) => t.length >= 2))].slice(0, 20);
}

/**
 * Enregistre la compilation (moments, ordre, titres, options, texte de la miniature).
 * Avec `render=1` (bouton « Enregistrer et monter »), relance le montage ; si seul le texte
 * de la miniature a changé sur une compilation déjà montée, seule la miniature est refaite.
 */
export async function saveCompilation(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const comp = await db.compilation.findFirst({ where: { id, userId: user.id }, include: { items: { include: { clip: { select: { startSec: true, endSec: true } } } } } });
  if (!comp) return { error: "Compilation introuvable." };

  const items = parseItems(String(form.get("items") ?? "[]"));
  if (!items) return { error: "Liste des moments invalide : recharge la page." };
  if (items.length < MIN_MOMENTS) return { error: `Garde au moins ${MIN_MOMENTS} moments (YouTube n'affiche les chapitres qu'à partir de 3).` };
  if (new Set(items.map((i) => i.clipId)).size !== items.length) return { error: "Un même clip apparaît deux fois." };
  const owned = await db.clip.findMany({ where: { id: { in: items.map((i) => i.clipId) }, userId: user.id }, select: { id: true, startSec: true, endSec: true } });
  if (owned.length !== items.length) return { error: "Un des clips n'existe plus : recharge la page." };

  const title = cleanLabel(String(form.get("title") ?? ""), 100);
  if (!title) return { error: "Donne un titre à la vidéo." };
  const description = String(form.get("description") ?? "").replace(/[<>]/g, "").trim().slice(0, 3000);
  const thumbText = cleanLabel(String(form.get("thumbText") ?? ""), 40);
  const tags = tagsFrom(String(form.get("tags") ?? ""));
  const countdown = form.get("countdown") === "on";
  const captions = form.get("captions") === "on";
  const intro = form.get("intro") === "on";
  const wantRender = form.get("render") === "1";

  await db.$transaction([
    db.compilationItem.deleteMany({ where: { compilationId: id } }),
    db.compilationItem.createMany({ data: items.map((it, i) => ({ compilationId: id, clipId: it.clipId, position: i, label: it.label })) }),
    db.compilation.update({ where: { id }, data: { title, description, thumbText, tags, countdown, captions, intro, metaPending: false } }),
  ]);

  const spans = new Map(owned.map((c) => [c.id, c]));
  const signature = montageSignature({
    items: items.map((i) => ({ clipId: i.clipId, label: i.label, start: spans.get(i.clipId)!.startSec, end: spans.get(i.clipId)!.endSec })),
    countdown,
    captions,
    intro,
    title,
  });
  const rendered = ((comp.montage ?? {}) as { signature?: string }).signature;
  const videoStale = !comp.hasFinal || rendered !== signature;
  revalidatePath(`/app/compilations/${id}`);

  if (comp.status === "RENDERING") return { ok: "Enregistré. Un montage est en cours : relance-le quand il sera fini pour prendre en compte tes changements." };
  if (wantRender && videoStale) {
    await startRender(id);
    return { ok: "Enregistré. Montage lancé : compte environ 1 à 3 minutes pour 10 moments." };
  }
  if (comp.hasFinal && thumbText !== comp.thumbText) {
    await startRender(id, true);
    return { ok: videoStale ? "Enregistré. Miniature refaite ; la vidéo a changé, pense à la remonter." : "Enregistré. La miniature est en cours de mise à jour." };
  }
  return { ok: videoStale && comp.hasFinal ? "Enregistré. La vidéo ne correspond plus à la liste : remonte-la avant de publier." : "Enregistré." };
}

/** Ajoute des clips à la fin d'une compilation. */
export async function addMoments(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const comp = await db.compilation.findFirst({ where: { id, userId: user.id }, include: { items: { select: { clipId: true, position: true } } } });
  if (!comp) return { error: "Compilation introuvable." };
  const have = new Set(comp.items.map((i) => i.clipId));
  const ids = [...new Set(form.getAll("clip").map(String))].filter((c) => !have.has(c));
  if (!ids.length) return { error: "Coche au moins un clip à ajouter." };
  if (comp.items.length + ids.length > MAX_MOMENTS) return { error: `${MAX_MOMENTS} moments au maximum par compilation.` };
  const clips = await db.clip.findMany({ where: { id: { in: ids }, userId: user.id, ...ELIGIBLE }, select: { id: true, title: true } });
  const start = Math.max(-1, ...comp.items.map((i) => i.position)) + 1;
  await db.compilationItem.createMany({ data: clips.map((c, i) => ({ compilationId: id, clipId: c.id, position: start + i, label: cleanLabel(c.title, LABEL_MAX) })) });
  revalidatePath(`/app/compilations/${id}`);
  return { ok: `${clips.length} moment${clips.length > 1 ? "s" : ""} ajouté${clips.length > 1 ? "s" : ""} à la fin. Range-les puis remonte la vidéo.` };
}

export async function deleteCompilation(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const res = await db.compilation.deleteMany({ where: { id, userId: user.id } });
  if (res.count) await removeDir(compilationDir(id)).catch(() => {});
  revalidatePath("/app/compilations");
  redirect("/app/compilations");
}

/** Programme l'envoi de la compilation sur un ou plusieurs comptes YouTube (vidéo classique). */
export async function publishCompilation(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const comp = await db.compilation.findFirst({
    where: { id, userId: user.id },
    include: { items: { orderBy: { position: "asc" }, include: { clip: { select: { startSec: true, endSec: true } } } } },
  });
  if (!comp) return { error: "Compilation introuvable." };
  if (!comp.hasFinal || comp.status === "RENDERING") return { error: "Le montage n'est pas terminé." };
  const signature = montageSignature({
    items: comp.items.map((i) => ({ clipId: i.clipId, label: i.label, start: i.clip.startSec, end: i.clip.endSec })),
    countdown: comp.countdown,
    captions: comp.captions,
    intro: comp.intro,
    title: comp.title,
  });
  if (((comp.montage ?? {}) as { signature?: string }).signature !== signature) {
    return { error: "Tu as modifié la compilation depuis le dernier montage : remonte la vidéo avant de la publier." };
  }

  const accountIds = form.getAll("account").map(String);
  if (!accountIds.length) return { error: "Choisis au moins un compte YouTube." };
  const accounts = await db.socialAccount.findMany({ where: { id: { in: accountIds }, userId: user.id, platform: "YOUTUBE" } });
  if (!accounts.length) return { error: "Une compilation se publie sur un compte YouTube." };
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

  const already = await db.publication.findMany({
    where: { compilationId: id, accountId: { in: accounts.map((a) => a.id) }, status: { in: [...ACTIVE_PUB] } },
    select: { accountId: true },
  });
  const skip = new Set(already.map((p) => p.accountId));
  const targets = accounts.filter((a) => !skip.has(a.id));
  if (!targets.length) return { error: "Cette compilation est déjà publiée ou programmée sur ces comptes." };

  // Plafond sur 24 h glissantes réglé sur le compte : une compilation compte comme une publication.
  const capped = await planAccountsFor(user.id);
  for (const account of targets) {
    const plan = capped.find((p) => p.account.id === account.id)?.plan;
    if (!plan?.dailyCap) continue;
    if (checkPlan([{ clipId: id, accountId: account.id, at: scheduledAt.getTime() }], [plan], { gapMin: 0, now: Date.now() }).length) {
      return { error: `« ${account.displayName} » atteindrait son plafond de ${plan.dailyCap} publications sur 24 h. Programme plus tard ou change le plafond dans « Comptes ».` };
    }
  }

  const adapter = PLATFORMS.YOUTUBE;
  const wanted = String(form.get("privacy") ?? "");
  for (const account of targets) {
    const accountDefault = account.defaultPrivacy && adapter.privacyOptions.some((o) => o.value === account.defaultPrivacy) ? account.defaultPrivacy : adapter.defaultPrivacy;
    const privacy = adapter.privacyOptions.some((o) => o.value === wanted) ? wanted : accountDefault;
    const pub = await db.publication.create({
      data: { userId: user.id, compilationId: id, accountId: account.id, title: comp.title, description: comp.description, privacy, scheduledAt },
    });
    await enqueue("publish", { publicationId: pub.id }, { runAt: scheduledAt, maxAttempts: 3 });
  }
  revalidatePath(`/app/compilations/${id}`);
  revalidatePath("/app/queue");
  const n = targets.length;
  return { ok: when ? `Programmé sur ${n} chaîne${n > 1 ? "s" : ""}.` : `Envoi lancé sur ${n} chaîne${n > 1 ? "s" : ""}. Suis l'avancement dans « Publications ».` };
}
