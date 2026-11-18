/**
 * Pilote automatique : décide, à chaque passage du worker, quels clips approuver et lesquels programmer.
 * Module pur (sans base ni réseau) : la même fonction sert à l'aperçu « ce que le pilote ferait maintenant »
 * dans l'interface et au worker, et elle est couverte par des tests.
 *
 * Ce que le pilote ne fait jamais :
 *  - publier la même vidéo sur deux comptes (un clip déjà publié, programmé, annulé ou échoué n'est plus candidat) ;
 *  - dépasser le plafond global sur 24 h, le plafond de chaque compte, ou sortir de la plage horaire ;
 *  - utiliser un compte à reconnecter ou mis en pause ;
 *  - programmer moins de `graceMin` minutes à l'avance (délai pendant lequel l'utilisateur peut annuler).
 */
import { DEFAULT_TZ, inRange, isValidTimeZone, rangeEnd, type HourRange } from "./local-time";
import { buildPlan, DAY_MS, type PlanAccount, type PlanRow } from "./schedule";

export interface AutopilotConfig {
  /** Approuver seul les clips prêts dont le score atteint `minScore` */
  approve: boolean;
  minScore: number;
  /** Programmer seul les clips approuvés sur les comptes choisis */
  schedule: boolean;
  /** Tous les streamers, ou seulement ceux de la liste */
  allStreamers: boolean;
  streamers: string[];
  /** Comptes que le pilote a le droit d'utiliser (liste explicite) */
  accounts: string[];
  /** Plafond du pilote par compte sur 24 h glissantes (en plus du plafond propre au compte) */
  perAccountCap: number;
  /** Plafond global : publications programmées par le pilote sur 24 h glissantes, tous comptes confondus */
  globalDailyCap: number;
  /** Écart minimal entre deux publications d'un même compte (minutes) */
  gapMin: number;
  /** Décalage de départ entre comptes (minutes) */
  staggerMin: number;
  /** Délai de grâce entre la programmation et l'envoi (minutes) */
  graceMin: number;
  /** Heures locales où le pilote peut publier */
  window: HourRange;
  /** Âge maximal d'un clip pour être programmé (heures) : un moment de live vieux de deux jours n'intéresse plus */
  maxClipAgeH: number;
  /** Fuseau de l'utilisateur (relevé par le navigateur) */
  tz: string;
}

export const DEFAULT_AUTOPILOT: AutopilotConfig = {
  approve: true,
  minScore: 80,
  schedule: false,
  allStreamers: false,
  streamers: [],
  accounts: [],
  perAccountCap: 3,
  globalDailyCap: 8,
  gapMin: 120,
  staggerMin: 20,
  graceMin: 30,
  window: { from: 10, to: 23 },
  maxClipAgeH: 24,
  tz: DEFAULT_TZ,
};

export const LIMITS = {
  minScore: [0, 100],
  perAccountCap: [1, 20],
  globalDailyCap: [1, 50],
  gapMin: [15, 24 * 60],
  staggerMin: [0, 240],
  graceMin: [5, 24 * 60],
  maxClipAgeH: [1, 14 * 24],
} as const satisfies Record<string, readonly [number, number]>;

function clampInt(v: unknown, [lo, hi]: readonly [number, number], def: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 64))] : [];
}

/** Lit une configuration stockée (JSON libre) en appliquant les bornes : aucune valeur hors limites n'atteint le pilote. */
export function parseAutopilotConfig(raw: unknown): AutopilotConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_AUTOPILOT;
  const w = (r.window && typeof r.window === "object" ? r.window : {}) as Record<string, unknown>;
  return {
    approve: typeof r.approve === "boolean" ? r.approve : d.approve,
    minScore: clampInt(r.minScore, LIMITS.minScore, d.minScore),
    schedule: typeof r.schedule === "boolean" ? r.schedule : d.schedule,
    allStreamers: typeof r.allStreamers === "boolean" ? r.allStreamers : d.allStreamers,
    streamers: strList(r.streamers),
    accounts: strList(r.accounts),
    perAccountCap: clampInt(r.perAccountCap, LIMITS.perAccountCap, d.perAccountCap),
    globalDailyCap: clampInt(r.globalDailyCap, LIMITS.globalDailyCap, d.globalDailyCap),
    gapMin: clampInt(r.gapMin, LIMITS.gapMin, d.gapMin),
    staggerMin: clampInt(r.staggerMin, LIMITS.staggerMin, d.staggerMin),
    graceMin: clampInt(r.graceMin, LIMITS.graceMin, d.graceMin),
    window: { from: clampInt(w.from, [0, 23], d.window.from), to: clampInt(w.to, [0, 23], d.window.to) },
    maxClipAgeH: clampInt(r.maxClipAgeH, LIMITS.maxClipAgeH, d.maxClipAgeH),
    tz: typeof r.tz === "string" && isValidTimeZone(r.tz) ? r.tz : d.tz,
  };
}

