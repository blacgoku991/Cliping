import { env } from "../env";
import { appUrlIsPrivate } from "../public-media";
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

/**
 * Instagram Reels via « Instagram API with Instagram Login » (connexion directe d'un compte professionnel,
 * sans Page Facebook).
 *
 * Sources (consultées le 18/11/2026 ; developers.facebook.com n'était pas joignable depuis l'environnement
 * de développement, donc seulement au travers d'extraits de moteur de recherche et de guides tiers) :
 *  - autorisation www.instagram.com/oauth/authorize, code → api.instagram.com/oauth/access_token (POST),
 *    jeton court (1 h) → long (60 jours) par graph.instagram.com/access_token?grant_type=ig_exchange_token,
 *    renouvellement graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token (jeton d'au moins 24 h,
 *    encore valide) : extraits de la doc officielle « Business Login for Instagram » et « Access Token ».
 *  - permissions instagram_business_basic + instagram_business_content_publish : extraits officiels.
 *  - publication : POST /{ig-user-id}/media (media_type=REELS, video_url, caption, share_to_feed), statut
 *    GET /{container}?fields=status_code (IN_PROGRESS, FINISHED, ERROR, EXPIRED, PUBLISHED),
 *    POST /{ig-user-id}/media_publish (creation_id), GET /{ig-user-id}/content_publishing_limit :
 *    extraits officiels + guides tiers concordants.
 *  - envoi direct des octets (upload_type=resumable sur rupload.facebook.com) : documenté seulement pour
 *    « Facebook Login for Business » ; d'où le lien public signé (voir src/lib/public-media.ts).
 *  - codes d'erreur (2207026, 2207042, 9004/2207052, 9007/2207027, 2207001) : guides tiers, pas la doc officielle.
 *  - paramètre force_reauth, suffixe « #_ » du code, champs account_type/profile_picture_url : mémoire, non confirmés.
 * Rien de tout cela n'a été essayé avec un vrai compte.
 */

const AUTH_URL = "https://www.instagram.com/oauth/authorize";
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];
const CAPTION_MAX = 2200;
/** Instagram n'accepte plus que 5 hashtags par publication (depuis décembre 2025, d'après des guides tiers). */
const HASHTAGS_MAX = 5;
/** Attente du traitement d'un conteneur dans une même tentative (Meta conseille un contrôle par minute au plus, ~5 min). */
const POLL_INTERVAL_MS = 20_000;
const POLL_ROUNDS = 30;

const graph = (path: string) => `${env.instagram.graphUrl}/${env.instagram.apiVersion}${path}`;

interface GraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80002]);

const SUBCODES: Record<number, string> = {
  2207042: "Instagram : ce compte a atteint sa limite de publications par l'API sur 24 heures. Réessaie plus tard.",
  2207026: "Instagram a refusé le format de la vidéo (MP4 H.264 attendu). Remonte le clip puis republie.",
  2207052: "Instagram n'a pas pu télécharger la vidéo. Vérifie que APP_URL est une adresse HTTPS publique, joignable depuis Internet.",
  2207050: "Instagram : ce compte est restreint ou inactif. Ouvre l'app Instagram pour régler le problème, puis réessaie.",
};

/** Erreurs où une nouvelle tentative a des chances de passer. */
const RETRYABLE_SUBCODES = new Set([2207001, 2207027, 2207003, 2207020, 2207032, 2207053]);

