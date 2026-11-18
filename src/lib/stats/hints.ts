// Point d'entrée réutilisable par le reste de l'app (programmation des publications, conseils…).
import type { SocialPlatform } from "@prisma/client";
import { db } from "../db";
import { compareGroups, COMPARE_AT_HOURS, durationBucket, DURATION_BUCKETS, HOUR_SLOTS, hourSlot, isValidTimeZone, localHour, median, MIN_SAMPLE, viewsAtAge } from "./math";
import { trackability } from "./platforms";

/** Cookie où le navigateur indique son fuseau horaire à la page « Performances ». */
export const TZ_COOKIE = "cliping_tz";

/** Clé KeyValue où la page « Performances » mémorise le fuseau du navigateur de l'utilisateur. */
export const timeZoneKey = (userId: string) => `stats.timezone:${userId}`;

export async function userTimeZone(userId: string): Promise<string | null> {
  const row = await db.keyValue.findUnique({ where: { key: timeZoneKey(userId) } }).catch(() => null);
  const tz = typeof row?.value === "string" ? row.value : null;
  return isValidTimeZone(tz) ? tz : null;
}

export interface SlotHint {
  /** Heure locale de début du créneau (0, 4, 8…), dans `timeZone` ; le créneau dure 4 h */
  fromHour: number;
  label: string;
  /** Médiane des vues à 24 h rapportée à la médiane du compte (1,4 = 40 % de mieux qu'habituellement) */
  medianRatio: number;
  n: number;
}

export interface DurationHint {
  key: string;
  label: string;
  /** Bornes en secondes [min, max) */
  minSec: number;
  maxSec: number | null;
  medianRatio: number;
  n: number;
}

export interface AccountHints {
  accountId: string;
  platform: SocialPlatform;
  displayName: string;
  /** Publications comparables (âgées d'au moins 24 h, avec relevés) */
  sample: number;
  /** Créneaux classés du meilleur au moins bon ; vide tant qu'il n'y a pas assez de données */
  bestSlots: SlotHint[];
  bestDurations: DurationHint[];
}

export interface PerformanceHints {
  /** Fuseau des heures données ; null si l'utilisateur n'a jamais ouvert la page (heures alors en UTC) */
  timeZone: string;
  timeZoneKnown: boolean;
  /** Seuil minimal de publications par groupe pour qu'une conclusion soit donnée */
  minSample: number;
  accounts: AccountHints[];
  /** Tous comptes confondus */
  bestDurations: DurationHint[];
}

/**
 * Ce que les chiffres de l'utilisateur disent des créneaux et des durées qui marchent, compte par compte.
 * Observations sur ses propres publications, pas des règles : un groupe n'apparaît qu'avec au moins
 * MIN_SAMPLE publications, et les listes restent vides tant qu'il n'y a pas de quoi comparer.
 */
export async function performanceHints(userId: string, opts: { timeZone?: string; now?: number } = {}): Promise<PerformanceHints> {
  const now = opts.now ?? Date.now();
  const stored = opts.timeZone && isValidTimeZone(opts.timeZone) ? opts.timeZone : await userTimeZone(userId);
  const timeZone = stored ?? "UTC";
  const pubs = await db.publication.findMany({
    // Clips uniquement : les compilations (format long horizontal) ne se comparent pas aux clips.
    where: { userId, status: "PUBLISHED", clipId: { not: null }, publishedAt: { not: null, lte: new Date(now - COMPARE_AT_HOURS * 3600_000) } },
    select: {
      accountId: true,
      privacy: true,
      externalId: true,
      publishedAt: true,
      account: { select: { platform: true, displayName: true, scopes: true } },
      clip: { select: { startSec: true, endSec: true } },
      stats: { select: { at: true, views: true }, orderBy: { at: "asc" } },
    },
  });
  const rows = pubs
    .filter((p): p is typeof p & { clip: NonNullable<typeof p.clip> } => p.clip !== null)
    .filter((p) => trackability(p, p.account) === "OK" && p.stats.length > 0)
    .map((p) => ({ ...p, v24: viewsAtAge(p.publishedAt!, p.stats, COMPARE_AT_HOURS, now) }))
    .filter((p): p is typeof p & { v24: number } => p.v24 !== null);

  const medians = new Map<string, number>();
  for (const id of new Set(rows.map((r) => r.accountId))) medians.set(id, median(rows.filter((r) => r.accountId === id).map((r) => r.v24)) ?? 0);

  const durationsOf = (list: typeof rows): DurationHint[] => {
    const res = compareGroups(
      list.map((r) => {
        const b = durationBucket(r.clip.endSec - r.clip.startSec);
        return { value: r.v24, accountMedian: medians.get(r.accountId) ?? 0, key: b.key, label: b.label };
      }),
    );
    if (!res.conclusive) return [];
    return res.groups
      .filter((g) => g.enough && g.medianRatio !== null)
      .sort((a, b) => b.medianRatio! - a.medianRatio!)
      .map((g) => {
        const i = DURATION_BUCKETS.findIndex((b) => b.key === g.key);
        const max = DURATION_BUCKETS[i]!.max;
        return { key: g.key, label: g.label, minSec: i > 0 ? DURATION_BUCKETS[i - 1]!.max : 0, maxSec: Number.isFinite(max) ? max : null, medianRatio: g.medianRatio!, n: g.n };
      });
  };

  const accounts: AccountHints[] = [...medians.keys()].map((accountId) => {
    const mine = rows.filter((r) => r.accountId === accountId);
    const slots = compareGroups(
      mine.map((r) => {
        const s = hourSlot(localHour(r.publishedAt!, timeZone));
        return { value: r.v24, accountMedian: medians.get(accountId) ?? 0, key: s.key, label: s.label };
      }),
    );
    return {
      accountId,
      platform: mine[0]!.account.platform,
      displayName: mine[0]!.account.displayName,
      sample: mine.length,
      bestSlots: slots.conclusive
        ? slots.groups
            .filter((g) => g.enough && g.medianRatio !== null)
            .sort((a, b) => b.medianRatio! - a.medianRatio!)
            .map((g) => ({ fromHour: HOUR_SLOTS.find((s) => s.key === g.key)!.from, label: g.label, medianRatio: g.medianRatio!, n: g.n }))
        : [],
      bestDurations: durationsOf(mine),
    };
  });

  return { timeZone, timeZoneKnown: !!stored, minSample: MIN_SAMPLE, accounts, bestDurations: durationsOf(rows) };
}
