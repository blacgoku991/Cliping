"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { DEFAULT_AUTOPILOT, parseAutopilotConfig, type AutopilotConfig } from "@/lib/autopilot";
import { parseState } from "@/lib/autopilot-data";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

function num(form: FormData, name: string): number {
  return Number(form.get(name) ?? NaN);
}

function revalidate() {
  revalidatePath("/app/autopilot");
  revalidatePath("/app/autopilot/journal");
  revalidatePath("/app/queue");
}

/** Résumé en une ligne des règles, pour le journal. */
function describe(c: AutopilotConfig): string {
  const parts = [
    c.approve ? `approbation dès ${c.minScore}` : "pas d'approbation automatique",
    c.schedule ? `programmation sur ${c.accounts.length} compte(s)` : "pas de programmation",
    c.allStreamers ? "tous les streamers" : `${c.streamers.length} streamer(s) autorisé(s)`,
    `${c.globalDailyCap}/24 h au total, ${c.perAccountCap}/24 h par compte`,
    `écart ${c.gapMin} min`,
    `délai de grâce ${c.graceMin} min`,
    c.window.from === c.window.to ? "toute la journée" : `${c.window.from} h – ${c.window.to} h`,
  ];
  return parts.join(" · ");
}

export async function saveAutopilot(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const [accounts, streamers] = await Promise.all([
    db.socialAccount.findMany({ where: { userId: user.id }, select: { id: true } }),
    db.streamer.findMany({ where: { userId: user.id }, select: { id: true } }),
  ]);
  const accountIds = new Set(accounts.map((a) => a.id));
  const streamerIds = new Set(streamers.map((s) => s.id));
  const raw = {
    approve: form.get("approve") === "on",
    minScore: num(form, "minScore"),
    schedule: form.get("schedule") === "on",
    allStreamers: form.get("allStreamers") === "on",
    streamers: form.getAll("streamers").map(String).filter((id) => streamerIds.has(id)),
    accounts: form.getAll("accounts").map(String).filter((id) => accountIds.has(id)),
    perAccountCap: num(form, "perAccountCap"),
    globalDailyCap: num(form, "globalDailyCap"),
    gapMin: num(form, "gapMin"),
    staggerMin: num(form, "staggerMin"),
    graceMin: num(form, "graceMin"),
    window: { from: num(form, "windowFrom"), to: num(form, "windowTo") },
    maxClipAgeH: num(form, "maxClipAgeH"),
    tz: String(form.get("tz") ?? ""),
  };
  const config = parseAutopilotConfig(raw);
  if (config.schedule && config.accounts.length === 0) return { error: "Choisis au moins un compte pour la programmation automatique (ou décoche-la)." };
  if (!config.allStreamers && config.streamers.length === 0) return { error: "Choisis au moins un streamer autorisé, ou coche « Tous mes streamers »." };

  await db.autopilot.upsert({
    where: { userId: user.id },
    update: { config: config as unknown as Prisma.InputJsonValue },
    create: { userId: user.id, config: config as unknown as Prisma.InputJsonValue },
  });
  await db.autopilotLog.create({ data: { userId: user.id, kind: "config", message: `Règles enregistrées : ${describe(config)}.` } });
  revalidate();
  return { ok: "Règles enregistrées. Elles s'appliquent dès le prochain passage du pilote (moins d'une minute)." };
}

