/**
 * Annuaires des lives : « qui stream ce jeu en ce moment ? ».
 *
 * - Twitch : API Helix avec un jeton d'application (flux « client credentials »),
 *   identifiants facultatifs TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET.
 * - Kick : API publique officielle (api.kick.com/public/v1), même principe avec
 *   KICK_CLIENT_ID / KICK_CLIENT_SECRET.
 *
 * Écrit d'après la documentation publique des deux plateformes ; testé uniquement contre
 * un réseau simulé (tests/discovery.test.ts). Les adresses sont surchargeables pour les tests.
 */
import { canonicalGame } from "./sources";

export type DirectoryPlatform = "TWITCH" | "KICK";

export interface DiscoveredStream {
  platform: DirectoryPlatform;
  /** Identifiant de chaîne (login Twitch, slug Kick), en minuscules */
  login: string;
  displayName: string;
  title: string;
  viewers: number;
  thumbnailUrl: string | null;
  language: string | null;
  startedAt: string | null;
  game: string | null;
}

function str(name: string, def = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? def : v;
}

export const directoryEnv = {
  twitch: {
    get clientId() {
      return str("TWITCH_CLIENT_ID");
    },
    get clientSecret() {
      return str("TWITCH_CLIENT_SECRET");
    },
    get apiUrl() {
      return str("TWITCH_API_URL", "https://api.twitch.tv/helix").replace(/\/+$/, "");
    },
    get authUrl() {
      return str("TWITCH_AUTH_URL", "https://id.twitch.tv/oauth2/token");
    },
  },
  kick: {
    get clientId() {
      return str("KICK_CLIENT_ID");
    },
    get clientSecret() {
      return str("KICK_CLIENT_SECRET");
    },
    get apiUrl() {
      return str("KICK_API_URL", "https://api.kick.com/public/v1").replace(/\/+$/, "");
    },
    get authUrl() {
      return str("KICK_AUTH_URL", "https://id.kick.com/oauth/token");
    },
  },
};

export function directoryConfigured(platform: DirectoryPlatform): boolean {
  const c = platform === "TWITCH" ? directoryEnv.twitch : directoryEnv.kick;
  return !!c.clientId && !!c.clientSecret;
}

export class DirectoryError extends Error {}

// ───────────────────────── Jetons d'application ─────────────────────────

const tokens = new Map<DirectoryPlatform, { token: string; expiresAt: number }>();