/** Traduit une erreur de l'API Graph en message compréhensible. */
export function graphError(err: GraphError | undefined, status: number, what: string): Error {
  const code = err?.code ?? 0;
  const sub = err?.error_subcode ?? 0;
  const detail = err?.error_user_msg || err?.message || `HTTP ${status}`;
  if (code === 190 || status === 401) return new ReauthRequiredError("Accès Instagram expiré ou révoqué : reconnecte le compte.");
  const known = SUBCODES[sub];
  if (known) return new PlatformRejectedError(known);
  if (code === 9 && sub !== 2207027) return new PlatformRejectedError(SUBCODES[2207042]!);
  if (code === 10 || (code >= 200 && code < 300)) {
    return new PlatformRejectedError(
      "Instagram : autorisation manquante pour publier. Reconnecte le compte en acceptant toutes les permissions. " +
        "Si ce compte n'est pas le tien (ni testeur de ton application Meta), ton application doit d'abord être validée par Meta (App Review, accès avancé).",
    );
  }
  if (RATE_LIMIT_CODES.has(code)) return new Error("Instagram limite le nombre d'appels pour le moment. Nouvel essai automatique un peu plus tard.");
  if (RETRYABLE_SUBCODES.has(sub) || code === 1 || code === 2 || code === -1 || status >= 500) {
    return new Error(`Instagram (${what}) : erreur temporaire (${detail}).`);
  }
  return new PlatformRejectedError(`Instagram a refusé ${what} : ${detail}`);
}

async function readJson<T>(res: Response): Promise<T & { error?: GraphError }> {
  return (await res.json().catch(() => ({}))) as T & { error?: GraphError };
}

async function graphGet<T>(path: string, accessToken: string, params: Record<string, string>, what: string): Promise<T> {
  const q = new URLSearchParams({ ...params, access_token: accessToken });
  const res = await fetch(`${graph(path)}?${q}`, { signal: AbortSignal.timeout(30_000) });
  const data = await readJson<T>(res);
  if (!res.ok || data.error) throw graphError(data.error, res.status, what);
  return data;
}

async function graphPost<T>(path: string, accessToken: string, params: Record<string, string>, what: string): Promise<T> {
  const res = await fetch(graph(path), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: accessToken }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await readJson<T>(res);
  if (!res.ok || data.error) throw graphError(data.error, res.status, what);
  return data;
}

// ───────────── Connexion et jetons ─────────────

interface ShortTokenResponse {
  access_token?: string;
  user_id?: string | number;
  permissions?: string[] | string;
  data?: Array<{ access_token?: string; user_id?: string | number; permissions?: string[] | string }>;
  error_type?: string;
  error_message?: string;
  code?: number;
}

interface LongTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

function permissionList(p: string[] | string | undefined): string[] {
  if (!p) return [];
  return (Array.isArray(p) ? p : p.split(",")).map((s) => s.trim()).filter(Boolean);
}

/** Jeton longue durée. Instagram n'a pas de refresh_token séparé : le jeton longue durée sert à se renouveler. */
function longLived(data: LongTokenResponse & { error?: GraphError }, status: number, scopes: string): TokenSet {
  if (!data.access_token || data.error) throw graphError(data.error, status, "le renouvellement de l'accès");
  return {
    accessToken: data.access_token,
    refreshToken: data.access_token,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 60 * 86400) * 1000),
    scopes,
  };
}

async function exchangeCode(rawCode: string): Promise<TokenSet> {
  // Instagram ajoute parfois « #_ » à la fin du code dans l'adresse de retour.
  const code = rawCode.replace(/#_$/, "");
  const res = await fetch(`${env.instagram.oauthUrl}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.instagram.appId,
      client_secret: env.instagram.appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(env.appUrl, "INSTAGRAM"),
      code,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = (await res.json().catch(() => ({}))) as ShortTokenResponse & { error?: GraphError };
  const short = raw.data?.[0] ?? raw;
  if (!res.ok || !short.access_token) {
    const msg = raw.error_message ?? raw.error?.message ?? `HTTP ${res.status}`;
    if (/redirect/i.test(msg)) throw new PlatformRejectedError(`Instagram refuse l'adresse de redirection : déclare exactement ${redirectUri(env.appUrl, "INSTAGRAM")} dans ton application Meta.`);
    throw new Error(`Connexion Instagram impossible : ${msg}`);
  }
  const perms = permissionList(short.permissions);
  if (perms.length > 0 && !perms.includes("instagram_business_content_publish")) {
    throw new PlatformRejectedError("Instagram : l'autorisation de publier n'a pas été accordée. Reconnecte le compte en laissant toutes les cases cochées.");
  }
  const q = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: env.instagram.appSecret, access_token: short.access_token });
  const longRes = await fetch(`${env.instagram.graphUrl}/access_token?${q}`, { signal: AbortSignal.timeout(30_000) });
  return longLived(await readJson<LongTokenResponse>(longRes), longRes.status, (perms.length ? perms : SCOPES).join(","));
}

