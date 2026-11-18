/**
 * Ce que le bot fait quand l'utilisateur n'est pas là : pilote automatique et notifications.
 * Tout passe par l'observation de la base (clips prêts, publications échouées, comptes invalides) :
 * le code qui produit ces états n'est pas modifié.
 */
import type { Prisma } from "@prisma/client";
import { decide } from "@/lib/autopilot";
import { loadDecisionInput, parseState, type AutopilotState } from "@/lib/autopilot-data";
import { db } from "@/lib/db";
import { localParts } from "@/lib/local-time";
import { parsePrefs, planDispatch } from "@/lib/notify-plan";
import { sendToChannel } from "@/lib/notify/send";
import { PLATFORMS } from "@/lib/platforms";
import { DAY_MS } from "@/lib/schedule";
import { log } from "./proc";

export const AUTOMATION_INTERVAL_SEC = 20;

function hhmm(ms: number, tz: string): string {
  const m = localParts(ms, tz).minutes;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

async function notify(userId: string, type: string, refKey: string, title: string, body: string, url: string): Promise<void> {
  await db.notification.createMany({ data: [{ userId, type, refKey, title, body, url }], skipDuplicates: true });
}

// ───────────────────────── Pilote ─────────────────────────

/** Pause d'un compte après deux publications échouées d'affilée ; signalement des comptes à reconnecter. */
async function updateAccountPauses(userId: string, accountIds: string[], state: AutopilotState, dryRun: boolean): Promise<boolean> {
  let changed = false;
  const accounts = await db.socialAccount.findMany({ where: { userId, id: { in: accountIds } } });
  for (const a of accounts) {
    const label = `${a.displayName} (${PLATFORMS[a.platform].label})`;
    if (!a.valid && !state.invalidSeen.includes(a.id)) {
      state.invalidSeen.push(a.id);
      changed = true;
      await db.autopilotLog.create({ data: { userId, kind: "pause", dryRun, accountId: a.id, message: `${label} mis de côté : la connexion est à refaire (page Comptes). Le pilote reprendra seul après la reconnexion.` } });
      await notify(userId, "autopilot", `ap-invalid:${a.id}:${a.updatedAt.getTime()}`, "Pilote : compte mis de côté", `${label} doit être reconnecté. Le pilote ne publie plus dessus en attendant.`, "/app/accounts");
    } else if (a.valid && state.invalidSeen.includes(a.id)) {
      state.invalidSeen = state.invalidSeen.filter((x) => x !== a.id);
      changed = true;
      await db.autopilotLog.create({ data: { userId, kind: "resume", dryRun, accountId: a.id, message: `${label} est reconnecté : le pilote peut de nouveau l'utiliser.` } });
    }
    if (state.paused[a.id]) continue;
    const resumed = state.resumedAt[a.id] ? new Date(state.resumedAt[a.id]!) : new Date(0);
    const last = await db.publication.findMany({
      where: { userId, accountId: a.id, status: { in: ["FAILED", "PUBLISHED", "PROCESSING"] }, scheduledAt: { gte: resumed } },
      orderBy: { scheduledAt: "desc" },
      take: 2,
      select: { status: true, error: true },
    });
    if (last.length === 2 && last.every((p) => p.status === "FAILED")) {
      const reason = `2 publications échouées d'affilée (${(last[0]!.error ?? "erreur inconnue").slice(0, 120)})`;
      state.paused[a.id] = reason;
      changed = true;
      await db.autopilotLog.create({ data: { userId, kind: "pause", dryRun, accountId: a.id, message: `${label} mis en pause : ${reason}. Reprends-le depuis la page du pilote quand c'est réglé.` } });
      await notify(userId, "autopilot", `ap-pause:${a.id}:${Date.now()}`, "Pilote : compte en pause", `${label} : ${reason}.`, "/app/autopilot");
    }
  }
  return changed;
}

export async function runAutopilot(userId: string): Promise<void> {
  const ap = await db.autopilot.findUnique({ where: { userId } });
  if (!ap?.enabled) return;
  const now = Date.now();
  const state = parseState(ap.state);
  const cfgAccounts = ((ap.config as { accounts?: unknown })?.accounts as string[] | undefined) ?? [];
  await updateAccountPauses(userId, Array.isArray(cfgAccounts) ? cfgAccounts : [], state, ap.dryRun);

  const loaded = await loadDecisionInput(userId, { ...ap, state: state as unknown as Prisma.JsonValue }, now);
  const decision = decide(loaded.input);
  const { config } = loaded;
  const dry = ap.dryRun;
  const prefix = dry ? "Simulation : aurait " : "";
  const title = (id: string) => `« ${loaded.clipTitles.get(id) ?? "clip"} »`;

  // Transaction avec verrou sur la ligne du pilote : si l'utilisateur appuie sur « Arrêter » pendant ce passage,
  // l'arrêt attend la fin de la transaction, et ce passage voit l'arrêt s'il a été enregistré avant.
  const created = await db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ enabled: boolean; dryRun: boolean }>>`SELECT "enabled", "dryRun" FROM "Autopilot" WHERE "userId" = ${userId} FOR UPDATE`;
      const fresh = rows[0];
      if (!fresh?.enabled || fresh.dryRun !== dry) return [] as Array<{ at: number; account: string }>;

      for (const a of decision.approve) {
        if (dry) {
          if (loaded.simulatedApproved.has(a.clipId)) continue;
          await tx.autopilotLog.create({ data: { userId, kind: "approve", dryRun: true, clipId: a.clipId, message: `${prefix}approuvé ${title(a.clipId)} : ${a.reason}.` } });
        } else {
          const res = await tx.clip.updateMany({ where: { id: a.clipId, userId, status: "READY" }, data: { status: "APPROVED" } });
          if (res.count) await tx.autopilotLog.create({ data: { userId, kind: "approve", clipId: a.clipId, message: `Approuvé ${title(a.clipId)} : ${a.reason}.` } });
        }
      }

      const done: Array<{ at: number; account: string }> = [];
      for (const r of decision.schedule) {
        const account = loaded.accountLabels.get(r.accountId) ?? "compte";
        const when = hhmm(r.at, config.tz);
        if (dry) {
          await tx.autopilotLog.create({
            data: { userId, kind: "schedule", dryRun: true, clipId: r.clipId, accountId: r.accountId, plannedAt: new Date(r.at), message: `${prefix}programmé ${title(r.clipId)} sur ${account} à ${when} : ${r.reason}.` },
          });
          done.push({ at: r.at, account });
          continue;
        }
        // Revérifié sous verrou : l'utilisateur a pu programmer ce clip à la main entre-temps.
        const clip = await tx.clip.findFirst({ where: { id: r.clipId, userId, status: "APPROVED", hasFinal: true, publications: { none: {} } } });
        const acc = await tx.socialAccount.findFirst({ where: { id: r.accountId, userId, valid: true } });
        if (!clip || !acc) continue;
        const adapter = PLATFORMS[acc.platform];
        const privacy = acc.defaultPrivacy && adapter.privacyOptions.some((o) => o.value === acc.defaultPrivacy) ? acc.defaultPrivacy : adapter.defaultPrivacy;
        const pub = await tx.publication.create({
          data: { userId, clipId: clip.id, accountId: acc.id, title: clip.title, description: clip.description, privacy, scheduledAt: new Date(r.at), autopilot: true },
        });
        await tx.job.create({ data: { type: "publish", payload: { publicationId: pub.id }, runAt: new Date(r.at), maxAttempts: 3 } });
        await tx.autopilotLog.create({
          data: { userId, kind: "schedule", clipId: clip.id, accountId: acc.id, publicationId: pub.id, plannedAt: new Date(r.at), message: `Programmé ${title(clip.id)} sur ${account} à ${when} : ${r.reason}. Annulable jusqu'à l'envoi.` },
        });
        done.push({ at: r.at, account });
      }

      // Clips écartés : une seule ligne de journal par clip et par raison.
      if (decision.skipped.length) {
        const seen = await tx.autopilotLog.findMany({
          where: { userId, kind: "skip", clipId: { in: decision.skipped.map((s) => s.clipId) }, at: { gte: new Date(now - 2 * DAY_MS) } },
          select: { clipId: true },
        });
        const seenIds = new Set(seen.map((s) => s.clipId));
        for (const s of decision.skipped) {
          if (seenIds.has(s.clipId)) continue;
          seenIds.add(s.clipId);
          await tx.autopilotLog.create({ data: { userId, kind: "skip", dryRun: dry, clipId: s.clipId, message: `Laissé de côté ${title(s.clipId)} : ${s.reason}.` } });
        }
      }

      state.lastNotes = [...decision.notes, ...decision.blocked.map((b) => `${loaded.accountLabels.get(b.accountId) ?? "Compte"} écarté : ${b.reason}.`)];
      await tx.autopilot.update({ where: { userId }, data: { state: state as unknown as Prisma.InputJsonValue, lastRunAt: new Date(now) } });
      return done;
    },
    { timeout: 30_000 },
  );

  if (created.length) {
    const first = Math.min(...created.map((c) => c.at));
    const accounts = [...new Set(created.map((c) => c.account))].join(", ");
    const n = created.length;
    log("autopilot", `${dry ? "[simulation] " : ""}${n} publication(s) programmée(s) pour ${userId}`);
    await notify(
      userId,
      "autopilot",
      `ap-sched:${now}`,
      dry ? `Simulation : ${n} clip${n > 1 ? "s" : ""} auraient été programmés` : `Pilote : ${n} clip${n > 1 ? "s" : ""} programmé${n > 1 ? "s" : ""}`,
      dry
        ? `Rien n'est publié (mode simulation). Comptes : ${accounts}.`
        : `Premier envoi à ${hhmm(first, config.tz)} sur ${accounts}. Tu peux encore annuler d'ici là.`,
      "/app/autopilot",
    );
  }
}

