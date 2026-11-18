import type { Job, Prisma } from "@prisma/client";
import { db } from "./db";

export type JobType = "clip.process" | "clip.render" | "vod.import" | "publish" | "publish.check" | "cleanup"
  | "stats.collect";

export interface JobPayloads {
  "clip.process": { clipId: string };
  "clip.render": { clipId: string };
  "vod.import": { recordingId: string };
  publish: { publicationId: string };
  "publish.check": { publicationId: string };
  cleanup: Record<string, never>;
  "stats.collect": Record<string, never>;
}

export async function enqueue<T extends JobType>(
  type: T,
  payload: JobPayloads[T],
  opts: { runAt?: Date; maxAttempts?: number } = {},
): Promise<Job> {
  return db.job.create({
    data: {
      type,
      payload: payload as Prisma.InputJsonValue,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 3,
    },
  });
}

/** Réserve la prochaine tâche exécutable (FOR UPDATE SKIP LOCKED : plusieurs workers peuvent cohabiter). */
export async function claimJob(workerId: string, types?: JobType[]): Promise<Job | null> {
  const typeFilter = types?.length ? types : null;
  const rows = await db.$queryRaw<Job[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId}, "attempts" = "attempts" + 1
    WHERE "id" = (
      SELECT "id" FROM "Job"
      WHERE "status" = 'PENDING' AND "runAt" <= now()
        AND (${typeFilter}::text[] IS NULL OR "type" = ANY(${typeFilter}::text[]))
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *`;
  return rows[0] ?? null;
}

export async function completeJob(id: string): Promise<void> {
  await db.job.update({ where: { id }, data: { status: "DONE", finishedAt: new Date(), lockedAt: null } });
}

/** Erreur à lever par un handler quand réessayer ne servirait à rien (jeton révoqué, fichier supprimé…). */
export class PermanentError extends Error {}

/**
 * Échec d'une tâche : nouvelle tentative avec délai exponentiel tant qu'il reste des essais.
 * Renvoie true si la tâche sera retentée.
 */
export async function failJob(job: Job, error: unknown): Promise<boolean> {
  const message = error instanceof Error ? error.message : String(error);
  const retry = !(error instanceof PermanentError) && job.attempts < job.maxAttempts;
  await db.job.update({
    where: { id: job.id },
    data: retry
      ? {
          status: "PENDING",
          lastError: message.slice(0, 2000),
          lockedAt: null,
          runAt: new Date(Date.now() + 30_000 * 2 ** (job.attempts - 1)),
        }
      : { status: "FAILED", lastError: message.slice(0, 2000), lockedAt: null, finishedAt: new Date() },
  });
  return retry;
}

/** Remet en file les tâches restées « RUNNING » après un arrêt brutal du worker. */
export async function requeueStaleJobs(olderThanMs: number): Promise<number> {
  const res = await db.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - olderThanMs) } },
    data: { status: "PENDING", lockedAt: null },
  });
  return res.count;
}