async function refresh(token: string): Promise<TokenSet> {
  const q = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token });
  const res = await fetch(`${env.instagram.graphUrl}/refresh_access_token?${q}`, { signal: AbortSignal.timeout(30_000) });
  return longLived(await readJson<LongTokenResponse>(res), res.status, SCOPES.join(","));
}

interface Me {
  id?: string;
  user_id?: string | number;
  username?: string;
  name?: string;
  profile_picture_url?: string;
  account_type?: string;
}

async function fetchMe(accessToken: string): Promise<Me & { igId: string }> {
  const me = await graphGet<Me>("/me", accessToken, { fields: "user_id,username,name,profile_picture_url,account_type" }, "la lecture du profil");
  const igId = String(me.user_id ?? me.id ?? "");
  if (!igId) throw new Error("Instagram n'a pas renvoyé l'identifiant du compte");
  if (me.account_type && /personal/i.test(me.account_type)) {
    throw new PlatformRejectedError(
      "Ce compte Instagram est un compte personnel : seuls les comptes professionnels (Business ou Créateur) peuvent publier par l'API. " +
        "Dans l'app Instagram : Paramètres → Type de compte et outils → Passer à un compte professionnel (gratuit), puis reconnecte-le.",
    );
  }
  return { ...me, igId };
}

// ───────────── Publication ─────────────

interface ContainerStatus {
  status_code?: "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED" | string;
  status?: string;
}

async function containerStatus(accessToken: string, containerId: string): Promise<ContainerStatus> {
  return graphGet<ContainerStatus>(`/${containerId}`, accessToken, { fields: "status_code,status" }, "le suivi du traitement");
}

/** Erreur de traitement d'un conteneur : le champ « status » contient le sous-code (ex. « Error: ... 2207026 »). */
function containerError(status: ContainerStatus): Error {
  const sub = Number(/\b(22\d{5})\b/.exec(status.status ?? "")?.[1] ?? 0);
  if (sub && SUBCODES[sub]) return new PlatformRejectedError(SUBCODES[sub]);
  if (sub && RETRYABLE_SUBCODES.has(sub)) return new Error(`Instagram n'a pas pu traiter la vidéo (${status.status}). Nouvel essai bientôt.`);
  return new PlatformRejectedError(`Instagram a refusé la vidéo${status.status ? ` : ${status.status}` : ""}. Vérifie qu'elle respecte les règles des Reels (3 s à 15 min, MP4).`);
}

/** Le conteneur peut-il être refait (lien expiré, téléchargement raté) plutôt que d'abandonner ? */
function containerRecoverable(status: ContainerStatus): boolean {
  if (status.status_code === "EXPIRED") return true;
  const sub = Number(/\b(22\d{5})\b/.exec(status.status ?? "")?.[1] ?? 0);
  return sub === 2207052 || RETRYABLE_SUBCODES.has(sub);
}

