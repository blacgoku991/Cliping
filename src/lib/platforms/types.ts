import type { SocialPlatform } from "@prisma/client";

export interface TokenSet {
  accessToken: string;
  /** Absent si la plateforme n'en a pas renvoyé de nouveau */
  refreshToken?: string;
  expiresAt: Date | null;
  scopes: string;
}

export interface AccountProfile {
  externalId: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
}

export interface PublishInput {
  filePath: string;
  fileSize: number;
  title: string;
  description: string;
  hashtags: string[];
  privacy: string;
  durationSec: number;
  /** État sauvegardé d'une tentative précédente (reprise d'envoi) */
  state: Record<string, unknown>;
  /** Persiste l'état d'envoi pour qu'une nouvelle tentative reprenne au lieu de republier */
  saveState: (state: Record<string, unknown>) => Promise<void>;
}

export interface PublishResult {
  /** PROCESSING : la plateforme traite encore la vidéo, il faudra revérifier */
  status: "PUBLISHED" | "PROCESSING";
  externalId: string;
  url: string | null;
  note?: string;
  /** Identifiant public mis à jour sur le compte (ex. @pseudo TikTok découvert à la publication) */
  handle?: string;
}

export interface PrivacyOption {
  value: string;
  label: string;
}

export interface PlatformAdapter {
  id: SocialPlatform;
  label: string;
  configured(): boolean;
  /** Variables d'environnement à renseigner pour activer la plateforme */
  requiredEnv: string[];
  privacyOptions: PrivacyOption[];
  defaultPrivacy: string;
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  fetchProfile(accessToken: string): Promise<AccountProfile>;
  publish(accessToken: string, input: PublishInput): Promise<PublishResult>;
  /** Pour les publications restées en PROCESSING */
  checkStatus?(accessToken: string, externalId: string, handle: string | null): Promise<PublishResult>;
}

/** Le jeton de rafraîchissement n'est plus valable : l'utilisateur doit reconnecter le compte. */
export class ReauthRequiredError extends Error {}

/** Erreur définitive côté plateforme (réglage refusé, quota du jour atteint…) : inutile de réessayer tout de suite. */
export class PlatformRejectedError extends Error {}

export function redirectUri(appUrl: string, platform: SocialPlatform): string {
  return `${appUrl}/api/oauth/${platform.toLowerCase()}/callback`;
}

/** Tronque sans couper un caractère multi-octets, en respectant une limite en octets UTF-8. */
export function truncateBytes(text: string, maxBytes: number): string {
  const enc = new TextEncoder();
  if (enc.encode(text).length <= maxBytes) return text;
  let out = "";
  let size = 0;
  for (const ch of text) {
    const n = enc.encode(ch).length;
    if (size + n > maxBytes) break;
    out += ch;
    size += n;
  }
  return out;
}

export function hashtagLine(tags: string[]): string {
  return tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ");
}
