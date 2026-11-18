import "server-only";
import type { Prisma } from "@prisma/client";
import { DEFAULT_MOMENTS, MIN_MOMENTS, type MomentCandidate } from "./compilation";
import { db } from "./db";

/** Clips utilisables dans une compilation : montés ou validés, pas écartés ni en échec. */
export const ELIGIBLE: Prisma.ClipWhereInput = { status: { in: ["READY", "APPROVED"] } };

export type ProposalKind = "recording" | "streamer" | "day";

export interface Proposal {
  kind: ProposalKind;
  /** Identifiant du live ou du streamer ; vide pour « day » */
  id: string;
  label: string;
  hint: string;
  count: number;
  /** Clips du meilleur score, pour l'aperçu */
  thumbs: string[];
  /** Date de référence (fin du live…) pour l'affichage */
  at: Date | null;
}

const clipSelect = {
  id: true,
  title: true,
  score: true,
  originSec: true,
  peakSec: true,
  startSec: true,
  endSec: true,
  recordingId: true,
  streamerId: true,
  createdAt: true,
  hasFinal: true,
} as const;

type ClipRow = Prisma.ClipGetPayload<{ select: typeof clipSelect }>;

export function toCandidate(c: ClipRow): MomentCandidate {
  return {
    clipId: c.id,
    title: c.title,
    score: c.score,
    at: c.originSec + c.peakSec,
    from: c.originSec + c.startSec,
    to: c.originSec + c.endSec,
    recordingId: c.recordingId,
    streamerId: c.streamerId,
    createdAt: c.createdAt.getTime(),
    duration: c.endSec - c.startSec,
  };
}

/** Clips candidats pour une proposition (live, streamer ou dernières 24 h). */
export async function candidatesFor(userId: string, kind: ProposalKind, id: string): Promise<MomentCandidate[]> {
  const where: Prisma.ClipWhereInput = { userId, ...ELIGIBLE };
  if (kind === "recording") where.recordingId = id;
  else if (kind === "streamer") Object.assign(where, { streamerId: id, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } });
  else where.createdAt = { gte: new Date(Date.now() - 86_400_000) };
  const clips = await db.clip.findMany({ where, select: clipSelect, orderBy: { score: "desc" }, take: 200 });
  return clips.map(toCandidate);
}

/**
 * Best-of à proposer : lives terminés des 14 derniers jours avec au moins 3 clips (pas encore compilés),
 * streamers avec au moins 5 clips cette semaine, et les dernières 24 h tous streamers confondus.
 */
export async function proposalsFor(userId: string): Promise<Proposal[]> {
  const since14 = new Date(Date.now() - 14 * 86_400_000);
  const [recordings, done, recentClips] = await Promise.all([
    db.recording.findMany({
      where: { userId, status: "DONE", startedAt: { gte: since14 }, clips: { some: ELIGIBLE } },
      orderBy: { startedAt: "desc" },
      take: 20,
      include: {
        streamer: { select: { displayName: true } },
        clips: { where: ELIGIBLE, select: { id: true, score: true, hasFinal: true }, orderBy: { score: "desc" } },
      },
    }),
    db.compilation.findMany({ where: { userId, createdAt: { gte: since14 } }, select: { origin: true, createdAt: true } }),
    db.clip.findMany({
      where: { userId, ...ELIGIBLE, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      select: { id: true, score: true, streamerId: true, createdAt: true, hasFinal: true, streamer: { select: { displayName: true } } },
      orderBy: { score: "desc" },
    }),
  ]);
  // Déjà compilé : un live une fois pour toutes ; un streamer au plus une fois par semaine ; les 24 h une fois par jour.
  const window: Record<string, number> = { recording: 14 * 86_400_000, streamer: 7 * 86_400_000, day: 86_400_000 };
  const used = new Set(
    done
      .filter((c) => {
        const kind = ((c.origin ?? {}) as { kind?: string }).kind ?? "";
        return Date.now() - c.createdAt.getTime() < (window[kind] ?? 0);
      })
      .map((c) => {
        const o = (c.origin ?? {}) as { kind?: string; id?: string };
        return `${o.kind}:${o.id ?? ""}`;
      }),
  );
  const thumbsOf = (clips: Array<{ id: string; hasFinal: boolean }>) => clips.filter((c) => c.hasFinal).slice(0, 3).map((c) => c.id);
  const out: Proposal[] = [];

  for (const r of recordings) {
    if (r.clips.length < MIN_MOMENTS || used.has(`recording:${r.id}`)) continue;
    const who = r.streamer?.displayName ?? r.author ?? "Import";
    out.push({
      kind: "recording",
      id: r.id,
      label: `Best-of du ${r.source === "VOD" ? "replay" : "live"} de ${who}`,
      hint: [r.category, r.title].filter(Boolean).join(" · "),
      count: Math.min(DEFAULT_MOMENTS, r.clips.length),
      thumbs: thumbsOf(r.clips),
      at: r.endedAt ?? r.startedAt,
    });
  }

  const byStreamer = new Map<string, typeof recentClips>();
  for (const c of recentClips) {
    if (!c.streamerId) continue;
    byStreamer.set(c.streamerId, [...(byStreamer.get(c.streamerId) ?? []), c]);
  }
  for (const [sid, clips] of byStreamer) {
    if (clips.length < 5 || used.has(`streamer:${sid}`)) continue;
    out.push({
      kind: "streamer",
      id: sid,
      label: `Les meilleurs moments de ${clips[0]!.streamer?.displayName ?? "ce streamer"} cette semaine`,
      hint: `${clips.length} clips sur 7 jours`,
      count: Math.min(DEFAULT_MOMENTS, clips.length),
      thumbs: thumbsOf(clips),
      at: null,
    });
  }

  const day = recentClips.filter((c) => c.createdAt.getTime() > Date.now() - 86_400_000);
  if (day.length >= 5 && !used.has("day:")) {
    out.push({
      kind: "day",
      id: "",
      label: "Best-of des dernières 24 h",
      hint: `${day.length} clips, tous streamers confondus`,
      count: Math.min(DEFAULT_MOMENTS, day.length),
      thumbs: thumbsOf(day),
      at: null,
    });
  }
  return out;
}
