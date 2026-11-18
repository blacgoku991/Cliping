import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { channelUrl, planAutoFollow, streamKey } from "@/lib/discovery";
import { env } from "@/lib/env";
import { directoryConfigured, topStreams, type DiscoveredStream } from "@/lib/live-apis";
import { log } from "./proc";

export const DISCOVERY_INTERVAL_SEC = Number(process.env.DISCOVERY_INTERVAL_SEC ?? 120);
const FETCH_LIMIT = 50;

export function discoveryEnabled(): boolean {
  return directoryConfigured("TWITCH") || directoryConfigured("KICK");
}

/**
 * Rafraîchit le classement « en live maintenant » (un appel par couple jeu/langue, partagé entre
 * utilisateurs), puis applique le mode automatique de chacun.
 */
export async function refreshDiscovery(onlyUserId?: string): Promise<void> {
  if (!discoveryEnabled()) return;
  const configs = await db.discovery.findMany({ where: onlyUserId ? { userId: onlyUserId } : {} });
  if (configs.length === 0) return;

  const cache = new Map<string, { streams: DiscoveredStream[]; errors: string[] }>();
  for (const cfg of configs) {
    const key = `${cfg.game.toLowerCase()}|${cfg.language}`;
    let result = cache.get(key);
    if (!result) {
      result = await topStreams(cfg.game, cfg.language, FETCH_LIMIT).catch((err: unknown) => ({
        streams: [] as DiscoveredStream[],
        errors: [err instanceof Error ? err.message : String(err)],
      }));
      cache.set(key, result);
    }
    const failedEverywhere = result.errors.length > 0 && result.streams.length === 0;
    await db.discovery.update({
      where: { id: cfg.id },
      data: {
        // Échec complet : on garde le dernier classement connu plutôt que d'afficher une liste vide.
        ...(failedEverywhere ? {} : { results: result.streams as unknown as Prisma.InputJsonValue, fetchedAt: new Date() }),
        error: result.errors.length ? result.errors.join(" · ").slice(0, 600) : null,
      },
    });
    if (!failedEverywhere) {
      await applyAutoFollow(cfg.userId, cfg.game, cfg.autoFollow ? cfg.autoCount : 0, cfg.excluded, result.streams).catch((err) =>
        log("discovery", `mode automatique (${cfg.userId}) : ${err instanceof Error ? err.message : err}`),
      );
    }
  }
}

/** Places d'enregistrement que les chaînes automatiques peuvent occuper sans gêner les chaînes ajoutées à la main. */
async function freeSlots(userId: string): Promise<number> {
  const manualRecording = await db.recording.count({
    where: { status: "RECORDING", source: "LIVE", streamer: { autoFollowed: false } },
  });
  // Les chaînes automatiques des autres utilisateurs occupent aussi des places.
  const otherAutoRecording = await db.recording.count({
    where: { status: "RECORDING", source: "LIVE", streamer: { autoFollowed: true, userId: { not: userId } } },
  });
  return Math.max(0, env.worker.maxRecordings - manualRecording - otherAutoRecording);
}

export async function applyAutoFollow(userId: string, game: string, count: number, excluded: string[], ranked: DiscoveredStream[]): Promise<void> {
  const streamers = await db.streamer.findMany({
    where: { userId },
    select: {
      id: true, platform: true, login: true, enabled: true, autoFollowed: true,
      _count: { select: { clips: true } },
      recordings: { where: { status: "RECORDING" }, select: { id: true }, take: 1 },
    },
  });
  const autos = streamers.filter((s) => s.autoFollowed);
  if (count === 0 && autos.length === 0) return;

  const plan = planAutoFollow({
    ranked,
    autos: autos.map((s) => ({
      id: s.id, platform: s.platform, login: s.login, enabled: s.enabled,
      recording: s.recordings.length > 0, hasClips: s._count.clips > 0,
    })),
    manual: new Set(streamers.filter((s) => !s.autoFollowed).map(streamKey)),
    excluded: new Set(excluded),
    count,
    slots: await freeSlots(userId),
  });

  for (const s of plan.add) {
    await db.streamer
      .create({
        data: {
          userId, platform: s.platform, login: s.login, url: channelUrl(s), displayName: s.displayName,
          gameFilter: game, autoFollowed: true, autoViewers: s.viewers,
        },
      })
      .catch(() => {}); // ajoutée entre-temps à la main : contrainte d'unicité, rien à faire
  }
  if (plan.enable.length) await db.streamer.updateMany({ where: { id: { in: plan.enable }, autoFollowed: true }, data: { enabled: true } });
  if (plan.disable.length) await db.streamer.updateMany({ where: { id: { in: plan.disable }, autoFollowed: true }, data: { enabled: false, autoViewers: null } });
  if (plan.remove.length) await db.streamer.deleteMany({ where: { id: { in: plan.remove }, autoFollowed: true } });
  for (const v of plan.viewers) await db.streamer.update({ where: { id: v.id }, data: { autoViewers: v.viewers } }).catch(() => {});

  const changes = plan.add.length + plan.enable.length + plan.disable.length + plan.remove.length;
  if (changes) {
    log(
      "discovery",
      `mode auto : +${plan.add.length + plan.enable.length} (${plan.add.map((s) => s.login).join(", ") || "—"}) −${plan.remove.length + plan.disable.length}`,
    );
  }
}