// ───────────────────────── Notifications : détection ─────────────────────────

export async function scanEvents(userId: string, settings: { since: Date; prefs: unknown }): Promise<void> {
  const now = Date.now();
  const prefs = parsePrefs(settings.prefs);
  const since = new Date(Math.max(settings.since.getTime(), now - DAY_MS));
  const events: Prisma.NotificationCreateManyInput[] = [];

  const ready = await db.clip.findMany({
    where: { userId, status: "READY", hasFinal: true, createdAt: { gte: since } },
    select: { id: true, title: true, score: true, streamer: { select: { displayName: true } }, recording: { select: { author: true } } },
    take: 100,
  });
  for (const c of ready) {
    const who = c.streamer?.displayName ?? c.recording?.author ?? "un live";
    events.push({ userId, type: "clipReady", refKey: `clip:${c.id}`, title: "Clip prêt à valider", body: `${c.title || "Nouveau clip"} — ${who} · score ${c.score}`, url: `/app/clips/${c.id}` });
  }

  const failed = await db.publication.findMany({
    where: { userId, status: "FAILED", scheduledAt: { gte: since } },
    select: { id: true, title: true, error: true, account: { select: { displayName: true, platform: true } } },
    take: 100,
  });
  for (const p of failed) {
    events.push({
      userId,
      type: "publishFailed",
      refKey: `pubfail:${p.id}`,
      title: "Publication échouée",
      body: `${p.title} sur ${p.account.displayName} (${PLATFORMS[p.account.platform].label}) : ${(p.error ?? "erreur inconnue").slice(0, 160)}`,
      url: "/app/queue",
    });
  }

  const invalid = await db.socialAccount.findMany({ where: { userId, valid: false, updatedAt: { gte: since } }, select: { id: true, displayName: true, platform: true, updatedAt: true } });
  for (const a of invalid) {
    events.push({
      userId,
      type: "accountInvalid",
      refKey: `acct:${a.id}:${a.updatedAt.getTime()}`,
      title: "Compte à reconnecter",
      body: `${a.displayName} (${PLATFORMS[a.platform].label}) a perdu son accès : plus rien ne part dessus tant qu'il n'est pas reconnecté.`,
      url: "/app/accounts",
    });
  }

  // Résumé quotidien, une fois par jour local, à partir de l'heure choisie.
  const local = localParts(now, prefs.tz);
  if (prefs.types.digest && local.minutes >= prefs.digestHour * 60 && now - settings.since.getTime() > 3600_000) {
    const refKey = `digest:${local.day}`;
    const exists = await db.notification.findUnique({ where: { userId_refKey: { userId, refKey } }, select: { id: true } });
    if (!exists) {
      const day = new Date(now - DAY_MS);
      const [made, waiting, published, failedN, pilot] = await Promise.all([
        db.clip.count({ where: { userId, createdAt: { gte: day }, status: { notIn: ["PROCESSING", "FAILED"] } } }),
        db.clip.count({ where: { userId, status: "READY" } }),
        db.publication.count({ where: { userId, status: "PUBLISHED", publishedAt: { gte: day } } }),
        db.publication.count({ where: { userId, status: "FAILED", scheduledAt: { gte: day } } }),
        db.publication.count({ where: { userId, autopilot: true, createdAt: { gte: day }, status: { not: "CANCELED" } } }),
      ]);
      const lines = [
        `${made} clip${made > 1 ? "s" : ""} sorti${made > 1 ? "s" : ""} en 24 h, ${waiting} à valider.`,
        `${published} publié${published > 1 ? "s" : ""}${failedN ? `, ${failedN} échec${failedN > 1 ? "s" : ""}` : ""}.`,
      ];
      if (pilot) lines.push(`Pilote : ${pilot} programmé${pilot > 1 ? "s" : ""}.`);
      events.push({ userId, type: "digest", refKey, title: "Résumé de la journée", body: lines.join("\n"), url: waiting ? "/app/review" : "/app" });
    }
  }

  if (events.length) await db.notification.createMany({ data: events, skipDuplicates: true });
}

