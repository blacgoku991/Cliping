import type { SocialAccount, SocialPlatform } from "@prisma/client";
import { decrypt, encrypt } from "../crypto";
import { db } from "../db";
import { instagram } from "./instagram";
import { tiktok } from "./tiktok";
import { ReauthRequiredError, type PlatformAdapter, type TokenSet } from "./types";
import { youtube } from "./youtube";

export const PLATFORMS: Record<SocialPlatform, PlatformAdapter> = { YOUTUBE: youtube, TIKTOK: tiktok, INSTAGRAM: instagram };

export function platformFromSlug(slug: string): PlatformAdapter | null {
  const key = slug.toUpperCase();
  return key === "YOUTUBE" || key === "TIKTOK" || key === "INSTAGRAM" ? PLATFORMS[key] : null;
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

/**
 * Jeton d'accès utilisable tout de suite : rafraîchi s'il expire bientôt (2 minutes par défaut ;
 * bien plus tôt pour Instagram, dont le jeton de 60 jours se renouvelle avec lui-même).
 */
export async function accessTokenFor(account: SocialAccount): Promise<string> {
  const adapter = PLATFORMS[account.platform];
  const left = account.expiresAt ? account.expiresAt.getTime() - Date.now() : Infinity;
  if (left > (adapter.refreshBeforeMs ?? 120_000)) return decrypt(account.accessTokenEnc);
  const stillValid = left > 120_000;
  if (!account.refreshTokenEnc) {
    if (stillValid) return decrypt(account.accessTokenEnc);
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
      throw err;
    }
    // Renouvellement anticipé raté (réseau…) : le jeton actuel marche encore, on le garde.
    if (stillValid) return decrypt(account.accessTokenEnc);
    throw err;
  }
}

/**
 * Renouvelle à l'avance les jetons des plateformes qui l'exigent (Instagram : un jeton non renouvelé
 * pendant 60 jours est perdu), même pour les comptes qui ne publient pas. Appelé périodiquement par le worker.
 */
export async function renewExpiringTokens(): Promise<number> {
  let renewed = 0;
  for (const adapter of Object.values(PLATFORMS)) {
    if (!adapter.refreshBeforeMs || !adapter.configured()) continue;
    const due = await db.socialAccount.findMany({
      where: { platform: adapter.id, valid: true, expiresAt: { lt: new Date(Date.now() + adapter.refreshBeforeMs) } },
    });
    for (const account of due) {
      const before = account.expiresAt?.getTime() ?? 0;
      const after = await accessTokenFor(account)
        .then(() => db.socialAccount.findUnique({ where: { id: account.id }, select: { expiresAt: true } }))
        .catch(() => null);
      if ((after?.expiresAt?.getTime() ?? 0) > before) renewed++;
    }
  }
  return renewed;
}

export { ReauthRequiredError, PlatformRejectedError } from "./types";
export type { PlatformAdapter } from "./types";
