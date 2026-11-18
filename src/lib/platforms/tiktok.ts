import { open } from "node:fs/promises";
import { env } from "../env";
import {
  hashtagLine,
  PlatformRejectedError,
  ReauthRequiredError,
  redirectUri,
  type AccountProfile,
  type PlatformAdapter,
  type PublishInput,
  type PublishResult,
  type TokenSet,
} from "./types";

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const API = "https://open.tiktokapis.com/v2";
const SCOPES = ["user.info.basic", "video.publish", "video.upload"];
const MB = 1_000_000;
const CHUNK = 10 * MB;
const SINGLE_CHUNK_MAX = 64 * MB;

const PRIVACY: Record<string, string> = {
  public: "PUBLIC_TO_EVERYONE",
  followers: "FOLLOWER_OF_CREATOR",
  friends: "MUTUAL_FOLLOW_FRIENDS",
  private: "SELF_ONLY",
};

const ERRORS: Record<string, string> = {
  spam_risk_too_many_posts: "TikTok : ce compte a atteint sa limite de publications via l'API pour aujourd'hui.",
  spam_risk_too_many_pending_share: "TikTok : trop de brouillons en attente (5 max par 24 h). Publie ou supprime ceux déjà envoyés dans l'app.",
  spam_risk_user_banned_from_posting: "TikTok : ce compte est actuellement interdit de publication.",
  reached_active_user_cap: "TikTok : ton application a atteint son quota d'utilisateurs actifs pour aujourd'hui.",
  unaudited_client_can_only_post_to_private_accounts:
    "TikTok : tant que ton application n'est pas auditée, la publication directe n'est possible que sur un compte privé. Utilise le mode « Brouillon », ou passe le compte en privé.",
  privacy_level_option_mismatch: "TikTok : ce niveau de visibilité n'est pas autorisé pour ce compte.",
  url_ownership_unverified: "TikTok : domaine non vérifié.",
  scope_not_authorized: "TikTok : autorisation manquante. Reconnecte le compte en acceptant toutes les permissions.",
};

interface TikTokEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
}

interface TikTokTokenResponse {
  access_token?: string;
  expires_in?: number;
  open_id?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({ client_key: env.tiktok.clientKey, client_secret: env.tiktok.clientSecret, ...params }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as TikTokTokenResponse;
  if (!res.ok || !data.access_token) {
    if (data.error === "invalid_grant") throw new ReauthRequiredError("Accès TikTok expiré ou révoqué : reconnecte le compte.");
    throw new Error(`TikTok OAuth : ${data.error_description || data.error || `HTTP ${res.status}`}`);
  }
  return {
    accessToken: data.access_token,
    // TikTok peut renvoyer un nouveau refresh_token : l'ancien cesse alors de fonctionner.
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    scopes: data.scope ?? "",
  };
}

async function call<T>(accessToken: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as TikTokEnvelope<T>;
  const code = json.error?.code;
  // TikTok renvoie parfois une erreur métier avec un HTTP 200 : on se fie au code, pas au statut.
  if (code && code !== "ok") {
    if (code === "access_token_invalid") throw new ReauthRequiredError("Accès TikTok refusé : reconnecte le compte.");
    const known = ERRORS[code];
    if (known) throw new PlatformRejectedError(known);
    const message = `TikTok (${code}) : ${json.error?.message ?? "erreur inconnue"}`;
    throw res.status >= 500 || code === "rate_limit_exceeded" || code === "internal_error" ? new Error(message) : new PlatformRejectedError(message);
  }
  if (!res.ok) throw new Error(`TikTok : HTTP ${res.status}`);
  return (json.data ?? {}) as T;
}

/** Découpage imposé par TikTok : blocs de 5 à 64 Mo, le dernier absorbe le reste. */
export function chunkPlan(size: number): { chunkSize: number; count: number } {
  if (size <= SINGLE_CHUNK_MAX) return { chunkSize: size, count: 1 };
  return { chunkSize: CHUNK, count: Math.floor(size / CHUNK) };
}

async function uploadFile(uploadUrl: string, filePath: string, size: number): Promise<void> {
  const { chunkSize, count } = chunkPlan(size);
  const fh = await open(filePath, "r");
  try {
    for (let i = 0; i < count; i++) {
      const first = i * chunkSize;
      const last = i === count - 1 ? size - 1 : first + chunkSize - 1;
      const buf = Buffer.alloc(last - first + 1);
      await fh.read(buf, 0, buf.length, first);
      let attempt = 0;
      for (;;) {
        const res = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(buf.length),
            "Content-Range": `bytes ${first}-${last}/${size}`,
          },
          body: buf,
          signal: AbortSignal.timeout(10 * 60_000),
        });
        if (res.status === 201 || res.status === 206 || res.status === 200) break;
        if (res.status >= 500 && ++attempt < 3) {
          await new Promise((r) => setTimeout(r, 2000 * attempt));
          continue;
        }
        throw new Error(`TikTok a refusé l'envoi du fichier (HTTP ${res.status}, bloc ${i + 1}/${count})`);
      }
    }
  } finally {
    await fh.close();
  }
}

interface StatusData {
  status?: string;
  fail_reason?: string;
  // Orthographe d'origine de l'API TikTok.
  publicaly_available_post_id?: Array<string | number>;
}

