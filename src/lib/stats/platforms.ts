// Lecture des compteurs (vues, j'aime…) des vidéos publiées, sur YouTube et TikTok.
//
// ⚠ Écrit d'après la documentation publique des deux API et testé contre un réseau simulé (tests/stats-platforms.test.ts) :
// aucun appel réel n'a pu être fait depuis l'environnement de développement.
//   YouTube : GET https://www.googleapis.com/youtube/v3/videos?part=statistics&id=…  (50 identifiants max, 1 unité de quota)
//   TikTok  : POST https://open.tiktokapis.com/v2/video/query/?fields=…  {filters:{video_ids:[…]}}  (20 max, autorisation video.list)
import type { SocialPlatform } from "@prisma/client";
import { PlatformRejectedError, ReauthRequiredError } from "../platforms/types";

export interface VideoStats {
  views: number;
  likes: number | null;
  comments: number | null;
  /** YouTube ne donne pas les partages */
  shares: number | null;
}

export const BATCH_SIZE: Record<SocialPlatform, number> = { YOUTUBE: 50, TIKTOK: 20 };

/** L'autorisation TikTok qui permet de lire les compteurs de ses propres vidéos. */
export const TIKTOK_STATS_SCOPE = "video.list";

/** Les comptes YouTube ont déjà youtube.readonly ; les comptes TikTok doivent avoir accordé video.list. */
export function canReadStats(platform: SocialPlatform, scopes: string): boolean {
  const list = scopes.split(/[\s,]+/).filter(Boolean);
  if (platform === "TIKTOK") return list.includes(TIKTOK_STATS_SCOPE);
  // Les anciens comptes peuvent avoir une liste vide : on tente, l'API dira si l'accès manque.
  return list.length === 0 || list.some((s) => s.includes("youtube.readonly") || s.endsWith("/auth/youtube") || s.includes("youtube.force-ssl"));
}

export type Trackability = "OK" | "DRAFT" | "NO_SCOPE" | "NO_ID";

/**
 * Peut-on suivre cette publication ?
 * Un envoi TikTok en brouillon n'a pas d'identifiant public : la vidéo que tu postes ensuite depuis l'app
 * n'est reliée à rien de ce que l'API nous a renvoyé.
 */
export function trackability(
  pub: { privacy: string; externalId: string | null },
  account: { platform: SocialPlatform; scopes: string },
): Trackability {
  if (account.platform === "TIKTOK") {
    if (pub.privacy === "draft") return "DRAFT";
    // Un identifiant de vidéo TikTok est numérique ; sinon on n'a que le publish_id de l'envoi.
    if (!pub.externalId || !/^\d+$/.test(pub.externalId)) return "NO_ID";
  } else if (!pub.externalId) return "NO_ID";
  if (!canReadStats(account.platform, account.scopes)) return "NO_SCOPE";
  return "OK";
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(2_147_483_647, Math.round(n))) : null;
}

interface GoogleError {
  error?: { message?: string; errors?: Array<{ reason?: string }> };
}

/** Renvoie les compteurs des vidéos trouvées ; une vidéo absente de la réponse a été supprimée ou rendue inaccessible. */
export async function fetchYoutubeStats(accessToken: string, videoIds: string[]): Promise<Map<string, VideoStats>> {
  const out = new Map<string, VideoStats>();
  if (videoIds.length === 0) return out;
  const q = new URLSearchParams({ part: "statistics", id: videoIds.slice(0, 50).join(","), maxResults: "50" });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${q}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as GoogleError;
    const reason = data.error?.errors?.[0]?.reason ?? "";
    if (res.status === 401) throw new ReauthRequiredError("Accès YouTube refusé : reconnecte le compte.");
    if (["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"].includes(reason)) {
      throw new PlatformRejectedError("YouTube : quota de l'API épuisé pour aujourd'hui, les relevés reprendront demain.");
    }
    if (res.status === 403) throw new PlatformRejectedError(`YouTube refuse la lecture des statistiques : ${data.error?.message ?? "accès refusé"}`);
    throw new Error(`YouTube (statistiques) : ${data.error?.message ?? `HTTP ${res.status}`}`);
  }
  const data = (await res.json()) as {
    items?: Array<{ id?: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }>;
  };
  for (const item of data.items ?? []) {
    if (!item.id) continue;
    const s = item.statistics ?? {};
    // likeCount/commentCount sont absents quand le créateur les masque ou désactive les commentaires.
    out.set(item.id, { views: num(s.viewCount) ?? 0, likes: num(s.likeCount), comments: num(s.commentCount), shares: null });
  }
  return out;
}

interface TikTokVideo {
  id?: string | number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
}

export async function fetchTiktokStats(accessToken: string, videoIds: string[]): Promise<Map<string, VideoStats>> {
  const out = new Map<string, VideoStats>();
  if (videoIds.length === 0) return out;
  const fields = "id,view_count,like_count,comment_count,share_count";
  const res = await fetch(`https://open.tiktokapis.com/v2/video/query/?fields=${fields}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ filters: { video_ids: videoIds.slice(0, 20) } }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { videos?: TikTokVideo[] };
    error?: { code?: string; message?: string };
  };
  const code = json.error?.code;
  if (code && code !== "ok") {
    if (code === "access_token_invalid") throw new ReauthRequiredError("Accès TikTok refusé : reconnecte le compte.");
    if (code === "scope_not_authorized") throw new PlatformRejectedError("TikTok : l'autorisation « video.list » manque. Reconnecte le compte.");
    const message = `TikTok (${code}) : ${json.error?.message ?? "erreur inconnue"}`;
    throw res.status >= 500 || code === "rate_limit_exceeded" || code === "internal_error" ? new Error(message) : new PlatformRejectedError(message);
  }
  if (!res.ok) throw new Error(`TikTok (statistiques) : HTTP ${res.status}`);
  for (const v of json.data?.videos ?? []) {
    if (v.id === undefined) continue;
    out.set(String(v.id), { views: num(v.view_count) ?? 0, likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count) });
  }
  return out;
}

export function fetchStats(platform: SocialPlatform, accessToken: string, ids: string[]): Promise<Map<string, VideoStats>> {
  return platform === "YOUTUBE" ? fetchYoutubeStats(accessToken, ids) : fetchTiktokStats(accessToken, ids);
}
