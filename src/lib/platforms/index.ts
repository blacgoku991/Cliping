import type { SocialAccount, SocialPlatform } from "@prisma/client";
import { decrypt, encrypt } from "../crypto";
import { db } from "../db";
import { tiktok } from "./tiktok";
import { ReauthRequiredError, type PlatformAdapter, type TokenSet } from "./types";
import { youtube } from "./youtube";

export const PLATFORMS: Record<SocialPlatform, PlatformAdapter> = { YOUTUBE: youtube, TIKTOK: tiktok };

export function platformFromSlug(slug: string): PlatformAdapter | null {
  const key = slug.toUpperCase();
  return key === "YOUTUBE" || key === "TIKTOK" ? PLATFORMS[key] : null;
}

/** Enregistre (ou met à jour) un compte social après le retour OAuth. */
export async function saveAccount(userId: string, adapter: PlatformAdapter, tokens: TokenSet): Promise<SocialAccount> {
  const profile = await adapter.fetchProfile(tokens.accessToken);
  const where = { userId_platform_externalId: { userId, platform: adapter.id, externalId: profile.externalId } };
  const existing = await db.socialAccount.findUnique({ where });
  const data = {
    displayName: profile.displayName,
    handle: profile.handle ?? existing?.handle ?? null,
    avatarUrl: profile.avatarUrl,
    accessTokenEnc: encrypt(tokens.accessToken),
    // Google ne renvoie le refresh_token qu'au premier consentement : on garde l'ancien sinon.
    refreshTokenEnc: tokens.refreshToken ? encrypt(tokens.refreshToken) : (existing?.refreshTokenEnc ?? null),
    expiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
    valid: true,
  };
  return db.socialAccount.upsert({
    where,
    update: data,
    create: { userId, platform: adapter.id, externalId: profile.externalId, ...data },
  });
}

/** Jeton d'accès utilisable tout de suite : rafraîchi s'il expire dans moins de 2 minutes. */
export async function accessTokenFor(account: SocialAccount): Promise<string> {
  const adapter = PLATFORMS[account.platform];
  const fresh = !account.expiresAt || account.expiresAt.getTime() - Date.now() > 120_000;
  if (fresh) return decrypt(account.accessTokenEnc);
  if (!account.refreshTokenEnc) {
    await db.socialAccount.update({ where: { id: account.id }, data: { valid: false } });
    throw new ReauthRequiredError(`Session ${adapter.label} expirée : reconnecte le compte « ${account.displayName} ».`);
  }
  try {
    const tokens = await adapter.refresh(decrypt(account.refreshTokenEnc));
    await db.socialAccount.update({
      where: { id: account.id },
      data: {
        accessTokenEnc: encrypt(tokens.accessToken),
        ...(tokens.refreshToken ? { refreshTokenEnc: encrypt(tokens.refreshToken) } : {}),
        expiresAt: tokens.expiresAt,
        valid: true,
      },
    });
    return tokens.accessToken;
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      await db.socialAccount.update({ where: { id: account.id }, data: { valid: false } });
    }
    throw err;
  }
}

export { ReauthRequiredError, PlatformRejectedError } from "./types";
export type { PlatformAdapter } from "./types";