/** Démarre le pilote, en simulation ou pour de vrai (accord explicite exigé pour le vrai mode). */
export async function startAutopilot(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const mode = String(form.get("mode") ?? "simulation");
  const real = mode === "real";
  if (real && form.get("consent") !== "on") {
    return { error: "Coche la case pour confirmer que tu acceptes que le pilote publie sans relecture sur tes comptes." };
  }
  const existing = await db.autopilot.findUnique({ where: { userId: user.id } });
  const config = parseAutopilotConfig(existing?.config ?? DEFAULT_AUTOPILOT);
  if (!existing) return { error: "Enregistre d'abord tes règles." };
  if (!config.allStreamers && config.streamers.length === 0) return { error: "Choisis au moins un streamer autorisé dans les règles." };
  if (!config.approve && !config.schedule) return { error: "Active au moins une règle (approbation ou programmation)." };

  await db.autopilot.update({ where: { userId: user.id }, data: { enabled: true, dryRun: !real, enabledAt: new Date() } });
  await db.autopilotLog.create({
    data: {
      userId: user.id,
      kind: "start",
      dryRun: !real,
      message: real ? `Pilote démarré pour de vrai : ${describe(config)}.` : `Simulation démarrée : le pilote note ce qu'il ferait, sans rien approuver ni publier. ${describe(config)}.`,
    },
  });
  // Rien d'automatique ne doit annoncer après coup des clips sortis avant le démarrage : on s'assure que les notifications existent.
  await db.notifySettings.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
  revalidate();
  return { ok: real ? "Pilote en marche." : "Simulation en marche : regarde le journal dans une minute." };
}

/**
 * Arrêt immédiat : le pilote ne fait plus rien, et ses publications programmées qui ne sont pas encore parties
 * sont annulées. Formulaire simple (fonctionne même sans JavaScript).
 */
export async function stopAutopilot(form: FormData): Promise<void> {
  const user = await requireUser();
  const keepQueued = form.get("keep") === "1";
  await db.$transaction(async (tx) => {
    // Même verrou que le worker : si un passage est en cours, l'arrêt attend sa fin puis annule ce qu'il a créé.
    await tx.$queryRaw`SELECT 1 FROM "Autopilot" WHERE "userId" = ${user.id} FOR UPDATE`;
    await tx.autopilot.updateMany({ where: { userId: user.id }, data: { enabled: false, stoppedAt: new Date() } });
    let canceled = 0;
    if (!keepQueued) {
      const res = await tx.publication.updateMany({
        where: { userId: user.id, autopilot: true, status: "QUEUED" },
        data: { status: "CANCELED", note: "Annulée par l'arrêt du pilote automatique." },
      });
      canceled = res.count;
    }
    const inFlight = await tx.publication.count({ where: { userId: user.id, autopilot: true, status: { in: ["UPLOADING", "PROCESSING"] } } });
    await tx.autopilotLog.create({
      data: {
        userId: user.id,
        kind: "stop",
        message: `Pilote arrêté. ${keepQueued ? "Publications programmées conservées." : `${canceled} publication(s) programmée(s) annulée(s).`}${inFlight ? ` ${inFlight} envoi(s) déjà en cours n'ont pas pu être arrêtés.` : ""}`,
      },
    });
  });
  revalidate();
}

/** Annule une publication programmée par le pilote (pendant le délai de grâce, ou plus tard tant qu'elle n'est pas partie). */
export async function cancelPilotPublication(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const pub = await db.publication.findFirst({ where: { id, userId: user.id, autopilot: true }, include: { clip: { select: { title: true } } } });
  if (!pub) return;
  const res = await db.publication.updateMany({ where: { id, userId: user.id, status: "QUEUED" }, data: { status: "CANCELED", note: "Annulée à la main." } });
  if (res.count) {
    await db.autopilotLog.create({ data: { userId: user.id, kind: "cancel", publicationId: id, clipId: pub.clipId, accountId: pub.accountId, message: `Tu as annulé « ${pub.clip.title} » : le pilote ne le reprogrammera pas.` } });
  }
  revalidate();
}

/** Reprend un compte mis en pause par le pilote. Les échecs antérieurs ne comptent plus. */
export async function resumePilotAccount(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const ap = await db.autopilot.findUnique({ where: { userId: user.id } });
  if (!ap) return;
  const state = parseState(ap.state);
  if (!state.paused[id]) return;
  delete state.paused[id];
  state.resumedAt[id] = new Date().toISOString();
  await db.autopilot.update({ where: { userId: user.id }, data: { state: state as unknown as Prisma.InputJsonValue } });
  const acc = await db.socialAccount.findFirst({ where: { id, userId: user.id }, select: { displayName: true } });
  await db.autopilotLog.create({ data: { userId: user.id, kind: "resume", accountId: id, message: `Tu as repris ${acc?.displayName ?? "le compte"} : le pilote peut de nouveau l'utiliser.` } });
  revalidate();
}
