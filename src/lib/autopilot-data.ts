/**
 * Lecture en base de tout ce dont le pilote a besoin pour décider. Partagé par le worker (qui applique)
 * et par la page du pilote (aperçu « ce que le pilote ferait maintenant »), pour que l'aperçu montre
 * exactement la décision du worker. Pas de « server-only » : le worker l'importe aussi.
 */
import type { Autopilot } from "@prisma/client";
import { parseAutopilotConfig, type AutopilotConfig, type CandidateClip, type DecisionInput, type PilotAccount } from "./autopilot";
import { db } from "./db";
import { DAY_MS } from "./schedule";

const ACTIVE = ["QUEUED", "UPLOADING", "PROCESSING", "PUBLISHED"] as const;

export interface AutopilotState {
  /** Comptes mis en pause par le pilote (échecs répétés) : id → raison. Reprise manuelle. */
  paused: Record<string, string>;
  /** Pause levée par l'utilisateur à cette date : les échecs antérieurs ne comptent plus */
  resumedAt: Record<string, string>;
  /** Comptes à reconnecter déjà signalés dans le journal */
  invalidSeen: string[];
  /** Explications du dernier passage (affichées dans la page) */
  lastNotes: string[];
}

export function parseState(raw: unknown): AutopilotState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rec = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {});
  return {
    paused: rec(r.paused),
    resumedAt: rec(r.resumedAt),
    invalidSeen: Array.isArray(r.invalidSeen) ? r.invalidSeen.filter((x): x is string => typeof x === "string") : [],
    lastNotes: Array.isArray(r.lastNotes) ? r.lastNotes.filter((x): x is string => typeof x === "string") : [],
  };
}

export interface LoadedInput {
  input: DecisionInput;
  config: AutopilotConfig;
  state: AutopilotState;
  clipTitles: Map<string, string>;
  accountLabels: Map<string, string>;
  /** Clips déjà approuvés en simulation (pour ne pas les noter deux fois dans le journal) */
  simulatedApproved: Set<string>;
}

export async function loadDecisionInput(userId: string, ap: Pick<Autopilot, "config" | "state" | "dryRun">, now = Date.now()): Promise<LoadedInput> {
  const config = parseAutopilotConfig(ap.config);
  const state = parseState(ap.state);
  const since = new Date(now - Math.max(config.maxClipAgeH * 3600_000, DAY_MS));

  const [clips, accounts, pubs, simLogs, realCount] = await Promise.all([
    db.clip.findMany({
      where: { userId, status: { in: ["READY", "APPROVED"] }, hasFinal: true, createdAt: { gte: since } },
      select: { id: true, title: true, status: true, score: true, streamerId: true, hasFinal: true, createdAt: true, _count: { select: { publications: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    db.socialAccount.findMany({ where: { userId }, orderBy: [{ platform: "asc" }, { createdAt: "asc" }] }),
    db.publication.findMany({
      where: { userId, status: { in: [...ACTIVE] }, scheduledAt: { gte: new Date(now - DAY_MS) } },
      select: { accountId: true, scheduledAt: true, publishedAt: true },
    }),
    ap.dryRun
      ? db.autopilotLog.findMany({
          where: { userId, dryRun: true, kind: { in: ["schedule", "approve"] }, at: { gte: new Date(now - 2 * DAY_MS) } },
          select: { kind: true, clipId: true, accountId: true, plannedAt: true, at: true },
        })
      : Promise.resolve([]),
    db.publication.count({ where: { userId, autopilot: true, status: { not: "CANCELED" }, createdAt: { gte: new Date(now - DAY_MS) } } }),
  ]);

  // En simulation, ce que le pilote « a programmé » compte comme s'il l'avait fait : la simulation reste fidèle
  // (plafonds, écarts, un clip une seule fois) au lieu de reproposer les mêmes clips à chaque passage.
  const simScheduled = simLogs.filter((l) => l.kind === "schedule");
  const simClipIds = new Set(simScheduled.map((l) => l.clipId).filter((x): x is string => !!x));
  const simulatedApproved = new Set(simLogs.filter((l) => l.kind === "approve").map((l) => l.clipId).filter((x): x is string => !!x));

  const candidateClips: CandidateClip[] = clips.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    score: c.score,
    streamerId: c.streamerId,
    hasFinal: c.hasFinal,
    createdAt: c.createdAt.getTime(),
    handled: c._count.publications > 0 || simClipIds.has(c.id),
  }));
  const pilotAccounts: PilotAccount[] = accounts.map((a) => ({
    id: a.id,
    label: a.displayName,
    valid: a.valid,
    dailyCap: a.dailyCap,
    existing: [
      ...pubs.filter((p) => p.accountId === a.id).map((p) => (p.publishedAt ?? p.scheduledAt).getTime()),
      ...simScheduled.filter((l) => l.accountId === a.id && l.plannedAt && l.plannedAt.getTime() >= now - DAY_MS).map((l) => l.plannedAt!.getTime()),
    ],
  }));
  const simCount = simScheduled.filter((l) => l.at.getTime() >= now - DAY_MS).length;

  return {
    config,
    state,
    simulatedApproved,
    clipTitles: new Map(clips.map((c) => [c.id, c.title || "Clip sans titre"])),
    accountLabels: new Map(accounts.map((a) => [a.id, `${a.displayName} (${a.platform === "YOUTUBE" ? "YouTube" : "TikTok"})`])),
    input: {
      now,
      config,
      clips: candidateClips,
      accounts: pilotAccounts,
      paused: state.paused,
      scheduledLast24h: ap.dryRun ? simCount : realCount,
    },
  };
}
