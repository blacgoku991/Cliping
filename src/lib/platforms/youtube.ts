import { open, readFile } from "node:fs/promises";
import { env } from "../env";
import {
  hashtagLine,
  PlatformRejectedError,
  ReauthRequiredError,
  redirectUri,
  truncateBytes,
  type AccountProfile,
  type PlatformAdapter,
  type PublishInput,
  type PublishResult,
  type TokenSet,
} from "./types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const THUMB_URL = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";
/** Limite de taille d'une miniature imposée par YouTube. */
const THUMB_MAX_BYTES = 2 * 1024 * 1024;
// youtube.upload pour publier, youtube.readonly pour lire le nom/l'avatar de la chaîne connectée.
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
const CHUNK = 8 * 1024 * 1024; // multiple de 256 Kio, exigé par le protocole d'envoi reprenable

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.google.clientId, client_secret: env.google.clientSecret, ...params }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!res.ok || !data.access_token) {
    if (data.error === "invalid_grant") throw new ReauthRequiredError("Accès YouTube révoqué ou expiré : reconnecte le compte.");
    throw new Error(`Google OAuth : ${data.error_description || data.error || `HTTP ${res.status}`}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    scopes: data.scope ?? "",
  };
}

interface GoogleApiError {
  error?: { message?: string; errors?: Array<{ reason?: string }> };
}

async function apiError(res: Response, what: string): Promise<Error> {
  const data = (await res.json().catch(() => ({}))) as GoogleApiError;
  const reason = data.error?.errors?.[0]?.reason ?? "";
  const message = data.error?.message ?? `HTTP ${res.status}`;
  if (res.status === 401) return new ReauthRequiredError("Accès YouTube refusé : reconnecte le compte.");
  if (["quotaExceeded", "uploadLimitExceeded", "dailyLimitExceeded", "rateLimitExceeded"].includes(reason)) {
    return new PlatformRejectedError(
      reason === "uploadLimitExceeded"
        ? "YouTube : cette chaîne a atteint sa limite d'envois pour aujourd'hui."
        : "YouTube : quota de l'API épuisé pour aujourd'hui (il se réinitialise à minuit, heure du Pacifique).",
    );
  }
  if (res.status === 400 || res.status === 403) return new PlatformRejectedError(`YouTube a refusé ${what} : ${message}`);
  return new Error(`YouTube (${what}) : ${message}`);
}

/** YouTube limite l'ensemble des mots-clés à 500 caractères (ceux qui contiennent une espace comptent leurs guillemets). */
export function tagsWithin(tags: string[], maxChars: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const t of tags) {
    const cost = t.length + (t.includes(" ") ? 2 : 0) + (out.length ? 1 : 0);
    if (used + cost > maxChars) break;
    out.push(t);
    used += cost;
  }
  return out;
}

interface VideoResource {
  id?: string;
  status?: { privacyStatus?: string; uploadStatus?: string };
}

function resultFrom(video: VideoResource, wantedPrivacy: string, format: "short" | "video" = "short"): PublishResult {
  if (!video.id) throw new Error("YouTube n'a pas renvoyé d'identifiant de vidéo");
  const actual = video.status?.privacyStatus;
  return {
    status: "PUBLISHED",
    externalId: video.id,
    url: format === "video" ? `https://www.youtube.com/watch?v=${video.id}` : `https://www.youtube.com/shorts/${video.id}`,
    // Les projets API non audités par Google voient leurs envois forcés en privé.
    note:
      actual && actual !== wantedPrivacy
        ? `YouTube a mis la vidéo en « ${actual} » au lieu de « ${wantedPrivacy} ». Si ton projet Google Cloud n'est pas encore vérifié, passe-la en public depuis YouTube Studio.`
        : undefined,
  };
}

