import { db } from "./db";

export interface WorkerStatus {
  online: boolean;
  recordings: number;
  jobs: number;
  ai: boolean;
  transcription: boolean;
  lastSeen: Date | null;
}

/** Le worker écrit un battement de cœur toutes les 10 s : au-delà de 45 s, on le considère arrêté. */
export async function getWorkerStatus(): Promise<WorkerStatus> {
  const row = await db.keyValue.findUnique({ where: { key: "worker.heartbeat" } }).catch(() => null);
  const v = (row?.value ?? {}) as { at?: string; recordings?: number; jobs?: number; ai?: boolean; transcription?: boolean };
  const lastSeen = v.at ? new Date(v.at) : null;
  return {
    online: !!lastSeen && Date.now() - lastSeen.getTime() < 45_000,
    recordings: v.recordings ?? 0,
    jobs: v.jobs ?? 0,
    ai: !!v.ai,
    transcription: !!v.transcription,
    lastSeen,
  };
}