// ───────────────────────── Notifications : envoi ─────────────────────────

export async function dispatch(userId: string): Promise<void> {
  const settings = await db.notifySettings.findUnique({ where: { userId } });
  if (!settings) return;
  const now = Date.now();
  // Ce qui n'a pas pu partir en 12 h n'a plus d'intérêt (sauf le silence de nuit, plus court que ça).
  await db.notification.updateMany({ where: { userId, status: "PENDING", createdAt: { lt: new Date(now - 12 * 3600_000) } }, data: { status: "SKIPPED" } });
  const pending = await db.notification.findMany({ where: { userId, status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 200 });
  if (!pending.length) return;
  const channels = await db.notifyChannel.findMany({ where: { userId, enabled: true } });
  if (!channels.length) {
    await db.notification.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { status: "SKIPPED" } });
    return;
  }
  const plan = planDispatch({
    pending: pending.map((p) => ({ id: p.id, type: p.type as never, title: p.title, body: p.body, url: p.url, createdAt: p.createdAt.getTime() })),
    prefs: parsePrefs(settings.prefs),
    lastSentAt: settings.lastSentAt?.getTime() ?? null,
    now,
  });
  if (plan.skip.length) await db.notification.updateMany({ where: { id: { in: plan.skip } }, data: { status: "SKIPPED" } });
  let sentSomething = false;
  for (const msg of plan.send) {
    const results = await Promise.all(channels.map((c) => sendToChannel(c, msg)));
    const okCount = results.filter((r) => r.ok).length;
    if (okCount > 0) {
      sentSomething = true;
      await db.notification.updateMany({ where: { id: { in: msg.ids } }, data: { status: "SENT", sentAt: new Date(), sentAs: msg.title.slice(0, 200) } });
    }
    const errors = results.filter((r): r is { ok: false; error: string } => !r.ok).map((r) => r.error);
    log("notify", `« ${msg.title} » → ${okCount}/${channels.length} canal(aux)${errors.length ? ` · ${errors.join(" | ")}` : ""}`);
  }
  if (sentSomething) await db.notifySettings.update({ where: { userId }, data: { lastSentAt: new Date(now) } });
}

/** Un passage complet : pilote d'abord (un clip approuvé seul n'est plus « à valider »), puis détection et envoi. */
export async function automationTick(): Promise<void> {
  const [pilots, notifs] = await Promise.all([
    db.autopilot.findMany({ where: { enabled: true }, select: { userId: true } }),
    db.notifySettings.findMany({ select: { userId: true, since: true, prefs: true } }),
  ]);
  for (const p of pilots) {
    await runAutopilot(p.userId).catch((err) => log("autopilot", `erreur (${p.userId}) : ${err instanceof Error ? err.message : err}`));
  }
  for (const n of notifs) {
    await scanEvents(n.userId, n).catch((err) => log("notify", `détection en erreur (${n.userId}) : ${err instanceof Error ? err.message : err}`));
    await dispatch(n.userId).catch((err) => log("notify", `envoi en erreur (${n.userId}) : ${err instanceof Error ? err.message : err}`));
  }
}
