"use server";

import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { timeZoneKey, TZ_COOKIE } from "@/lib/stats/hints";
import { isValidTimeZone } from "@/lib/stats/math";

/**
 * Mémorise le fuseau horaire du navigateur : le serveur ne le connaît pas, et les créneaux horaires
 * (« tes clips postés entre 16 h et 20 h… ») n'ont de sens que dans l'heure locale de l'utilisateur.
 * Cookie pour la page, et copie en base pour que le worker et performanceHints() puissent l'utiliser.
 */
export async function rememberTimeZone(timeZone: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!isValidTimeZone(timeZone)) return { ok: false };
  (await cookies()).set(TZ_COOKIE, timeZone, { sameSite: "lax", path: "/", maxAge: 365 * 86400 });
  const key = timeZoneKey(user.id);
  const value = timeZone as Prisma.InputJsonValue;
  await db.keyValue.upsert({ where: { key }, update: { value }, create: { key, value } });
  return { ok: true };
}
