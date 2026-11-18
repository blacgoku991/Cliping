// Relevé régulier des performances des publications en ligne (vues, j'aime, commentaires, partages).
// Chaque publication a son prochain relevé (statsNextAt) : souvent dans les premières heures, puis de plus en plus rarement.
import type { Publication, SocialAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { accessTokenFor, PlatformRejectedError, ReauthRequiredError } from "@/lib/platforms";
import { nextCheckDelayMs } from "@/lib/stats/math";
import { BATCH_SIZE, fetchStats, trackability } from "@/lib/stats/platforms";
import { log } from "./proc";

const HOUR = 3600_000;
const MAX_PER_RUN = 2000;

function nextAt(pub: Pick<Publication, "publishedAt">, now: number): Date | null {
  const age = now - (pub.publishedAt ?? new Date(now)).getTime();
  const delay = nextCheckDelayMs(age);
  return delay === null ? null : new Date(now + delay);
}

async function setStatus(ids: string[], data: { statsStatus: string; statsError?: string | null; statsNextAt: Date | null }): Promise<void> {
  if (ids.length) await db.publication.updateMany({ where: { id: { in: ids } }, data: { statsError: null, ...data } });
}

/** Relève une série de publications d'un même compte. */
async function collectAccount(account: SocialAccount, pubs: Publication[], now: number): Promise<number> {
  // Celles qu'on ne peut pas suivre : on le note une fois pour l'interface, sans appeler la plateforme.
  const tracked: Publication[] = [];
  for (const p of pubs) {
    const t = trackability(p, account);
    if (t === "OK") tracked.push(p);
    // Brouillon ou identifiant inconnu : définitif. Autorisation manquante : on revérifie de temps en temps (reconnexion).
    else await setStatus([p.id], { statsStatus: t, statsNextAt: t === "NO_SCOPE" ? new Date(now + 6 * HOUR) : null });
  }
  if (tracked.length === 0) return 0;

  let token: string;
  try {
    token = await accessTokenFor(account);
  } catch (err) {
    await setStatus(
      tracked.map((p) => p.id),
      { statsStatus: "ERROR", statsError: err instanceof Error ? err.message : String(err), statsNextAt: new Date(now + 6 * HOUR) },
    );
    return 0;
  }

  let done = 0;
  const size = BATCH_SIZE[account.platform];
  for (let i = 0; i < tracked.length; i += size) {
    const batch = tracked.slice(i, i + size);
    try {
      const stats = await fetchStats(account.platform, token, batch.map((p) => p.externalId!));
      const at = new Date();
      for (const p of batch) {
        const s = stats.get(p.externalId!);
        if (!s) {
          // Absente de la réponse : supprimée, ou plus accessible au compte. On arrête de la suivre.
          await setStatus([p.id], { statsStatus: "NOT_FOUND", statsNextAt: null });
          continue;
        }
        const next = nextAt(p, at.getTime());
        await db.$transaction([
          db.publicationStat.create({
            data: { publicationId: p.id, userId: p.userId, at, views: s.views, likes: s.likes, comments: s.comments, shares: s.shares },
          }),
          db.publication.update({
            where: { id: p.id },
            data: {
              viewCount: s.views,
              likeCount: s.likes,
              commentCount: s.comments,
              shareCount: s.shares,
              statsAt: at,
              statsStatus: next ? "OK" : "ENDED",
              statsError: null,
              statsNextAt: next,
            },
          }),
        ]);
        done++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Quota épuisé, accès refusé : inutile d'insister avant plusieurs heures. Réseau : on réessaie au prochain passage.
      const definitive = err instanceof PlatformRejectedError || err instanceof ReauthRequiredError;
      if (err instanceof ReauthRequiredError) await db.socialAccount.update({ where: { id: account.id }, data: { valid: false } }).catch(() => {});
      await setStatus(
        batch.map((p) => p.id),
        { statsStatus: "ERROR", statsError: message.slice(0, 500), statsNextAt: new Date(now + (definitive ? 6 * HOUR : 20 * 60_000)) },
      );
      log("stats", `${account.platform} · ${account.displayName} : ${message}`);
      if (definitive) break;
    }
  }
  return done;
}

/**
 * Tâche « stats.collect » : relève toutes les publications dont le prochain relevé est dû.
 * Une publication de plus de 90 jours jamais relevée (antérieure au suivi) a un seul relevé, puis son suivi s'arrête.
 */
export async function collectStats(): Promise<void> {
  const now = Date.now();
  const due = await db.publication.findMany({
    where: {
      status: "PUBLISHED",
      publishedAt: { not: null },
      OR: [{ statsNextAt: null, statsStatus: null }, { statsNextAt: { lte: new Date(now) } }],
      account: { valid: true },
    },
    include: { account: true },
    orderBy: { statsNextAt: { sort: "asc", nulls: "first" } },
    take: MAX_PER_RUN,
  });
  if (due.length === 0) return;

  const byAccount = new Map<string, { account: SocialAccount; pubs: Publication[] }>();
  for (const { account, ...pub } of due) {
    const entry = byAccount.get(account.id) ?? { account, pubs: [] };
    entry.pubs.push(pub);
    byAccount.set(account.id, entry);
  }
  let total = 0;
  for (const { account, pubs } of byAccount.values()) total += await collectAccount(account, pubs, now);
  if (total) log("stats", `${total} relevé(s) de performances`);
}

/** Planification : met une tâche « stats.collect » en file toutes les 5 minutes s'il n'y en a pas déjà une. */
export async function statsLoop(stopped: () => boolean): Promise<void> {
  while (!stopped()) {
    try {
      const pending = await db.job.count({ where: { type: "stats.collect", status: { in: ["PENDING", "RUNNING"] } } });
      if (pending === 0) await enqueue("stats.collect", {}, { maxAttempts: 1 });
      // Une tâche toutes les 5 minutes : on ne garde pas l'historique des passages terminés.
      await db.job.deleteMany({ where: { type: "stats.collect", status: { in: ["DONE", "FAILED"] }, finishedAt: { lt: new Date(Date.now() - 3600_000) } } });
    } catch (err) {
      log("stats", `planification impossible : ${err instanceof Error ? err.message : err}`);
    }
    for (let i = 0; i < 60 && !stopped(); i++) await new Promise((r) => setTimeout(r, 5000));
  }
}
