// Assemble, pour un utilisateur, tout ce qu'affiche la page « Performances » et ce qu'expose performanceHints().
import type { SocialPlatform } from "@prisma/client";
import { db } from "../db";
import {
  compareGroups,
  COMPARE_AT_HOURS,
  durationBucket,
  DURATION_BUCKETS,
  HOOK_STYLES,
  hookStyle,
  HOUR_SLOTS,
  hourSlot,
  localHour,
  median,
  valueAt,
  viewsAtAge,
  type DimensionResult,
  type Snapshot,
} from "./math";
import { trackability } from "./platforms";

const DAY = 86400_000;
const HOUR = 3600_000;

export interface ReportOptions {
  /** Fuseau IANA du navigateur, pour les créneaux horaires ; UTC à défaut */
  timeZone?: string;
  /** Publications des N derniers jours seulement (toutes si absent) */
  sinceDays?: number | null;
  accountId?: string | null;
  now?: number;
}

export interface AccountSummary {
  id: string;
  platform: SocialPlatform;
  displayName: string;
  valid: boolean;
  /** Le compte TikTok n'a pas accordé video.list */
  missingScope: boolean;
  published: number;
  tracked: number;
  views: number;
  likes: number;
  comments: number;
  /** Médiane des vues à 24 h sur la période, et sur combien de publications */
  median24h: number | null;
  n24h: number;
  /** Même médiane sur tout l'historique : référence des comparaisons « +40 % » */
  referenceMedian: number | null;
}

export interface PubSummary {
  id: string;
  clipId: string;
  title: string;
  accountId: string;
  accountName: string;
  platform: SocialPlatform;
  publishedAt: string;
  externalUrl: string | null;
  views: number;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  thumbVersion: number;
  hasThumb: boolean;
}

export interface Launch extends PubSummary {
  ageHours: number;
  /** Courbe des 48 premières heures [heures, vues] */
  curve: Array<[number, number]>;
  milestones: Array<{ hours: number; views: number | null; accountMedian: number | null }>;
}

export interface TimelineSeries {
  accountId: string;
  label: string;
  platform: SocialPlatform;
  /** Vues cumulées en fin de journée, alignées sur `days` */
  values: number[];
}

export interface PerformanceReport {
  timeZone: string;
  totals: { views: number; likes: number; comments: number; shares: number | null; tracked: number; published: number };
  gained: { last7: number; prev7: number };
  accounts: AccountSummary[];
  days: string[];
  timeline: TimelineSeries[];
  top: PubSummary[];
  launches: Launch[];
  insights: {
    sample: number;
    streamers: DimensionResult;
    durations: DimensionResult;
    hours: DimensionResult;
    hooks: DimensionResult;
  };
  untracked: { draft: number; noScope: number; noId: number; notFound: number; pending: number; unsupported: number };
  /** Compilations en ligne sur la période : hors des comparaisons (format différent) */
  compilations: number;
}

const MILESTONES = [1, 6, 24];

async function loadPublications(userId: string, opts: ReportOptions) {
  // Uniquement les publications de clips : une compilation horizontale de plusieurs minutes ne se compare pas
  // à un clip vertical de 30 s, elle fausserait les médianes et les constats.
  const rows = await db.publication.findMany({
    where: {
      userId,
      status: "PUBLISHED",
      publishedAt: { not: null },
      clipId: { not: null },
      ...(opts.accountId ? { accountId: opts.accountId } : {}),
    },
    include: {
      account: { select: { id: true, platform: true, displayName: true, scopes: true, valid: true } },
      clip: {
        select: {
          id: true,
          hook: true,
          startSec: true,
          endSec: true,
          hasFinal: true,
          renderedAt: true,
          streamer: { select: { id: true, displayName: true } },
          recording: { select: { author: true } },
        },
      },
      stats: { select: { at: true, views: true }, orderBy: { at: "asc" } },
    },
    orderBy: { publishedAt: "desc" },
  });
  return rows.filter((p): p is typeof p & { clipId: string; clip: NonNullable<typeof p.clip> } => p.clipId !== null && p.clip !== null);
}

type LoadedPub = Awaited<ReturnType<typeof loadPublications>>[number];

