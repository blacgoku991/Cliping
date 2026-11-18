/**
 * Envoi d'un message sur un canal. Partagé par le site (bouton « Tester ») et le worker.
 * Pas de « server-only » ici : le worker (tsx) importe aussi ce module.
 *
 * Canaux :
 *  - WEBPUSH : notification native de l'app installée (iPhone 16.4+ depuis l'écran d'accueil, Android, ordinateur).
 *    Protocole standard (VAPID + chiffrement aes128gcm via la bibliothèque web-push), gratuit, sans service tiers.
 *  - NTFY : appli ntfy (iPhone/Android), gratuite ; le serveur publie sur un sujet de ntfy.sh (ou un serveur ntfy perso).
 *  - DISCORD : message dans un salon via un webhook.
 */
import webpush from "web-push";
import { decrypt, encrypt } from "../crypto";
import { db } from "../db";
import { env } from "../env";
import { isAllowedPushEndpoint, parseDiscordWebhook, parseNtfyTarget } from "./targets";

export type ChannelKind = "WEBPUSH" | "NTFY" | "DISCORD";

export interface WebPushConfig {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export interface NtfyConfig {
  server: string;
  topic: string;
  token?: string;
}
export interface DiscordConfig {
  url: string;
}

export interface Message {
  title: string;
  body: string;
  /** Chemin dans l'app (/app/review…) ; transformé en lien complet */
  url: string;
  tag: string;
}

/** Résultat d'un envoi : `gone` = abonnement expiré ou supprimé côté service, à retirer. */
export type SendResult = { ok: true } | { ok: false; error: string; gone?: boolean };

const TIMEOUT_MS = 15_000;

// ───────────── Clés VAPID ─────────────

interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

let cachedVapid: Vapid | null = null;

function vapidSubject(): string {
  const configured = process.env.VAPID_SUBJECT?.trim();
  if (configured) return configured;
  // Apple refuse un sujet « https://localhost » (BadJwtToken) : on n'utilise l'adresse de l'app que si elle est publique.
  const app = env.appUrl;
  if (app.startsWith("https://") && !/^https:\/\/(localhost|127\.|\[::1\])/.test(app)) return app;
  return "mailto:notifications@cliping.invalid";
}

/**
 * Clés VAPID : VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY si l'administrateur les fournit, sinon une paire générée
 * une fois et gardée en base (clé privée chiffrée). Elles doivent rester stables : en changer invalide
 * tous les abonnements existants.
 */
export async function getVapid(): Promise<Vapid> {
  if (cachedVapid) return cachedVapid;
  const subject = vapidSubject();
  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (pub && priv) return (cachedVapid = { publicKey: pub, privateKey: priv, subject });

  const KEY = "webpush.vapid";
  const read = async () => {
    const row = await db.keyValue.findUnique({ where: { key: KEY } });
    const v = row?.value as { publicKey?: string; privateKeyEnc?: string } | undefined;
    return v?.publicKey && v.privateKeyEnc ? { publicKey: v.publicKey, privateKey: decrypt(v.privateKeyEnc), subject } : null;
  };
  let found = await read();
  if (!found) {
    const keys = webpush.generateVAPIDKeys();
    // create (et non upsert) : si le site et le worker génèrent en même temps, le second échoue et relit la paire du premier.
    await db.keyValue.create({ data: { key: KEY, value: { publicKey: keys.publicKey, privateKeyEnc: encrypt(keys.privateKey) } } }).catch(() => {});
    found = await read();
  }
  if (!found) throw new Error("Impossible de préparer les clés de notification (VAPID).");
  return (cachedVapid = found);
}

// ───────────── Envoi ─────────────

function absolute(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${env.appUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function post(url: string, init: { headers: Record<string, string>; body: string | Buffer }): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: init.headers,
    body: typeof init.body === "string" ? init.body : new Uint8Array(init.body),
    // Pas de redirection suivie : une redirection pourrait mener hors des hôtes autorisés.
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function networkError(err: unknown, label: string): SendResult {
  const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
  return { ok: false, error: timeout ? `${label} : délai dépassé.` : `${label} injoignable (réseau).` };
}

export async function sendWebPush(cfg: WebPushConfig, msg: Message): Promise<SendResult> {
  if (!isAllowedPushEndpoint(cfg.endpoint)) return { ok: false, error: "Adresse d'abonnement non autorisée.", gone: true };
  const vapid = await getVapid();
  // Charge utile < 4 Ko (limite Apple) : on tronque le texte.
  const payload = JSON.stringify({ title: msg.title.slice(0, 120), body: msg.body.slice(0, 600), url: msg.url, tag: msg.tag });
  let details: { endpoint: string; headers: Record<string, string | number>; body: Buffer | string | null };
  try {
    details = webpush.generateRequestDetails({ endpoint: cfg.endpoint, keys: cfg.keys }, payload, {
      vapidDetails: vapid,
      TTL: 24 * 3600,
      urgency: "high",
      topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined,
    }) as typeof details;
  } catch (err) {
    return { ok: false, error: `Abonnement illisible : ${err instanceof Error ? err.message : err}`, gone: true };
  }
  const headers = Object.fromEntries(Object.entries(details.headers).map(([k, v]) => [k, String(v)]));
  try {
    const res = await post(details.endpoint, { headers, body: details.body ?? "" });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    const text = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 404 || res.status === 410) return { ok: false, error: "Abonnement expiré (app désinstallée ou notifications coupées).", gone: true };
    if (res.status === 403) return { ok: false, error: `Le service de push refuse l'authentification (${text || "403"}).` };
    if (res.status === 429) return { ok: false, error: "Trop d'envois : le service de push demande de ralentir." };
    return { ok: false, error: `Service de push : erreur ${res.status} ${text}`.trim() };
  } catch (err) {
    return networkError(err, "Service de push");
  }
}

export async function sendNtfy(cfg: NtfyConfig, msg: Message): Promise<SendResult> {
  const target = parseNtfyTarget(`${cfg.server}/${cfg.topic}`);
  if ("error" in target) return { ok: false, error: target.error };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  // Publication en JSON sur la racine du serveur : les accents passent sans souci (les en-têtes HTTP les gèrent mal).
  const body = JSON.stringify({
    topic: target.topic,
    title: msg.title.slice(0, 200),
    message: msg.body.slice(0, 2000) || msg.title,
    click: absolute(msg.url),
    tags: [msg.tag === "publishFailed" || msg.tag === "accountInvalid" ? "warning" : "clapper"],
    priority: msg.tag === "publishFailed" || msg.tag === "accountInvalid" ? 4 : 3,
  });
  try {
    const res = await post(`${target.server}/`, { headers, body });
    if (res.ok) return { ok: true };
    const text = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 401 || res.status === 403) return { ok: false, error: "ntfy refuse l'accès à ce sujet (sujet protégé : ajoute un jeton d'accès)." };
    if (res.status === 429) return { ok: false, error: "ntfy limite le nombre d'envois : réessaie plus tard." };
    return { ok: false, error: `ntfy : erreur ${res.status} ${text}`.trim() };
  } catch (err) {
    return networkError(err, "ntfy");
  }
}

export async function sendDiscord(cfg: DiscordConfig, msg: Message): Promise<SendResult> {
  const target = parseDiscordWebhook(cfg.url);
  if ("error" in target) return { ok: false, error: target.error };
  const body = JSON.stringify({
    username: "Cliping",
    // Aucune mention (@everyone…) ne doit partir, même si un titre de clip en contient.
    allowed_mentions: { parse: [] },
    embeds: [{ title: msg.title.slice(0, 250), description: `${msg.body.slice(0, 3500)}\n\n[Ouvrir Cliping](${absolute(msg.url)})`, color: 0xff4d8d }],
  });
  try {
    const res = await post(target.url, { headers: { "Content-Type": "application/json" }, body });
    if (res.ok) return { ok: true };
    if (res.status === 404 || res.status === 401) return { ok: false, error: "Webhook Discord supprimé ou invalide.", gone: true };
    if (res.status === 429) return { ok: false, error: "Discord limite le nombre d'envois : réessaie plus tard." };
    return { ok: false, error: `Discord : erreur ${res.status}` };
  } catch (err) {
    return networkError(err, "Discord");
  }
}

export function decodeChannel(kind: string, configEnc: string): WebPushConfig | NtfyConfig | DiscordConfig {
  return JSON.parse(decrypt(configEnc)) as WebPushConfig | NtfyConfig | DiscordConfig;
}

/** Envoie sur un canal enregistré et met à jour son état (dernier succès, erreur, suppression s'il a expiré). */
export async function sendToChannel(channel: { id: string; kind: string; configEnc: string }, msg: Message): Promise<SendResult> {
  let result: SendResult;
  try {
    const cfg = decodeChannel(channel.kind, channel.configEnc);
    if (channel.kind === "WEBPUSH") result = await sendWebPush(cfg as WebPushConfig, msg);
    else if (channel.kind === "NTFY") result = await sendNtfy(cfg as NtfyConfig, msg);
    else if (channel.kind === "DISCORD") result = await sendDiscord(cfg as DiscordConfig, msg);
    else result = { ok: false, error: `Canal inconnu : ${channel.kind}` };
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (result.ok) {
    await db.notifyChannel.update({ where: { id: channel.id }, data: { lastOkAt: new Date(), lastError: null, failures: 0 } }).catch(() => {});
  } else if (result.gone && channel.kind === "WEBPUSH") {
    // Abonnement mort (app supprimée de l'écran d'accueil, notifications coupées) : on le retire.
    await db.notifyChannel.delete({ where: { id: channel.id } }).catch(() => {});
  } else {
    await db.notifyChannel
      .update({ where: { id: channel.id }, data: { lastError: result.error.slice(0, 500), failures: { increment: 1 } } })
      .catch(() => {});
  }
  return result;
}
