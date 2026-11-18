"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
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
