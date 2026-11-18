"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { accessTokenFor, PLATFORMS, ReauthRequiredError } from "@/lib/platforms";
import { requireUser } from "@/lib/session";
import { settingsSchema } from "@/lib/settings";
import type { FormState } from "./auth";

export async function saveSettings(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const n = (k: string) => Number(String(form.get(k) ?? "").replace(",", "."));
  const parsed = settingsSchema.safeParse({
    language: String(form.get("language") ?? "fr"),
    sensitivity: Math.round(n("sensitivity")),
    clipMinSec: n("clipMinSec"),
    clipMaxSec: n("clipMaxSec"),
    preRollSec: n("preRollSec"),
    postRollSec: n("postRollSec"),
    maxClipsPerHour: Math.round(n("maxClipsPerHour")),
    template: String(form.get("template") ?? "BLUR"),
    zoom: n("zoom"),
    captions: form.get("captions") === "on",
    captionFont: String(form.get("captionFont") ?? "Poppins ExtraBold"),
    captionColor: String(form.get("captionColor") ?? "#FFE600"),
    showHook: form.get("showHook") === "on",
    showCredit: form.get("showCredit") === "on",
    defaultHashtags: String(form.get("defaultHashtags") ?? "")
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#+/, "").toLowerCase().replace(/[^a-z0-9_àâäéèêëîïôöùûüç]/g, ""))
      .filter((t) => t.length >= 2)
      .slice(0, 15),
    retentionDays: Math.round(n("retentionDays")),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `Réglage invalide (${issue?.path.join(".")}) : ${issue?.message}` };
  }
  if (parsed.data.clipMaxSec < parsed.data.clipMinSec + 2) return { error: "La durée max doit dépasser la durée min d'au moins 2 secondes." };
  await db.user.update({ where: { id: user.id }, data: { settings: parsed.data as Prisma.InputJsonValue } });
  revalidatePath("/app/settings");
  return { ok: "Réglages enregistrés. Ils s'appliquent aux prochains lives et imports." };
}

export async function disconnectAccount(form: FormData): Promise<void> {
  const user = await requireUser();
  await db.socialAccount.deleteMany({ where: { id: String(form.get("id") ?? ""), userId: user.id } });
  revalidatePath("/app/accounts");
}

/** Réglages de publication propres à un compte : visibilité par défaut et plafond quotidien. */
export async function updateAccountSettings(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const account = await db.socialAccount.findFirst({ where: { id: String(form.get("id") ?? ""), userId: user.id } });
  if (!account) return { error: "Compte introuvable." };
  const adapter = PLATFORMS[account.platform];
  const privacy = String(form.get("defaultPrivacy") ?? "");
  if (privacy && !adapter.privacyOptions.some((o) => o.value === privacy)) return { error: "Visibilité inconnue pour cette plateforme." };
  const capRaw = String(form.get("dailyCap") ?? "").trim();
  const cap = capRaw === "" ? null : Math.round(Number(capRaw));
  if (cap !== null && (!Number.isFinite(cap) || cap < 1 || cap > 50)) return { error: "Plafond : entre 1 et 50 publications par 24 h (ou vide pour aucun plafond)." };
  await db.socialAccount.update({ where: { id: account.id }, data: { defaultPrivacy: privacy || null, dailyCap: cap } });
  revalidatePath("/app/accounts");
  return { ok: "Réglages du compte enregistrés." };
}

/** Vérifie que le jeton du compte fonctionne encore (rafraîchi si besoin) en relisant son profil. */
export async function testAccount(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const account = await db.socialAccount.findFirst({ where: { id: String(form.get("id") ?? ""), userId: user.id } });
  if (!account) return { error: "Compte introuvable." };
  const adapter = PLATFORMS[account.platform];
  if (!adapter.configured()) return { error: `${adapter.label} n'est pas configuré sur ce serveur (${adapter.requiredEnv.join(", ")}).` };
  try {
    const token = await accessTokenFor(account);
    const profile = await adapter.fetchProfile(token);
    await db.socialAccount.update({
      where: { id: account.id },
      data: {
        valid: true,
        checkedAt: new Date(),
        displayName: profile.displayName || account.displayName,
        avatarUrl: profile.avatarUrl ?? account.avatarUrl,
        handle: profile.handle ?? account.handle,
      },
    });
    revalidatePath("/app/accounts");
    return { ok: `Connexion OK : ${adapter.label} répond pour « ${profile.displayName || account.displayName} ».` };
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      await db.socialAccount.update({ where: { id: account.id }, data: { valid: false } }).catch(() => {});
      revalidatePath("/app/accounts");
      return { error: err.message };
    }
    const network = err instanceof TypeError || (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"));
    return { error: network ? `${adapter.label} est injoignable depuis le serveur (réseau ou délai dépassé).` : `${adapter.label} : ${err instanceof Error ? err.message : String(err)}` };
  }
}
