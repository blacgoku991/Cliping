import { randomUUID } from "node:crypto";
import os from "node:os";
import type { Job } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { claimJob, completeJob, failJob, requeueStaleJobs, type JobPayloads, type JobType } from "@/lib/jobs";
import { ensureDir } from "@/lib/storage";
import { AUTOMATION_INTERVAL_SEC, automationTick } from "./automation";
import { cleanup } from "./cleanup";
import { DISCOVERY_INTERVAL_SEC, discoveryEnabled, refreshDiscovery } from "./discovery";
import { Monitor, resetStaleState } from "./monitor";
import { processClip, renderClip } from "./pipeline/clip";
import { log, run } from "./proc";
import { checkPublication, markPublicationError, publish } from "./publish";
import { transcriptionEnabled } from "./transcribe";
import { importVod, markVodFailed } from "./vod";

const workerId = `${os.hostname()}-${randomUUID().slice(0, 8)}`;
const monitor = new Monitor();
let shuttingDown = false;
let running = 0;

type Handlers = { [T in JobType]: (payload: JobPayloads[T]) => Promise<void> };

const handlers: Handlers = {
  "clip.process": (p) => processClip(p.clipId),
  "clip.render": (p) => renderClip(p.clipId),
  "vod.import": (p) => importVod(p.recordingId),
  publish: (p) => publish(p.publicationId),
  "publish.check": (p) => checkPublication(p.publicationId),
  cleanup: () => cleanup(),
  "discovery.refresh": (p) => refreshDiscovery(p.userId),
};

async function onFailure(job: Job, error: unknown, willRetry: boolean): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const payload = job.payload as Record<string, string>;
  if (job.type === "publish" || job.type === "publish.check") {
    await markPublicationError(payload.publicationId!, message, willRetry, job.type === "publish.check");
  } else if (job.type === "clip.process" && !willRetry) {
    await db.clip.updateMany({ where: { id: payload.clipId, status: "PROCESSING" }, data: { status: "FAILED", error: message.slice(0, 1000) } });
  } else if (job.type === "clip.render" && !willRetry) {
    await db.clip.updateMany({ where: { id: payload.clipId }, data: { error: `Montage échoué : ${message}`.slice(0, 1000) } });
  } else if (job.type === "vod.import" && !willRetry) {
    await markVodFailed(payload.recordingId!, message);
  }
}