async function fetchStatus(accessToken: string, publishId: string, handle: string | null): Promise<PublishResult> {
  const data = await call<StatusData>(accessToken, "/post/publish/status/fetch/", { publish_id: publishId });
  if (data.status === "FAILED") {
    throw new PlatformRejectedError(`TikTok a rejeté la vidéo : ${ERRORS[data.fail_reason ?? ""] ?? data.fail_reason ?? "raison inconnue"}`);
  }
  if (data.status === "SEND_TO_USER_INBOX") {
    return {
      status: "PUBLISHED",
      externalId: publishId,
      url: null,
      note: "Envoyé dans tes brouillons TikTok : ouvre la notification dans l'app pour ajouter le son/la description et publier.",
    };
  }
  if (data.status === "PUBLISH_COMPLETE") {
    const postId = data.publicaly_available_post_id?.[0];
    return {
      status: "PUBLISHED",
      externalId: postId ? String(postId) : publishId,
      url: postId && handle ? `https://www.tiktok.com/@${handle.replace(/^@/, "")}/video/${postId}` : null,
    };
  }
  return { status: "PROCESSING", externalId: publishId, url: null };
}

async function waitForStatus(accessToken: string, publishId: string, handle: string | null): Promise<PublishResult> {
  let last: PublishResult = { status: "PROCESSING", externalId: publishId, url: null };
  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    last = await fetchStatus(accessToken, publishId, handle);
    if (last.status === "PUBLISHED") return last;
  }
  return last;
}

interface CreatorInfo {
  creator_username?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
}

export const tiktok: PlatformAdapter = {
  id: "TIKTOK",
  label: "TikTok",
  requiredEnv: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  configured: () => !!env.tiktok.clientKey && !!env.tiktok.clientSecret,
  privacyOptions: [
    { value: "draft", label: "Brouillon (tu finalises dans l'app)" },
    { value: "public", label: "Public" },
    { value: "followers", label: "Abonnés" },
    { value: "friends", label: "Amis" },
    { value: "private", label: "Moi uniquement" },
  ],
  defaultPrivacy: "draft",

  authUrl(state) {
    const q = new URLSearchParams({
      client_key: env.tiktok.clientKey,
      response_type: "code",
      scope: SCOPES.join(","),
      redirect_uri: redirectUri(env.appUrl, "TIKTOK"),
      state,
    });
    return `${AUTH_URL}?${q}`;
  },

  exchangeCode: (code) =>
    tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(env.appUrl, "TIKTOK") }),

  refresh: (refreshToken) => tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" }),

  async fetchProfile(accessToken): Promise<AccountProfile> {
    const res = await fetch(`${API}/user/info/?fields=open_id,avatar_url,display_name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as TikTokEnvelope<{
      user?: { open_id?: string; avatar_url?: string; display_name?: string };
    }>;
    const user = json.data?.user;
    if (res.status === 401 || json.error?.code === "access_token_invalid") {
      throw new ReauthRequiredError("Accès TikTok refusé ou expiré : reconnecte le compte.");
    }
    if (!res.ok || !user?.open_id) throw new Error(`TikTok : profil illisible (${json.error?.message ?? `HTTP ${res.status}`})`);
    return { externalId: user.open_id, displayName: user.display_name ?? "Compte TikTok", handle: null, avatarUrl: user.avatar_url ?? null };
  },

  async publish(accessToken, input: PublishInput): Promise<PublishResult> {
    // Reprise : la vidéo est déjà partie, on ne fait que revérifier son traitement.
    const savedId = typeof input.state.publishId === "string" ? input.state.publishId : null;
    const savedHandle = typeof input.state.handle === "string" ? input.state.handle : null;
    if (savedId) return { ...(await waitForStatus(accessToken, savedId, savedHandle)), handle: savedHandle ?? undefined };

    const { chunkSize, count } = chunkPlan(input.fileSize);
    const source_info = { source: "FILE_UPLOAD", video_size: input.fileSize, chunk_size: chunkSize, total_chunk_count: count };

    let init: { publish_id?: string; upload_url?: string };
    let handle: string | null = null;
    if (input.privacy === "draft") {
      init = await call(accessToken, "/post/publish/inbox/video/init/", { source_info });
    } else {
      const creator = await call<CreatorInfo>(accessToken, "/post/publish/creator_info/query/", {});
      handle = creator.creator_username ?? null;
      const level = PRIVACY[input.privacy];
      const allowed = creator.privacy_level_options ?? [];
      if (!level || (allowed.length > 0 && !allowed.includes(level))) {
        const labels = Object.entries(PRIVACY).filter(([, v]) => allowed.includes(v)).map(([k]) => k);
        throw new PlatformRejectedError(
          `TikTok n'autorise pas la visibilité « ${input.privacy} » pour ce compte` +
            (labels.length ? ` (autorisées : ${labels.join(", ")}). ` : ". ") +
            "Une application non auditée ne peut publier qu'en « Moi uniquement » : utilise le mode Brouillon en attendant.",
        );
      }
      if (creator.max_video_post_duration_sec && input.durationSec > creator.max_video_post_duration_sec) {
        throw new PlatformRejectedError(`TikTok limite ce compte à des vidéos de ${creator.max_video_post_duration_sec} s.`);
      }
      const caption = [input.title, hashtagLine(input.hashtags)].filter(Boolean).join(" ").slice(0, 2200);
      init = await call(accessToken, "/post/publish/video/init/", {
        post_info: {
          title: caption,
          privacy_level: level,
          disable_comment: creator.comment_disabled ?? false,
          disable_duet: creator.duet_disabled ?? false,
          disable_stitch: creator.stitch_disabled ?? false,
        },
        source_info,
      });
    }
    if (!init.publish_id || !init.upload_url) throw new Error("TikTok n'a pas ouvert de session d'envoi");
    await uploadFile(init.upload_url, input.filePath, input.fileSize);
    await input.saveState({ publishId: init.publish_id, handle });
    return { ...(await waitForStatus(accessToken, init.publish_id, handle)), handle: handle ?? undefined };
  },

  checkStatus: fetchStatus,
};
