import type { DiscoveredStream } from "./live-apis";

export const DISCOVERY_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "fr", label: "Français" },
  { value: "en", label: "Anglais" },
  { value: "es", label: "Espagnol" },
  { value: "pt", label: "Portugais" },
  { value: "de", label: "Allemand" },
  { value: "it", label: "Italien" },
  { value: "", label: "Toutes les langues" },
];

export const AUTO_FOLLOW_MAX = 20;

export function streamKey(s: { platform: string; login: string }): string {
  return `${s.platform}:${s.login.toLowerCase()}`;
}

export function parseResults(value: unknown): DiscoveredStream[] {
  return Array.isArray(value) ? (value as DiscoveredStream[]).filter((s) => s && typeof s.login === "string") : [];
}

export interface AutoStreamerState {
  id: string;
  platform: string;
  login: string;
  enabled: boolean;
  /** Un enregistrement est en cours : on ne coupe pas un live en plein clip */
  recording: boolean;
  /** Des clips existent : on garde la chaîne (désactivée) pour conserver le crédit */
  hasClips: boolean;
}

export interface AutoFollowInput {
  /** Classement actuel, du plus regardé au moins regardé */
  ranked: DiscoveredStream[];
  /** Chaînes ajoutées automatiquement auparavant */
  autos: AutoStreamerState[];
  /** Chaînes suivies à la main (clé plateforme:login) : jamais touchées, jamais dupliquées */
  manual: Set<string>;
  /** Chaînes retirées par l'utilisateur : le mode automatique ne les reprend pas */
  excluded: Set<string>;
  /** Nombre de lives voulus */
  count: number;
  /** Places d'enregistrement encore libres pour les chaînes automatiques (MAX_CONCURRENT_RECORDINGS) */
  slots: number;
}

export interface AutoFollowPlan {
  add: DiscoveredStream[];
  /** Chaînes automatiques à réactiver (revenues dans le classement) */
  enable: string[];
  /** À supprimer (sans clips) */
  remove: string[];
  /** À mettre en pause (sorties du classement, mais des clips leur sont rattachés) */
  disable: string[];
  /** Spectateurs à jour pour les chaînes gardées */
  viewers: Array<{ id: string; viewers: number }>;
}

/**
 * Décide quelles chaînes le mode automatique doit suivre : les N plus gros lives éligibles,
 * dans la limite des places d'enregistrement. Une chaîne en cours d'enregistrement n'est pas
 * retirée tant qu'elle est encore en live sur le jeu (elle compte alors dans les N).
 */
export function planAutoFollow(input: AutoFollowInput): AutoFollowPlan {
  const target = Math.max(0, Math.min(input.count, input.slots, AUTO_FOLLOW_MAX));
  const rankedByKey = new Map(input.ranked.map((s) => [streamKey(s), s]));
  const autoByKey = new Map(input.autos.map((a) => [streamKey(a), a]));

  const keep = new Set<string>();
  // 1. Les enregistrements en cours restent tant que le live continue sur le jeu.
  for (const a of input.autos) {
    const k = streamKey(a);
    if (a.enabled && a.recording && rankedByKey.has(k) && !input.excluded.has(k)) keep.add(k);
  }
  // 2. On complète avec les plus gros lives éligibles.
  for (const s of input.ranked) {
    if (keep.size >= target) break;
    const k = streamKey(s);
    if (input.manual.has(k) || input.excluded.has(k)) continue;
    keep.add(k);
  }

  const plan: AutoFollowPlan = { add: [], enable: [], remove: [], disable: [], viewers: [] };
  for (const k of keep) {
    const existing = autoByKey.get(k);
    const live = rankedByKey.get(k);
    if (!existing) {
      if (live) plan.add.push(live);
      continue;
    }
    if (!existing.enabled) plan.enable.push(existing.id);
    if (live) plan.viewers.push({ id: existing.id, viewers: live.viewers });
  }
  for (const a of input.autos) {
    if (keep.has(streamKey(a))) continue;
    if (a.hasClips) {
      if (a.enabled) plan.disable.push(a.id);
    } else {
      plan.remove.push(a.id);
    }
  }
  return plan;
}

/** URL de la chaîne (et du live, pour streamlink) d'un live découvert. */
export function channelUrl(s: { platform: string; login: string }): string {
  return s.platform === "KICK" ? `https://kick.com/${s.login}` : `https://www.twitch.tv/${s.login}`;
}

export function compactViewers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 10_000) return `${Math.round(n / 1000)} k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(".", ",")} k`;
  return String(n);
}