async function appToken(platform: DirectoryPlatform, force = false): Promise<string> {
  const cached = tokens.get(platform);
  if (!force && cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
  const c = platform === "TWITCH" ? directoryEnv.twitch : directoryEnv.kick;
  const label = platform === "TWITCH" ? "Twitch" : "Kick";
  const res = await fetch(c.authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; message?: string; error?: string };
  if (!res.ok || !data.access_token) {
    const why = data.message || data.error || `HTTP ${res.status}`;
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new DirectoryError(`${label} refuse les identifiants d'application (${why}) : vérifie ${platform}_CLIENT_ID et ${platform}_CLIENT_SECRET.`);
    }
    throw new DirectoryError(`${label} : impossible d'obtenir un jeton d'application (${why}).`);
  }
  tokens.set(platform, { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

/** Oublie les jetons en cache (tests). */
export function resetDirectoryTokens(): void {
  tokens.clear();
}

async function apiGet<T>(platform: DirectoryPlatform, url: string): Promise<T> {
  const label = platform === "TWITCH" ? "Twitch" : "Kick";
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await appToken(platform, attempt > 0);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (platform === "TWITCH") headers["Client-Id"] = directoryEnv.twitch.clientId;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (res.status === 401 && attempt === 0) continue; // jeton expiré ou révoqué : on en redemande un
    if (res.status === 429) throw new DirectoryError(`${label} : trop de requêtes, nouvel essai à la prochaine actualisation.`);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      throw new DirectoryError(`${label} : ${data.message || `HTTP ${res.status}`}`);
    }
    return (await res.json()) as T;
  }
  throw new DirectoryError(`${label} : accès refusé.`);
}

function pickCategory<T extends { name?: string }>(list: T[], game: string): T | null {
  const want = canonicalGame(game);
  return list.find((c) => canonicalGame(c.name ?? "") === want) ?? null;
}

// ───────────────────────── Twitch ─────────────────────────

interface HelixGame {
  id?: string;
  name?: string;
}
interface HelixStream {
  user_login?: string;
  user_name?: string;
  game_name?: string;
  title?: string;
  viewer_count?: number;
  language?: string;
  thumbnail_url?: string;
  started_at?: string;
  type?: string;
}

const gameIds = new Map<string, { id: string; name: string } | null>();

async function twitchGame(game: string): Promise<{ id: string; name: string } | null> {
  const key = canonicalGame(game);
  if (gameIds.has(key)) return gameIds.get(key) ?? null;
  const base = directoryEnv.twitch.apiUrl;
  // Nom exact d'abord, puis recherche approchée (« GTA 6 » → « Grand Theft Auto VI »).
  const exact = await apiGet<{ data?: HelixGame[] }>("TWITCH", `${base}/games?${new URLSearchParams({ name: game })}`);
  let found = pickCategory(exact.data ?? [], game) ?? exact.data?.[0] ?? null;
  if (!found?.id) {
    const search = await apiGet<{ data?: HelixGame[] }>("TWITCH", `${base}/search/categories?${new URLSearchParams({ query: game, first: "20" })}`);
    found = pickCategory(search.data ?? [], game);
  }
  const result = found?.id ? { id: found.id, name: found.name ?? game } : null;
  gameIds.set(key, result);
  return result;
}

export async function twitchTopStreams(game: string, language: string, limit: number): Promise<DiscoveredStream[]> {
  const g = await twitchGame(game);
  if (!g) throw new DirectoryError(`Twitch ne connaît pas la catégorie « ${game} ». Vérifie l'orthographe exacte du jeu.`);
  const params = new URLSearchParams({ game_id: g.id, type: "live", first: String(Math.min(100, Math.max(1, limit))) });
  if (language) params.set("language", language);
  const res = await apiGet<{ data?: HelixStream[] }>("TWITCH", `${directoryEnv.twitch.apiUrl}/streams?${params}`);
  return (res.data ?? [])
    .filter((s) => s.user_login && (s.type ?? "live") === "live")
    .map((s) => ({
      platform: "TWITCH" as const,
      login: s.user_login!.toLowerCase(),
      displayName: s.user_name || s.user_login!,
      title: s.title ?? "",
      viewers: s.viewer_count ?? 0,
      thumbnailUrl: s.thumbnail_url ? s.thumbnail_url.replace("{width}", "440").replace("{height}", "248") : null,
      language: s.language ?? null,
      startedAt: s.started_at ?? null,
      game: s.game_name ?? g.name,
    }));
}

// ───────────────────────── Kick ─────────────────────────

interface KickCategory {
  id?: number;
  name?: string;
}
interface KickLivestream {
  slug?: string;
  channel?: { slug?: string };
  broadcaster_user_id?: number;
  stream_title?: string;
  viewer_count?: number;
  thumbnail?: string | { url?: string };
  language?: string;
  started_at?: string;
  category?: { name?: string };
}

const kickCategories = new Map<string, { id: number; name: string } | null>();

async function kickCategory(game: string): Promise<{ id: number; name: string } | null> {
  const key = canonicalGame(game);
  if (kickCategories.has(key)) return kickCategories.get(key) ?? null;
  const res = await apiGet<{ data?: KickCategory[] }>("KICK", `${directoryEnv.kick.apiUrl}/categories?${new URLSearchParams({ q: game })}`);
  const found = pickCategory(res.data ?? [], game);
  const result = found?.id !== undefined ? { id: found.id, name: found.name ?? game } : null;
  kickCategories.set(key, result);
  return result;
}

export async function kickTopStreams(game: string, language: string, limit: number): Promise<DiscoveredStream[]> {
  const c = await kickCategory(game);
  if (!c) throw new DirectoryError(`Kick ne connaît pas la catégorie « ${game} ».`);
  const params = new URLSearchParams({ category_id: String(c.id), limit: String(Math.min(100, Math.max(1, limit))), sort: "viewer_count" });
  if (language) params.set("language", language);
  const res = await apiGet<{ data?: KickLivestream[] }>("KICK", `${directoryEnv.kick.apiUrl}/livestreams?${params}`);
  return (res.data ?? [])
    .map((s) => ({ s, slug: s.slug ?? s.channel?.slug }))
    .filter((x): x is { s: KickLivestream; slug: string } => !!x.slug)
    .map(({ s, slug }) => ({
      platform: "KICK" as const,
      login: slug.toLowerCase(),
      displayName: slug,
      title: s.stream_title ?? "",
      viewers: s.viewer_count ?? 0,
      thumbnailUrl: typeof s.thumbnail === "string" ? s.thumbnail : (s.thumbnail?.url ?? null),
      language: s.language ?? null,
      startedAt: s.started_at ?? null,
      game: s.category?.name ?? c.name,
    }));
}

/** Oublie les correspondances jeu → identifiant (tests, ou jeu renommé). */
export function resetDirectoryCaches(): void {
  gameIds.clear();
  kickCategories.clear();
}

/**
 * Classement fusionné des plateformes configurées, du plus regardé au moins regardé.
 * Une plateforme en erreur n'empêche pas l'autre de répondre : ses erreurs sont renvoyées à part.
 */
export async function topStreams(game: string, language: string, limit = 24): Promise<{ streams: DiscoveredStream[]; errors: string[] }> {
  const jobs: Array<Promise<DiscoveredStream[]>> = [];
  if (directoryConfigured("TWITCH")) jobs.push(twitchTopStreams(game, language, limit));
  if (directoryConfigured("KICK")) jobs.push(kickTopStreams(game, language, limit));
  const settled = await Promise.allSettled(jobs);
  const streams: DiscoveredStream[] = [];
  const errors: string[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") streams.push(...r.value);
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }
  streams.sort((a, b) => b.viewers - a.viewers);
  return { streams: streams.slice(0, limit), errors };
}
