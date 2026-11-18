import type { Streamer } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { parseSettings } from "@/lib/settings";
import { matchesGameFilter } from "@/lib/sources";
import { log, run } from "./proc";
import { LiveRecorder } from "./recorder";

export interface LiveStatus {
  live: boolean;
  title: string | null;
  category: string | null;
  /** Renseigné quand la vérification elle-même a échoué (≠ simplement hors ligne) */
  error: string | null;
}

/** Interroge streamlink : la chaîne est-elle en live, sur quel jeu ? */
export async function checkLive(url: string): Promise<LiveStatus> {
  let res;
  try {
    res = await run(env.bin.streamlink, [...env.worker.streamlinkArgs, "--json", url], { timeoutMs: 45_000 });
  } catch (err) {
    return { live: false, title: null, category: null, error: err instanceof Error ? err.message : String(err) };
  }
  let data: { error?: string; streams?: Record<string, unknown>; metadata?: { title?: string | null; category?: string | null } };
  try {
    data = JSON.parse(res.stdout);
  } catch {
    return { live: false, title: null, category: null, error: (res.stderr || res.stdout).trim().slice(-300) || "réponse illisible de streamlink" };
  }
  if (data.error) {
    // « No playable streams » = hors ligne, le cas normal. Le reste est une vraie erreur à afficher.
    const offline = /no playable streams|offline|not live|does not exist|no streams/i.test(data.error);
    return { live: false, title: null, category: null, error: offline ? null : data.error.slice(0, 300) };
  }
  return {
    live: Object.keys(data.streams ?? {}).length > 0,
    title: data.metadata?.title ?? null,
    category: data.metadata?.category ?? null,
    error: null,
  };
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

/** Surveille les chaînes suivies et démarre/arrête les enregistrements. */
export class Monitor {
  private readonly recorders = new Map<string, LiveRecorder>();
  /** Captures lancées pour des chaînes du mode automatique → spectateurs (pour céder la place aux chaînes manuelles) */
  private readonly autoViewers = new Map<string, number>();
  private running = false;
  private stopped = false;

  get activeCount(): number {
    return this.recorders.size;
  }

  async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const streamers = await db.streamer.findMany({ where: { enabled: true }, orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } } });
      const enabledIds = new Set(streamers.map((s) => s.id));
      // Chaîne désactivée ou supprimée pendant un enregistrement : on arrête proprement.
      for (const [id, rec] of this.recorders) if (!enabledIds.has(id)) rec.stop("chaîne désactivée");
      await mapLimit(streamers, 4, (s) => this.check(s).catch((err) => log("monitor", `${s.login} : ${err instanceof Error ? err.message : err}`)));
    } finally {
      this.running = false;
    }
  }

  private async check(streamer: Streamer): Promise<void> {
    const status = await checkLive(streamer.url);
    const recorder = this.recorders.get(streamer.id);
    // Une vérification ratée ne doit pas faire croire que le live est fini pendant qu'on enregistre.
    const live = status.live || (!!recorder && !recorder.done && !!status.error);
    await db.streamer
      .update({
        where: { id: streamer.id },
        data: {
          isLive: live,
          liveTitle: status.live ? status.title : live ? streamer.liveTitle : null,
          liveCategory: status.live ? status.category : live ? streamer.liveCategory : null,
          lastCheckedAt: new Date(),
          lastLiveAt: live ? new Date() : streamer.lastLiveAt,
          lastError: status.error,
        },
      })
      .catch(() => {});
    if (this.stopped) return;

    const wanted = status.live && matchesGameFilter(streamer.gameFilter, status.category, status.title);
    if (recorder && !recorder.done && this.autoViewers.has(streamer.id)) this.autoViewers.set(streamer.id, streamer.autoViewers ?? 0);
    if (recorder && !recorder.done) {
      if (status.live && !wanted) recorder.stop("le streamer a changé de jeu");
      return;
    }
    if (!wanted) return;
    if (this.recorders.size >= env.worker.maxRecordings && !streamer.autoFollowed) {
      // Les chaînes suivies à la main passent avant celles du mode automatique : on libère la place
      // de la capture automatique la moins regardée.
      const victim = [...this.recorders.entries()]
        .filter(([id, r]) => this.autoViewers.has(id) && !r.done)
        .sort(([a], [b]) => (this.autoViewers.get(a) ?? 0) - (this.autoViewers.get(b) ?? 0))[0];
      if (victim) {
        const [victimId, rec] = victim;
        rec.stop(`place laissée à ${streamer.displayName} (chaîne suivie à la main)`);
        await rec.waitDone(60_000);
        this.recorders.delete(victimId);
      }
    }
    if (this.recorders.size >= env.worker.maxRecordings) {
      await db.streamer.update({
        where: { id: streamer.id },
        data: { lastError: `En live, mais ${env.worker.maxRecordings} enregistrements tournent déjà (MAX_CONCURRENT_RECORDINGS)` },
      });
      return;
    }
    await this.startRecording(streamer, status);
  }

  private async startRecording(streamer: Streamer, status: LiveStatus): Promise<void> {
    const user = await db.user.findUnique({ where: { id: streamer.userId }, select: { settings: true } });
    if (!user) return;
    const recording = await db.recording.create({
      data: {
        userId: streamer.userId,
        streamerId: streamer.id,
        source: "LIVE",
        sourceUrl: streamer.url,
        status: "RECORDING",
        title: status.title,
        category: status.category,
        author: streamer.displayName,
      },
    });
    const rec = new LiveRecorder({
      recordingId: recording.id,
      userId: streamer.userId,
      streamer,
      settings: parseSettings(user.settings),
    });
    rec.onEnd = (r) => {
      if (this.recorders.get(streamer.id) === r) {
        this.recorders.delete(streamer.id);
        this.autoViewers.delete(streamer.id);
      }
    };
    this.recorders.set(streamer.id, rec);
    if (streamer.autoFollowed) this.autoViewers.set(streamer.id, streamer.autoViewers ?? 0);
    else this.autoViewers.delete(streamer.id);
    try {
      await rec.start();
    } catch (err) {
      this.recorders.delete(streamer.id);
      await db.recording.update({
        where: { id: recording.id },
        data: { status: "FAILED", endedAt: new Date(), error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  /** Arrêt du worker : on laisse chaque enregistrement finir ses clips en cours. */
  async shutdown(): Promise<void> {
    this.stopped = true;
    const recs = [...this.recorders.values()];
    for (const r of recs) r.stop("arrêt du worker");
    await Promise.all(recs.map((r) => r.waitDone(60_000)));
  }
}

/** Au démarrage : les enregistrements « en cours » d'un worker précédent sont forcément morts. */
export async function resetStaleState(): Promise<void> {
  const stale = await db.recording.updateMany({
    where: { status: "RECORDING" },
    data: { status: "DONE", endedAt: new Date(), error: "Interrompu par un redémarrage du worker" },
  });
  if (stale.count) log("monitor", `${stale.count} enregistrement(s) interrompu(s) par le redémarrage précédent`);
  await db.streamer.updateMany({ where: { isLive: true }, data: { isLive: false } });
}
