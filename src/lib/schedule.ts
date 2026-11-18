/**
 * Planification en lot : répartir des clips DIFFÉRENTS sur plusieurs comptes, étalés dans le temps.
 * Module pur (sans base ni réseau) : il sert à l'aperçu dans le navigateur ET à la validation serveur,
 * pour que ce qui est montré soit exactement ce qui est accepté.
 *
 * Règles :
 *  - un clip n'apparaît qu'une seule fois dans le planning (jamais la même vidéo sur deux comptes) ;
 *  - deux publications d'un même compte sont séparées d'au moins `gapMin` minutes ;
 *  - un compte ne dépasse pas son plafond sur 24 heures glissantes (`dailyCap`).
 */

export const DAY_MS = 24 * 3600_000;
export const MAX_AHEAD_MS = 60 * DAY_MS;

export interface PlanAccount {
  id: string;
  /** Plafond de publications sur 24 h glissantes (null = aucun) */
  dailyCap: number | null;
  /** Publications déjà programmées ou faites sur ce compte (horodatages ms) */
  existing: number[];
}

export interface PlanRow {
  clipId: string;
  accountId: string;
  /** Horodatage ms */
  at: number;
}

export interface PlanOptions {
  /** Première publication possible (ms) */
  start: number;
  /** Écart minimal entre deux publications d'un même compte, en minutes */
  gapMin: number;
  /** Décalage de départ entre comptes, en minutes (pour ne pas tout publier à la même minute) */
  staggerMin: number;
}

export interface PlanIssue {
  /** Index de la ligne concernée, ou null pour un problème général */
  row: number | null;
  message: string;
}

/** Vrai si l'ensemble trié respecte le plafond glissant : cap+1 publications ne tiennent jamais dans 24 h. */
function capViolation(sorted: number[], cap: number | null): number | null {
  if (!cap) return null;
  for (let j = 0; j + cap < sorted.length; j++) {
    if (sorted[j + cap]! - sorted[j]! < DAY_MS) return j;
  }
  return null;
}

/** Premier instant ≥ t compatible avec l'écart minimal et le plafond du compte. */
export function earliestSlot(times: number[], t: number, gapMs: number, cap: number | null): number {
  let at = t;
  for (let guard = 0; guard < 2000; guard++) {
    const clash = times.filter((x) => Math.abs(x - at) < gapMs);
    if (clash.length) {
      at = Math.max(...clash) + gapMs;
      continue;
    }
    if (cap) {
      const sorted = [...times, at].sort((a, b) => a - b);
      const idx = sorted.indexOf(at);
      let moved = false;
      for (let j = Math.max(0, idx - cap); j <= idx && j + cap < sorted.length; j++) {
        if (sorted[j + cap]! - sorted[j]! < DAY_MS) {
          // La fenêtre qui commence à sorted[j] est pleine : on attend qu'elle se libère.
          at = Math.max(at + 60_000, sorted[j]! + DAY_MS);
          moved = true;
          break;
        }
      }
      if (moved) continue;
    }
    return at;
  }
  return at;
}

/**
 * Répartition gloutonne : chaque clip (dans l'ordre donné, le meilleur d'abord) va au compte
 * qui peut le publier le plus tôt ; à égalité, au compte qui en a le moins.
 */
export function buildPlan(clipIds: string[], accounts: PlanAccount[], opts: PlanOptions): PlanRow[] {
  if (accounts.length === 0) return [];
  const gapMs = Math.max(0, opts.gapMin) * 60_000;
  const state = accounts.map((a, k) => ({
    account: a,
    times: [...a.existing],
    base: opts.start + k * Math.max(0, opts.staggerMin) * 60_000,
    count: 0,
  }));
  const rows: PlanRow[] = [];
  for (const clipId of clipIds) {
    let best: { s: (typeof state)[number]; at: number } | null = null;
    for (const s of state) {
      const at = earliestSlot(s.times, s.base, gapMs, s.account.dailyCap);
      if (!best || at < best.at || (at === best.at && s.count < best.s.count)) best = { s, at };
    }
    if (!best) break;
    best.s.times.push(best.at);
    best.s.count++;
    rows.push({ clipId, accountId: best.s.account.id, at: best.at });
  }
  return rows.sort((a, b) => a.at - b.at);
}

/** Contrôle un planning (éventuellement retouché à la main). Liste vide = planning valide. */
export function checkPlan(rows: PlanRow[], accounts: PlanAccount[], opts: { gapMin: number; now: number }): PlanIssue[] {
  const issues: PlanIssue[] = [];
  if (rows.length === 0) issues.push({ row: null, message: "Le planning est vide." });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const seenClip = new Map<string, number>();
  const gapMs = Math.max(0, opts.gapMin) * 60_000;

  rows.forEach((r, i) => {
    const prev = seenClip.get(r.clipId);
    if (prev !== undefined) {
      issues.push({ row: i, message: `Ce clip est déjà prévu ligne ${prev + 1} : une même vidéo ne part que sur un seul compte.` });
    } else {
      seenClip.set(r.clipId, i);
    }
    if (!byId.has(r.accountId)) issues.push({ row: i, message: "Compte inconnu ou à reconnecter." });
    if (!Number.isFinite(r.at)) issues.push({ row: i, message: "Date invalide." });
    else if (r.at < opts.now - 60_000) issues.push({ row: i, message: "Cette date est déjà passée." });
    else if (r.at > opts.now + MAX_AHEAD_MS) issues.push({ row: i, message: "Au-delà de 60 jours : réduis le nombre de clips ou l'écart." });
  });

  for (const a of accounts) {
    const mine = rows.map((r, i) => ({ ...r, i })).filter((r) => r.accountId === a.id && Number.isFinite(r.at));
    if (mine.length === 0) continue;
    const all = [...a.existing.map((at) => ({ at, i: -1 })), ...mine.map((r) => ({ at: r.at, i: r.i }))].sort((x, y) => x.at - y.at);
    for (let k = 1; k < all.length; k++) {
      const x = all[k - 1]!;
      const y = all[k]!;
      if (y.at - x.at < gapMs) {
        const row = y.i >= 0 ? y.i : x.i;
        issues.push({ row, message: `Moins de ${formatGap(opts.gapMin)} après une autre publication sur ce compte.` });
      }
    }
    const j = capViolation(all.map((x) => x.at), a.dailyCap);
    if (j !== null) {
      const row = all.slice(j, j + (a.dailyCap ?? 0) + 1).reverse().find((x) => x.i >= 0)?.i ?? null;
      issues.push({ row, message: `Plus de ${a.dailyCap} publications en 24 h sur ce compte (son plafond).` });
    }
  }
  return issues;
}

export function formatGap(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}