/** Envoie les octets [from, size) par blocs ; renvoie la ressource vidéo une fois l'envoi complet. */
async function sendBytes(sessionUri: string, filePath: string, size: number, from: number): Promise<VideoResource> {
  const fh = await open(filePath, "r");
  try {
    let offset = from;
    while (offset < size) {
      const length = Math.min(CHUNK, size - offset);
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, offset);
      const res = await fetch(sessionUri, {
        method: "PUT",
        headers: {
          "Content-Length": String(length),
          "Content-Type": "video/mp4",
          "Content-Range": `bytes ${offset}-${offset + length - 1}/${size}`,
        },
        body: buf,
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (res.status === 200 || res.status === 201) return (await res.json()) as VideoResource;
      if (res.status !== 308) throw await apiError(res, "l'envoi de la vidéo");
      // 308 : bloc reçu. L'en-tête Range indique jusqu'où le serveur a réellement enregistré.
      const range = /bytes=0-(\d+)/.exec(res.headers.get("range") ?? "");
      offset = range ? Number(range[1]) + 1 : offset + length;
    }
    throw new Error("YouTube n'a pas confirmé la fin de l'envoi");
  } finally {
    await fh.close();
  }
}

/** Demande à une session d'envoi existante où elle en est. */
async function querySession(sessionUri: string, size: number): Promise<{ done: VideoResource } | { next: number } | null> {
  const res = await fetch(sessionUri, {
    method: "PUT",
    headers: { "Content-Length": "0", "Content-Range": `bytes */${size}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 200 || res.status === 201) return { done: (await res.json()) as VideoResource };
  if (res.status === 308) {
    const range = /bytes=0-(\d+)/.exec(res.headers.get("range") ?? "");
    return { next: range ? Number(range[1]) + 1 : 0 };
  }
  return null; // session expirée : on repart de zéro
}

/**
 * Envoie la miniature personnalisée d'une vidéo (thumbnails.set). Ne lève jamais : une miniature refusée
 * ne doit pas faire échouer une vidéo déjà en ligne. Renvoie une note à afficher, ou null si tout va bien.
 */
export async function setThumbnail(accessToken: string, videoId: string, filePath: string): Promise<string | null> {
  try {
    const data = await readFile(filePath);
    if (data.length > THUMB_MAX_BYTES) return "Miniature non envoyée : elle dépasse 2 Mo.";
    const res = await fetch(`${THUMB_URL}?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "image/jpeg", "Content-Length": String(data.length) },
      body: data,
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as GoogleApiError;
    const reason = body.error?.errors?.[0]?.reason ?? "";
    if (res.status === 403) {
      return "YouTube a refusé la miniature personnalisée : la chaîne doit être vérifiée (youtube.com/verify) pour en utiliser une. La vidéo est en ligne avec une miniature automatique ; tu peux mettre la nôtre depuis YouTube Studio.";
    }
    if (res.status === 429 || reason === "uploadRateLimitExceeded") {
      return "YouTube limite pour l'instant l'envoi de miniatures sur cette chaîne : la vidéo est en ligne avec une miniature automatique.";
    }
    return `Miniature non envoyée (${body.error?.message ?? `HTTP ${res.status}`}). La vidéo est en ligne avec une miniature automatique.`;
  } catch (err) {
    return `Miniature non envoyée (${err instanceof Error ? err.message : String(err)}). La vidéo est en ligne avec une miniature automatique.`;
  }
}

/** Vidéo classique terminée : on ajoute la miniature et on en reporte l'issue dans la note. */
async function finishVideo(accessToken: string, result: PublishResult, input: PublishInput): Promise<PublishResult> {
  if (input.format !== "video" || !input.thumbnailPath || input.state.thumbnailSet === true) return result;
  const issue = await setThumbnail(accessToken, result.externalId, input.thumbnailPath);
  if (!issue) await input.saveState({ ...input.state, thumbnailSet: true }).catch(() => {});
  const note = [result.note, issue].filter(Boolean).join(" ");
  return { ...result, note: note || undefined };
}

export const youtube: PlatformAdapter = {
  id: "YOUTUBE",
  label: "YouTube Shorts",
  requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  configured: () => !!env.google.clientId && !!env.google.clientSecret,
  privacyOptions: [
    { value: "public", label: "Public" },
    { value: "unlisted", label: "Non répertorié" },
    { value: "private", label: "Privé" },
  ],
  defaultPrivacy: "public",

  authUrl(state) {
    const q = new URLSearchParams({
      client_id: env.google.clientId,
      redirect_uri: redirectUri(env.appUrl, "YOUTUBE"),
      response_type: "code",
      scope: SCOPES.join(" "),
      // offline + consent : garantit un refresh_token, même si le compte a déjà été autorisé une fois.
      access_type: "offline",
      prompt: "consent select_account",
      include_granted_scopes: "true",
      state,
    });
    return `${AUTH_URL}?${q}`;
  },

  exchangeCode: (code) =>
    tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(env.appUrl, "YOUTUBE") }),

  refresh: (refreshToken) => tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" }),

  async fetchProfile(accessToken): Promise<AccountProfile> {
    const res = await fetch(`${API}/channels?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw await apiError(res, "la lecture de la chaîne");
    const data = (await res.json()) as {
      items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } } }>;
    };
    const ch = data.items?.[0];
    if (!ch) throw new PlatformRejectedError("Ce compte Google n'a pas de chaîne YouTube. Crée-la d'abord sur youtube.com.");
    return {
      externalId: ch.id,
      displayName: ch.snippet?.title ?? "Chaîne YouTube",
      handle: ch.snippet?.customUrl ?? null,
      avatarUrl: ch.snippet?.thumbnails?.default?.url ?? null,
    };
  },

  async publish(accessToken, input: PublishInput): Promise<PublishResult> {
    // Reprise : si une tentative précédente a ouvert une session, on ne republie pas la vidéo.
    const format = input.format ?? "short";
    const saved = typeof input.state.sessionUri === "string" ? input.state.sessionUri : null;
    if (saved) {
      const progress = await querySession(saved, input.fileSize).catch(() => null);
      if (progress && "done" in progress) return finishVideo(accessToken, resultFrom(progress.done, input.privacy, format), input);
      if (progress) return finishVideo(accessToken, resultFrom(await sendBytes(saved, input.filePath, input.fileSize, progress.next), input.privacy, format), input);
    }

    // Vidéo classique : la description arrive complète (chapitres, crédits, hashtags) ; les mots-clés vont dans « tags ».
    const tags = format === "video" ? "" : hashtagLine(input.hashtags);
    const body = {
      snippet: {
        title: truncateBytes(input.title.replace(/[<>]/g, ""), 300).slice(0, 100),
        description: truncateBytes([input.description.replace(/[<>]/g, ""), tags].filter(Boolean).join("\n\n"), 4900),
        tags: tagsWithin(input.hashtags, format === "video" ? 450 : 1e9).slice(0, format === "video" ? 30 : 15),
        categoryId: "20", // Jeux vidéo
      },
      status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: false },
    };
    const init = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(input.fileSize),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!init.ok) throw await apiError(init, "la publication");
    const sessionUri = init.headers.get("location");
    if (!sessionUri) throw new Error("YouTube n'a pas ouvert de session d'envoi");
    await input.saveState({ sessionUri });
    input.state = { sessionUri };
    return finishVideo(accessToken, resultFrom(await sendBytes(sessionUri, input.filePath, input.fileSize, 0), input.privacy, format), input);
  },
};