export interface CandidateClip {
  id: string;
  title: string;
  status: "PROCESSING" | "READY" | "APPROVED" | "REJECTED" | "FAILED";
  score: number;
  streamerId: string | null;
  hasFinal: boolean;
  createdAt: number;
  /** Le clip a déjà au moins une publication (quel que soit son état) ou a déjà été programmé en simulation */
  handled: boolean;
}

export interface PilotAccount extends PlanAccount {
  label: string;
  /** Faux = connexion à refaire */
  valid: boolean;
}

export interface DecisionInput {
  now: number;
  config: AutopilotConfig;
  clips: CandidateClip[];
  accounts: PilotAccount[];
  /** Comptes mis en pause par le pilote (échecs répétés), avec la raison */
  paused: Record<string, string>;
  /** Publications programmées par le pilote sur les dernières 24 h (simulées comprises en simulation) */
  scheduledLast24h: number;
}

export interface Decision {
  approve: Array<{ clipId: string; reason: string }>;
  schedule: Array<PlanRow & { reason: string }>;
  /** Clips qui auraient pu être pris mais ne l'ont pas été, avec la raison */
  skipped: Array<{ clipId: string; reason: string }>;
  /** Comptes écartés à ce passage */
  blocked: Array<{ accountId: string; reason: string }>;
  /** Pourquoi rien (ou pas tout) n'a été programmé */
  notes: string[];
}

export function decide(input: DecisionInput): Decision {
  const { now, config: c } = input;
  const out: Decision = { approve: [], schedule: [], skipped: [], blocked: [], notes: [] };
  const allowed = (clip: CandidateClip) => c.allStreamers || (clip.streamerId !== null && c.streamers.includes(clip.streamerId));
  const fresh = (clip: CandidateClip) => now - clip.createdAt <= c.maxClipAgeH * 3600_000;

  // 1. Approbation automatique
  const approved = new Set<string>();
  if (c.approve) {
    for (const clip of input.clips) {
      if (clip.status !== "READY" || !clip.hasFinal || clip.score < c.minScore) continue;
      if (!allowed(clip)) {
        out.skipped.push({ clipId: clip.id, reason: "streamer non autorisé dans le pilote" });
        continue;
      }
      if (!fresh(clip)) continue;
      approved.add(clip.id);
      out.approve.push({ clipId: clip.id, reason: `score ${clip.score} ≥ ${c.minScore}` });
    }
  }

  if (!c.schedule) return out;

  // 2. Programmation
  const candidates = input.clips
    .filter((clip) => (clip.status === "APPROVED" || approved.has(clip.id)) && clip.hasFinal && !clip.handled && fresh(clip))
    .filter((clip) => {
      if (allowed(clip)) return true;
      out.skipped.push({ clipId: clip.id, reason: "streamer non autorisé dans le pilote" });
      return false;
    })
    .sort((a, b) => b.score - a.score || a.createdAt - b.createdAt);
  if (candidates.length === 0) return out;

  const usable: PilotAccount[] = [];
  for (const id of c.accounts) {
    const a = input.accounts.find((x) => x.id === id);
    if (!a) continue;
    if (!a.valid) out.blocked.push({ accountId: id, reason: "connexion à refaire" });
    else if (input.paused[id]) out.blocked.push({ accountId: id, reason: input.paused[id]! });
    else usable.push(a);
  }
  if (usable.length === 0) {
    out.notes.push(c.accounts.length ? "Aucun compte disponible : tous les comptes choisis sont en pause ou à reconnecter." : "Aucun compte choisi pour le pilote.");
    return out;
  }

  const remaining = c.globalDailyCap - input.scheduledLast24h;
  if (remaining <= 0) {
    out.notes.push(`Plafond global atteint : ${c.globalDailyCap} publications programmées par le pilote sur 24 h.`);
    return out;
  }

  const start = now + c.graceMin * 60_000;
  if (!inRange(start, c.window, c.tz)) {
    out.notes.push(`Hors de la plage horaire (${c.window.from} h – ${c.window.to} h) : rien n'est programmé pour l'instant.`);
    return out;
  }
  const end = Math.min(rangeEnd(start, c.window, c.tz), now + DAY_MS);

  const plan = buildPlan(
    candidates.map((clip) => clip.id),
    usable.map((a) => ({ id: a.id, existing: a.existing, dailyCap: Math.min(a.dailyCap ?? Infinity, c.perAccountCap) })),
    { start, gapMin: c.gapMin, staggerMin: c.staggerMin },
  );
  const inWindow = plan.filter((r) => r.at < end);
  const kept = inWindow.slice(0, remaining);
  const byId = new Map(candidates.map((clip) => [clip.id, clip]));
  for (const r of kept) {
    out.schedule.push({ ...r, reason: `meilleur clip disponible (score ${byId.get(r.clipId)?.score ?? "?"}), compte libre le plus tôt` });
  }
  if (inWindow.length > kept.length) out.notes.push(`Plafond global de ${c.globalDailyCap} sur 24 h : ${inWindow.length - kept.length} clip(s) attendront.`);
  if (plan.length > inWindow.length) out.notes.push(`${plan.length - inWindow.length} clip(s) reportés : plus de créneau libre avant la fin de la plage horaire (écart et plafonds par compte).`);
  return out;
}
