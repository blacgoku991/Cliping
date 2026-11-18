// Calculs purs (sans base ni réseau) du suivi des performances : testés dans tests/stats.test.ts.

/** En dessous de ce nombre de publications, un groupe n'est pas assez représentatif pour conclure. */
export const MIN_SAMPLE = 5;

/** Âge (en heures) auquel on compare les publications entre elles : toutes ont eu le même temps pour démarrer. */
export const COMPARE_AT_HOURS = 24;

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

const HOUR = 3600_000;

// ───────────── Rythme des relevés ─────────────

/**
 * Intervalle avant le prochain relevé, selon l'âge de la publication.
 * Les vidéos courtes se jouent dans les premières heures : on mesure souvent au début, rarement ensuite.
 * Renvoie null quand le suivi est terminé (plus de 90 jours).
 */
export function nextCheckDelayMs(ageMs: number): number | null {
  const h = ageMs / HOUR;
  if (h < 2) return 15 * 60_000;
  if (h < 6) return 30 * 60_000;
  if (h < 48) return 2 * HOUR;
  if (h < 7 * 24) return 12 * HOUR;
  if (h < 30 * 24) return 24 * HOUR;
  if (h < 90 * 24) return 7 * 24 * HOUR;
  return null;
}

// ───────────── Courbes ─────────────

export interface Snapshot {
  at: Date;
  views: number;
}

/**
 * Vues estimées à `hours` heures après la publication, par interpolation linéaire entre deux relevés
 * (la publication elle-même compte comme un relevé à 0 vue).
 * Renvoie null si la publication n'a pas encore cet âge, ou si les relevés autour sont trop espacés
 * pour donner une estimation honnête (ex. suivi commencé une semaine après la mise en ligne).
 */
export function viewsAtAge(publishedAt: Date, snapshots: Snapshot[], hours: number, now = Date.now()): number | null {
  const target = publishedAt.getTime() + hours * HOUR;
  if (now < target) return null;
  const points = [{ t: publishedAt.getTime(), v: 0 }, ...snapshots.map((s) => ({ t: s.at.getTime(), v: s.views }))].sort((a, b) => a.t - b.t);
  let before = points[0]!;
  for (const p of points) {
    if (p.t === target) return p.v;
    if (p.t < target) {
      before = p;
      continue;
    }
    // Premier relevé après la cible : il ne doit pas être trop loin, sinon l'interpolation invente une courbe.
    const maxGap = hours * 0.5 * HOUR + HOUR;
    if (p.t - target > maxGap) return null;
    return Math.round(before.v + ((p.v - before.v) * (target - before.t)) / (p.t - before.t));
  }
  return null;
}

/** Dernière valeur connue à une date donnée (pour cumuler les vues de plusieurs publications jour par jour). */
export function valueAt(snapshots: Snapshot[], at: number): number {
  let v = 0;
  for (const s of snapshots) {
    if (s.at.getTime() <= at) v = s.views;
    else break;
  }
  return v;
}

// ───────────── Regroupements ─────────────

/** Heure locale (0..23) d'une date dans un fuseau IANA. Le serveur ne connaît pas le fuseau : il vient du navigateur. */
export function localHour(date: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(date);
  return Number(h) % 24;
}

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const HOUR_SLOTS = [
  { key: "0-4", label: "0 h – 4 h", from: 0 },
  { key: "4-8", label: "4 h – 8 h", from: 4 },
  { key: "8-12", label: "8 h – 12 h", from: 8 },
  { key: "12-16", label: "12 h – 16 h", from: 12 },
  { key: "16-20", label: "16 h – 20 h", from: 16 },
  { key: "20-24", label: "20 h – 24 h", from: 20 },
] as const;

export function hourSlot(hour: number): (typeof HOUR_SLOTS)[number] {
  return HOUR_SLOTS[Math.min(5, Math.max(0, Math.floor(hour / 4)))]!;
}

export const DURATION_BUCKETS = [
  { key: "lt20", label: "moins de 20 s", max: 20 },
  { key: "20-35", label: "20 à 35 s", max: 35 },
  { key: "35-50", label: "35 à 50 s", max: 50 },
  { key: "50-70", label: "50 à 70 s", max: 70 },
  { key: "gt70", label: "plus de 70 s", max: Infinity },
] as const;