function summary(p: LoadedPub): PubSummary {
  return {
    id: p.id,
    clipId: p.clipId,
    title: p.title,
    accountId: p.accountId,
    accountName: p.account.displayName,
    platform: p.account.platform,
    publishedAt: p.publishedAt!.toISOString(),
    externalUrl: p.externalUrl,
    views: p.viewCount ?? 0,
    likes: p.likeCount,
    comments: p.commentCount,
    shares: p.shareCount,
    hasThumb: p.clip.hasFinal,
    thumbVersion: p.clip.renderedAt?.getTime() ?? 0,
  };
}

function streamerOf(p: LoadedPub): { key: string; label: string } {
  if (p.clip.streamer) return { key: p.clip.streamer.id, label: p.clip.streamer.displayName };
  const author = p.clip.recording?.author?.trim();
  return author ? { key: `a:${author.toLowerCase()}`, label: author } : { key: "?", label: "Inconnu" };
}

export async function performanceReport(userId: string, opts: ReportOptions = {}): Promise<PerformanceReport> {
  const now = opts.now ?? Date.now();
  const timeZone = opts.timeZone ?? "UTC";
  const [allPubs, accountsRaw] = await Promise.all([
    // Toutes les publications : les médianes de référence des comptes se calculent sur tout l'historique,
    // le filtre de période ne porte que sur ce qui est affiché.
    loadPublications(userId, opts),
    db.socialAccount.findMany({
      where: { userId, ...(opts.accountId ? { id: opts.accountId } : {}) },
      select: { id: true, platform: true, displayName: true, scopes: true, valid: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const since = opts.sinceDays ? now - opts.sinceDays * DAY : -Infinity;
  const inPeriod = (p: LoadedPub) => p.publishedAt!.getTime() >= since;
  const pubs = allPubs.filter(inPeriod);
  const untracked = { draft: 0, noScope: 0, noId: 0, notFound: 0, pending: 0, unsupported: 0 };
  const trackedAll: Array<LoadedPub & { snaps: Snapshot[]; v24: number | null }> = [];
  for (const p of allPubs) {
    const t = trackability(p, p.account);
    const count = inPeriod(p);
    if (t === "UNSUPPORTED") untracked.unsupported += Number(count);
    else if (t === "DRAFT") untracked.draft += Number(count);
    else if (t === "NO_SCOPE") untracked.noScope += Number(count);
    else if (t === "NO_ID") untracked.noId += Number(count);
    else if (p.statsStatus === "NOT_FOUND") untracked.notFound += Number(count);
    else if (p.stats.length === 0) untracked.pending += Number(count);
    else trackedAll.push({ ...p, snaps: p.stats, v24: viewsAtAge(p.publishedAt!, p.stats, COMPARE_AT_HOURS, now) });
  }
  const tracked = trackedAll.filter(inPeriod);

  // ── Comptes
  const accounts: AccountSummary[] = accountsRaw.map((a) => {
    const mine = tracked.filter((p) => p.accountId === a.id);
    const v24 = mine.map((p) => p.v24).filter((v): v is number => v !== null);
    const v24All = trackedAll.filter((p) => p.accountId === a.id).map((p) => p.v24).filter((v): v is number => v !== null);
    return {
      id: a.id,
      platform: a.platform,
      displayName: a.displayName,
      valid: a.valid,
      missingScope: a.platform === "TIKTOK" && trackability({ privacy: "public", externalId: "1" }, a) === "NO_SCOPE",
      published: pubs.filter((p) => p.accountId === a.id).length,
      tracked: mine.length,
      views: mine.reduce((s, p) => s + (p.viewCount ?? 0), 0),
      likes: mine.reduce((s, p) => s + (p.likeCount ?? 0), 0),
      comments: mine.reduce((s, p) => s + (p.commentCount ?? 0), 0),
      median24h: median(v24),
      n24h: v24.length,
      referenceMedian: median(v24All),
    };
  });
  const accountMedian = new Map(accounts.map((a) => [a.id, a.referenceMedian ?? 0]));

  // ── Totaux et tendance (vues gagnées sur 7 jours glissants)
  const anyShares = tracked.some((p) => p.shareCount !== null);
  const totals = {
    views: tracked.reduce((s, p) => s + (p.viewCount ?? 0), 0),
    likes: tracked.reduce((s, p) => s + (p.likeCount ?? 0), 0),
    comments: tracked.reduce((s, p) => s + (p.commentCount ?? 0), 0),
    shares: anyShares ? tracked.reduce((s, p) => s + (p.shareCount ?? 0), 0) : null,
    tracked: tracked.length,
    published: pubs.length,
  };
  const sumAt = (t: number) => tracked.reduce((s, p) => s + valueAt(p.snaps, t), 0);
  const gained = { last7: sumAt(now) - sumAt(now - 7 * DAY), prev7: sumAt(now - 7 * DAY) - sumAt(now - 14 * DAY) };

  // ── Courbe des vues cumulées par compte, jour par jour (au plus 90 points)
  const firstSnap = Math.min(...tracked.map((p) => p.snaps[0]?.at.getTime() ?? now));
  const spanDays = Math.max(2, Math.min(opts.sinceDays ?? 90, Math.ceil((now - firstSnap) / DAY) + 1, 90));
  const dayEnds: number[] = [];
  for (let i = spanDays - 1; i >= 0; i--) dayEnds.push(now - i * DAY);
  const timeline: TimelineSeries[] = accounts
    .filter((a) => a.tracked > 0)
    .map((a) => {
      const mine = tracked.filter((p) => p.accountId === a.id);
      return {
        accountId: a.id,
        label: a.displayName,
        platform: a.platform,
        values: dayEnds.map((t) => mine.reduce((s, p) => s + valueAt(p.snaps, t), 0)),
      };
    });

  // ── Meilleurs clips
  const top = [...tracked].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0)).slice(0, 8).map(summary);

  // ── Démarrage des dernières publications : vues à 1 h, 6 h, 24 h comparées à la médiane du compte au même âge
  const medianAt = new Map<string, number | null>();
  for (const a of accounts) {
    for (const h of MILESTONES) {
      const vals = trackedAll
        .filter((p) => p.accountId === a.id)
        .map((p) => viewsAtAge(p.publishedAt!, p.snaps, h, now))
        .filter((v): v is number => v !== null);
      medianAt.set(`${a.id}:${h}`, vals.length >= 3 ? median(vals) : null);
    }
  }
  const launches: Launch[] = tracked.slice(0, 6).map((p) => {
    const pub = p.publishedAt!.getTime();
    return {
      ...summary(p),
      ageHours: (now - pub) / HOUR,
      curve: [[0, 0] as [number, number], ...p.snaps.filter((s) => s.at.getTime() - pub <= 48 * HOUR).map((s) => [(s.at.getTime() - pub) / HOUR, s.views] as [number, number])],
      milestones: MILESTONES.map((h) => ({
        hours: h,
        views: viewsAtAge(p.publishedAt!, p.snaps, h, now),
        accountMedian: medianAt.get(`${p.accountId}:${h}`) ?? null,
      })),
    };
  });

  // ── Constats : uniquement les publications qui ont atteint 24 h avec des relevés autour
  const comparable = tracked.filter((p) => p.v24 !== null);
  const base = (p: (typeof comparable)[number]) => ({ value: p.v24!, accountMedian: accountMedian.get(p.accountId) ?? 0 });
  const insights = {
    sample: comparable.length,
    streamers: compareGroups(comparable.map((p) => ({ ...base(p), ...streamerOf(p) }))),
    durations: compareGroups(
      comparable.map((p) => {
        const b = durationBucket(p.clip.endSec - p.clip.startSec);
        return { ...base(p), key: b.key, label: b.label };
      }),
      DURATION_BUCKETS.map((b) => b.key),
    ),
    hours: compareGroups(
      comparable.map((p) => {
        const s = hourSlot(localHour(p.publishedAt!, timeZone));
        return { ...base(p), key: s.key, label: s.label };
      }),
      HOUR_SLOTS.map((s) => s.key),
    ),
    hooks: compareGroups(
      comparable.map((p) => {
        const k = hookStyle(p.clip.hook);
        return { ...base(p), key: k, label: HOOK_STYLES[k] };
      }),
    ),
  };

  const compilations = await db.publication.count({
    where: {
      userId,
      status: "PUBLISHED",
      compilationId: { not: null },
      ...(opts.accountId ? { accountId: opts.accountId } : {}),
      ...(opts.sinceDays ? { publishedAt: { gte: new Date(now - opts.sinceDays * DAY) } } : { publishedAt: { not: null } }),
    },
  });
  return { timeZone, totals, gained, accounts, days: dayEnds.map((t) => new Date(t).toISOString()), timeline, top, launches, insights, untracked, compilations };
}
