import "server-only";
import { db } from "./db";
import { DAY_MS, type PlanAccount } from "./schedule";

export const ACTIVE_PUB = ["QUEUED", "UPLOADING", "PROCESSING", "PUBLISHED"] as const;

/** Données dont la planification en lot a besoin pour un compte (aperçu ET validation). */
export async function planAccountsFor(userId: string) {
  const accounts = await db.socialAccount.findMany({ where: { userId, valid: true }, orderBy: [{ platform: "asc" }, { createdAt: "asc" }] });
  const since = new Date(Date.now() - DAY_MS);
  const pubs = await db.publication.findMany({
    where: { userId, accountId: { in: accounts.map((a) => a.id) }, status: { in: [...ACTIVE_PUB] }, scheduledAt: { gte: since } },
    select: { accountId: true, scheduledAt: true, publishedAt: true },
  });
  return accounts.map((a) => ({
    account: a,
    plan: {
      id: a.id,
      dailyCap: a.dailyCap,
      existing: pubs.filter((p) => p.accountId === a.id).map((p) => (p.publishedAt ?? p.scheduledAt).getTime()),
    } satisfies PlanAccount,
  }));
}