export function durationBucket(sec: number): (typeof DURATION_BUCKETS)[number] {
  return DURATION_BUCKETS.find((b) => sec < b.max) ?? DURATION_BUCKETS[DURATION_BUCKETS.length - 1]!;
}

export const HOOK_STYLES = {
  none: "Sans accroche",
  question: "Question",
  number: "Avec un chiffre",
  pov: "« Quand… » / POV",
  shout: "Exclamation",
  statement: "Affirmation",
} as const;
export type HookStyle = keyof typeof HOOK_STYLES;

/** Classement grossier, par règles lisibles, du style d'une accroche. Pas d'IA : on veut pouvoir l'expliquer. */
export function hookStyle(hook: string): HookStyle {
  const h = hook.trim();
  if (!h) return "none";
  if (h.includes("?")) return "question";
  if (/^(quand|lorsque|pov\b|when\b)/i.test(h)) return "pov";
  if (/\d/.test(h)) return "number";
  const letters = h.replace(/[^\p{L}]/gu, "");
  const upper = letters.replace(/[^\p{Lu}]/gu, "");
  if (h.includes("!") || (letters.length >= 4 && upper.length / letters.length > 0.7)) return "shout";
  return "statement";
}

// ───────────── Constats ─────────────

export interface Sample {
  /** Valeur comparée (vues à 24 h) */
  value: number;
  /** Médiane du compte de la publication : sert à comparer des comptes de tailles différentes */
  accountMedian: number;
}

export interface GroupResult {
  key: string;
  label: string;
  n: number;
  /** Médiane des vues à 24 h dans ce groupe */
  medianValue: number | null;
  /** Médiane du rapport « vues / médiane du compte » : 1,5 = 50 % de mieux que d'habitude sur ce compte */
  medianRatio: number | null;
  enough: boolean;
}

export interface DimensionResult {
  groups: GroupResult[];
  /** Assez de données pour comparer au moins deux groupes */
  conclusive: boolean;
  best: GroupResult | null;
  worst: GroupResult | null;
}

/**
 * Compare les groupes d'une dimension (streamer, durée, créneau…).
 * On compare des rapports à la médiane du compte, pas des vues brutes : sinon le plus gros compte gagnerait toujours.
 */
export function compareGroups(
  samples: Array<Sample & { key: string; label: string }>,
  order?: readonly string[],
  minSample = MIN_SAMPLE,
): DimensionResult {
  const byKey = new Map<string, { label: string; values: number[]; ratios: number[] }>();
  for (const s of samples) {
    const g = byKey.get(s.key) ?? { label: s.label, values: [], ratios: [] };
    g.values.push(s.value);
    if (s.accountMedian > 0) g.ratios.push(s.value / s.accountMedian);
    byKey.set(s.key, g);
  }
  const groups: GroupResult[] = [...byKey.entries()].map(([key, g]) => ({
    key,
    label: g.label,
    n: g.values.length,
    medianValue: median(g.values),
    medianRatio: median(g.ratios),
    enough: g.values.length >= minSample,
  }));
  if (order) groups.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  else groups.sort((a, b) => Number(b.enough) - Number(a.enough) || (b.medianRatio ?? 0) - (a.medianRatio ?? 0) || b.n - a.n);

  const ranked = groups.filter((g) => g.enough && g.medianRatio !== null).sort((a, b) => b.medianRatio! - a.medianRatio!);
  const conclusive = ranked.length >= 2;
  return { groups, conclusive, best: conclusive ? ranked[0]! : null, worst: conclusive ? ranked[ranked.length - 1]! : null };
}

/** « ×1,8 » / « −35 % » : écart lisible par rapport à la médiane du compte. */
export function ratioLabel(ratio: number): string {
  if (ratio >= 1.95) return `×${ratio.toFixed(1).replace(".", ",")}`;
  const pct = Math.round((ratio - 1) * 100);
  return pct === 0 ? "≈ médiane" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)} %`;
}

/** 1 234 · 12,3 k · 4,2 M */
export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const a = Math.abs(n);
  if (a < 10_000) return Math.round(n).toLocaleString("fr-FR");
  if (a < 1_000_000) return `${(n / 1000).toFixed(a < 100_000 ? 1 : 0).replace(".", ",")} k`;
  return `${(n / 1_000_000).toFixed(1).replace(".", ",")} M`;
}