async function waitForContainer(accessToken: string, containerId: string): Promise<ContainerStatus> {
  let last: ContainerStatus = {};
  for (let i = 0; i < POLL_ROUNDS; i++) {
    last = await containerStatus(accessToken, containerId);
    if (last.status_code !== "IN_PROGRESS" && last.status_code !== undefined) return last;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return last;
}

async function permalink(accessToken: string, mediaId: string): Promise<string | null> {
  const media = await graphGet<{ permalink?: string }>(`/${mediaId}`, accessToken, { fields: "permalink" }, "la lecture du lien").catch(() => null);
  return media?.permalink ?? null;
}

/**
 * Le conteneur a été publié mais la réponse s'est perdue : on retrouve le Reel parmi les dernières publications
 * du compte (même légende, publié il y a moins d'une journée).
 */
async function findPublished(accessToken: string, igId: string, caption: string): Promise<{ id: string; permalink: string | null } | null> {
  const list = await graphGet<{ data?: Array<{ id: string; caption?: string; permalink?: string; timestamp?: string }> }>(
    `/${igId}/media`,
    accessToken,
    { fields: "id,caption,permalink,timestamp", limit: "10" },
    "la lecture des publications",
  ).catch(() => null);
  const dayAgo = Date.now() - 86400_000;
  const hit = list?.data?.find((m) => (m.caption ?? "").trim() === caption.trim() && (!m.timestamp || Date.parse(m.timestamp) > dayAgo));
  return hit ? { id: hit.id, permalink: hit.permalink ?? null } : null;
}

export function buildCaption(input: Pick<PublishInput, "title" | "description" | "hashtags">): string {
  const tags = hashtagLine(input.hashtags.slice(0, HASHTAGS_MAX));
  const body = [input.title.trim(), input.description.trim()].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join("\n\n");
  const room = CAPTION_MAX - (tags ? tags.length + 2 : 0);
  const chars = [...body];
  const text = chars.length > room ? `${chars.slice(0, Math.max(0, room - 1)).join("")}…` : body;
  return [text, tags].filter(Boolean).join("\n\n");
}

async function publishContainer(
  accessToken: string,
  input: PublishInput,
  igId: string,
  username: string | null,
  containerId: string,
  caption: string,
): Promise<PublishResult> {
  // Noté AVANT l'appel : si la réponse se perd, la reprise cherchera le Reel au lieu de republier.
  await input.saveState({ ...input.state, igId, username, containerId, caption, publishing: true });
  const done = await graphPost<{ id?: string }>(`/${igId}/media_publish`, accessToken, { creation_id: containerId }, "la publication");
  if (!done.id) throw new Error("Instagram n'a pas renvoyé l'identifiant du Reel");
  await input.saveState({ igId, username, containerId, caption, mediaId: done.id });
  return { status: "PUBLISHED", externalId: done.id, url: await permalink(accessToken, done.id), handle: username ?? undefined };
}

async function publish(accessToken: string, input: PublishInput): Promise<PublishResult> {
  const st = input.state;
  // 1. Déjà publié lors d'une tentative précédente.
  if (typeof st.mediaId === "string") {
    return { status: "PUBLISHED", externalId: st.mediaId, url: await permalink(accessToken, st.mediaId), handle: typeof st.username === "string" ? st.username : undefined };
  }

  const me = await fetchMe(accessToken);
  const username = me.username ?? null;
  const caption = typeof st.caption === "string" ? st.caption : buildCaption(input);

  // 2. Reprise d'un conteneur existant.
  if (typeof st.containerId === "string") {
    let status = await containerStatus(accessToken, st.containerId);
    if (status.status_code === "PUBLISHED") {
      const found = await findPublished(accessToken, me.igId, caption);
      await input.saveState({ ...st, mediaId: found?.id ?? st.containerId });
      return {
        status: "PUBLISHED",
        externalId: found?.id ?? st.containerId,
        url: found?.permalink ?? null,
        handle: username ?? undefined,
        note: found ? undefined : "Reel publié lors d'une tentative précédente ; lien introuvable, vérifie sur ton compte Instagram.",
      };
    }
    if (st.publishing === true && status.status_code === "FINISHED") {
      // La publication a pu passer sans qu'Instagram ait encore mis à jour le conteneur : on vérifie avant de republier.
      const found = await findPublished(accessToken, me.igId, caption);
      if (found) {
        await input.saveState({ ...st, mediaId: found.id });
        return { status: "PUBLISHED", externalId: found.id, url: found.permalink, handle: username ?? undefined };
      }
    }
    if (status.status_code === "IN_PROGRESS") status = await waitForContainer(accessToken, st.containerId);
    if (status.status_code === "FINISHED") return publishContainer(accessToken, input, me.igId, username, st.containerId, caption);
    if (status.status_code === "IN_PROGRESS") throw new Error("Instagram traite encore la vidéo. Nouvel essai automatique dans un moment.");
    if (!containerRecoverable(status)) throw containerError(status);
    // Conteneur expiré ou téléchargement raté : on en recrée un (rien n'a été publié).
  }

  // 3. Nouvelle publication.
  if (env.instagram.graphUrl === "https://graph.instagram.com" && appUrlIsPrivate()) {
    throw new PlatformRejectedError(
      `Instagram doit venir chercher la vidéo sur ton serveur, mais APP_URL (${env.appUrl}) n'est pas joignable depuis Internet. Mets ton app en ligne en HTTPS (voir le README) puis réessaie.`,
    );
  }
  if (!input.mediaUrl) throw new Error("Lien public de la vidéo indisponible");

  const limit = await graphGet<{ data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }> }>(
    `/${me.igId}/content_publishing_limit`,
    accessToken,
    { fields: "quota_usage,config" },
    "la lecture du quota",
  ).catch((err: unknown) => {
    if (err instanceof ReauthRequiredError) throw err;
    return null; // le quota n'est qu'une vérification préalable : en cas de doute, on laisse Instagram trancher
  });
  const q = limit?.data?.[0];
  if (q?.config?.quota_total && (q.quota_usage ?? 0) >= q.config.quota_total) throw new PlatformRejectedError(SUBCODES[2207042]!);

  const created = await graphPost<{ id?: string }>(
    `/${me.igId}/media`,
    accessToken,
    {
      media_type: "REELS",
      video_url: input.mediaUrl(),
      caption,
      share_to_feed: input.privacy === "reels_only" ? "false" : "true",
    },
    "la création du Reel",
  );
  if (!created.id) throw new Error("Instagram n'a pas renvoyé d'identifiant de conteneur");
  await input.saveState({ igId: me.igId, username, containerId: created.id, caption });

  const status = await waitForContainer(accessToken, created.id);
  if (status.status_code === "FINISHED") return publishContainer(accessToken, { ...input, state: { igId: me.igId, username, containerId: created.id, caption } }, me.igId, username, created.id, caption);
  if (status.status_code === "IN_PROGRESS") throw new Error("Instagram traite encore la vidéo. Nouvel essai automatique dans un moment.");
  throw containerError(status);
}