async function runJob(job: Job): Promise<void> {
  const started = Date.now();
  try {
    const handler = handlers[job.type as JobType] as ((p: unknown) => Promise<void>) | undefined;
    if (!handler) throw new Error(`Type de tâche inconnu : ${job.type}`);
    await handler(job.payload);
    await completeJob(job.id);
    // publish.check « échoue » exprès tant que la plateforme traite la vidéo : pas la peine de l'afficher.
    if (job.type !== "publish.check") log("job", `${job.type} terminé en ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } catch (err) {
    const willRetry = await failJob(job, err);
    await onFailure(job, err, willRetry).catch(() => {});
    if (job.type !== "publish.check") {
      log("job", `${job.type} échoué${willRetry ? " (nouvelle tentative programmée)" : ""} : ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function jobLoop(): Promise<void> {
  while (!shuttingDown) {
    if (running >= env.worker.jobConcurrency) {
      await sleep(500);
      continue;
    }
    const job = await claimJob(workerId).catch((err) => {
      log("job", `base de données injoignable : ${err instanceof Error ? err.message : err}`);
      return null;
    });
    if (!job) {
      await sleep(1500);
      continue;
    }
    running++;
    void runJob(job).finally(() => running--);
  }
}

async function monitorLoop(): Promise<void> {
  while (!shuttingDown) {
    await monitor.tick().catch((err) => log("monitor", `erreur : ${err instanceof Error ? err.message : err}`));
    await sleep(env.worker.monitorIntervalSec * 1000);
  }
}

/** « En live maintenant » et mode automatique : classement rafraîchi régulièrement. */
async function discoveryLoop(): Promise<void> {
  if (!discoveryEnabled()) {
    log("discovery", "pas d'identifiants Twitch/Kick d'application : la découverte des lives est désactivée");
    return;
  }
  // Laisse au moniteur le temps de reprendre les captures en cours avant de compter les places libres.
  await sleep(Math.min(30, env.worker.monitorIntervalSec + 5) * 1000);
  while (!shuttingDown) {
    await refreshDiscovery().catch((err) => log("discovery", `erreur : ${err instanceof Error ? err.message : err}`));
    await sleep(DISCOVERY_INTERVAL_SEC * 1000);
  }
}

/** Pilote automatique et notifications : observent la base à intervalle régulier. */
async function automationLoop(): Promise<void> {
  while (!shuttingDown) {
    await automationTick().catch((err) => log("automation", `erreur : ${err instanceof Error ? err.message : err}`));
    await sleep(AUTOMATION_INTERVAL_SEC * 1000);
  }
}

async function heartbeatLoop(): Promise<void> {
  let lastCleanup = 0;
  while (!shuttingDown) {
    const value = {
      at: new Date().toISOString(),
      workerId,
      recordings: monitor.activeCount,
      jobs: running,
      ai: !!env.ai.apiKey,
      transcription: transcriptionEnabled(),
      discovery: discoveryEnabled(),
    };
    await db.keyValue
      .upsert({ where: { key: "worker.heartbeat" }, update: { value }, create: { key: "worker.heartbeat", value } })
      .catch(() => {});
    if (Date.now() - lastCleanup > 6 * 3600_000) {
      lastCleanup = Date.now();
      await cleanup().catch((err) => log("cleanup", `erreur : ${err instanceof Error ? err.message : err}`));
    }
    await requeueStaleJobs(2 * 3600_000).catch(() => {});
    await sleep(10_000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkBinary(name: string, bin: string, arg: string): Promise<boolean> {
  try {
    const res = await run(bin, [arg], { timeoutMs: 20_000 });
    return res.code === 0;
  } catch {
    log("worker", `⚠ ${name} introuvable (${bin}). Installe-le ou corrige la variable d'environnement correspondante.`);
    return false;
  }
}

async function main(): Promise<void> {
  log("worker", `démarrage (${workerId})`);
  await ensureDir(env.dataDir);
  await db.$queryRaw`SELECT 1`;
  const ok = await Promise.all([
    checkBinary("ffmpeg", env.bin.ffmpeg, "-version"),
    checkBinary("ffprobe", env.bin.ffprobe, "-version"),
    checkBinary("streamlink", env.bin.streamlink, "--version"),
    checkBinary("yt-dlp", env.bin.ytdlp, "--version"),
  ]);
  if (!ok[0] || !ok[1]) throw new Error("ffmpeg et ffprobe sont indispensables au worker.");
  log(
    "worker",
    `IA titres : ${env.ai.apiKey ? `oui (${env.ai.model})` : "non (titres génériques)"} · sous-titres : ${transcriptionEnabled() ? `oui (${env.transcribe.model})` : "non"}`,
  );

  if (env.encryptionKey.length < 32) {
    log("worker", "⚠ ENCRYPTION_KEY absente ou trop courte : la publication sur TikTok/YouTube ne pourra pas fonctionner.");
  }

  await resetStaleState();
  // Tâches restées verrouillées par un worker précédent tué en plein travail.
  const requeued = await requeueStaleJobs(0);
  if (requeued) log("worker", `${requeued} tâche(s) reprise(s) après redémarrage`);

  const stop = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("worker", `${signal} reçu : arrêt propre en cours…`);
    void (async () => {
      await monitor.shutdown();
      const until = Date.now() + 120_000;
      while (running > 0 && Date.now() < until) await sleep(500);
      await db.$disconnect();
      process.exit(0);
    })();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  await Promise.all([jobLoop(), monitorLoop(), heartbeatLoop(), discoveryLoop(), automationLoop()]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
