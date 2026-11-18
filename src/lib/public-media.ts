import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Liens publics temporaires vers la vidéo d'une publication.
 *
 * Instagram (connexion « Instagram Login ») ne reçoit pas les octets de la vidéo : il vient la chercher
 * lui-même à une adresse publique. Le lien est signé (HMAC-SHA256, clé dérivée de ENCRYPTION_KEY),
 * limité dans le temps, et ne désigne qu'une publication : la route ne sert que la vidéo montée de son clip,
 * et seulement tant que l'envoi est en cours.
 */

const PREFIX = "/api/public-media/";
export const PUBLIC_MEDIA_TTL_SEC = 2 * 3600;

function signingKey(): Buffer {
  const secret = env.encryptionKey;
  if (secret.length < 32) throw new Error("ENCRYPTION_KEY manquante ou trop courte (32 caractères minimum).");
  // Clé distincte de celle du chiffrement des jetons OAuth.
  return createHash("sha256").update(`cliping:public-media:v1:${secret}`).digest();
}

function mac(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function signMediaToken(publicationId: string, ttlSec = PUBLIC_MEDIA_TTL_SEC, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ p: publicationId, e: Math.floor(now / 1000) + ttlSec })).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

export type MediaTokenCheck = { ok: true; publicationId: string } | { ok: false; reason: "invalid" | "expired" };

export function verifyMediaToken(token: string, now = Date.now()): MediaTokenCheck {
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined || payload.length > 200) return { ok: false, reason: "invalid" };
  const expected = Buffer.from(mac(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };
  let data: { p?: unknown; e?: unknown };
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { p?: unknown; e?: unknown };
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (typeof data.p !== "string" || !/^[a-z0-9_-]{6,64}$/i.test(data.p) || typeof data.e !== "number") return { ok: false, reason: "invalid" };
  if (data.e * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, publicationId: data.p };
}

/** Adresse complète à transmettre à la plateforme. */
export function signedMediaUrl(publicationId: string, ttlSec = PUBLIC_MEDIA_TTL_SEC): string {
  return `${env.appUrl}${PREFIX}${signMediaToken(publicationId, ttlSec)}/clip.mp4`;
}

/** Vrai si APP_URL désigne une machine que les serveurs d'une plateforme ne peuvent pas joindre. */
export function appUrlIsPrivate(appUrl = env.appUrl): boolean {
  let host: string;
  try {
    host = new URL(appUrl).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) return true;
  if (host.startsWith("[")) return host === "[::1]" || /^\[f[cd]/.test(host) || host.startsWith("[fe80");
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}