export const instagram: PlatformAdapter = {
  id: "INSTAGRAM",
  label: "Instagram Reels",
  requiredEnv: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
  configured: () => !!env.instagram.appId && !!env.instagram.appSecret,
  // L'API ne propose pas de visibilité (un Reel est public si le compte l'est) : seul l'affichage dans le fil se règle.
  privacyOptions: [
    { value: "feed", label: "Reels + fil du profil" },
    { value: "reels_only", label: "Onglet Reels uniquement" },
  ],
  defaultPrivacy: "feed",
  // Jeton de 60 jours, renouvelable dès qu'il a 24 h : on le renouvelle bien avant l'échéance.
  refreshBeforeMs: 30 * 86400_000,

  authUrl(state) {
    const q = new URLSearchParams({
      client_id: env.instagram.appId,
      redirect_uri: redirectUri(env.appUrl, "INSTAGRAM"),
      response_type: "code",
      scope: SCOPES.join(","),
      // Permet de choisir un autre compte que celui déjà ouvert dans le navigateur.
      force_reauth: "true",
      state,
    });
    return `${AUTH_URL}?${q}`;
  },

  exchangeCode,
  refresh,

  async fetchProfile(accessToken): Promise<AccountProfile> {
    const me = await fetchMe(accessToken);
    return {
      externalId: me.igId,
      displayName: me.name || me.username || "Compte Instagram",
      handle: me.username ?? null,
      avatarUrl: me.profile_picture_url ?? null,
    };
  },

  publish,
};
