"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { AUTO_FOLLOW_MAX, channelUrl, DISCOVERY_LANGUAGES, streamKey } from "@/lib/discovery";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/jobs";
import { requireUser } from "@/lib/session";
import type { FormState } from "./auth";

const MAX_STREAMERS = Number(process.env.MAX_STREAMERS_PER_USER ?? 50);

/** Réglages de la section « En live maintenant » et du mode automatique. */
export async function saveDiscovery(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const game = String(form.get("game") ?? "").trim().slice(0, 100);
  if (game.length < 2) return { error: "Indique le jeu à surveiller (ex. Grand Theft Auto VI)." };
  const language = String(form.get("language") ?? "");
  if (!DISCOVERY_LANGUAGES.some((l) => l.value === language)) return { error: "Langue inconnue." };
  const autoFollow = form.get("autoFollow") === "on";
  const autoCount = Math.round(Number(form.get("autoCount") ?? 3));
  const max = Math.min(AUTO_FOLLOW_MAX, env.worker.maxRecordings);
  if (!Number.isFinite(autoCount) || autoCount < 1 || autoCount > max) {
    return { error: `Nombre de lives à suivre : entre 1 et ${max} (le serveur capte au plus ${env.worker.maxRecordings} lives à la fois, MAX_CONCURRENT_RECORDINGS).` };
  }
  const before = await db.discovery.findUnique({ where: { userId: user.id } });
  const gameChanged = !!before && (before.game !== game || before.language !== language);
  await db.discovery.upsert({
    where: { userId: user.id },
    update: { game, language, autoFollow, autoCount, ...(gameChanged ? { results: [], fetchedAt: null, error: null } : {}) },
    create: { userId: user.id, game, language, autoFollow, autoCount },
  });
  if (gameChanged) {
    // Autre jeu : les chaînes automatiques suivent le nouveau filtre.
    await db.streamer.updateMany({ where: { userId: user.id, autoFollowed: true }, data: { gameFilter: game } });
  }
  await enqueue("discovery.refresh", { userId: user.id }, { maxAttempts: 1 });
  revalidatePath("/app/streamers");
  return {
    ok: autoFollow
      ? `Mode automatique actif : les ${autoCount} plus gros lives seront suivis (mise à jour toutes les 2 minutes environ).`
      : "Réglages enregistrés. Le classement s'actualise dans quelques secondes.",
  };
}

export async function refreshDiscoveryNow(): Promise<void> {
  const user = await requireUser();
  const exists = await db.discovery.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!exists) await db.discovery.create({ data: { userId: user.id } });
  await enqueue("discovery.refresh", { userId: user.id }, { maxAttempts: 1 });
  revalidatePath("/app/streamers");
}

/** « Suivre » en un clic une chaîne vue dans le classement. */
export async function followDiscovered(form: FormData): Promise<void> {
  const user = await requireUser();
  const platform = String(form.get("platform") ?? "");
  const login = String(form.get("login") ?? "").toLowerCase();
  const displayName = String(form.get("displayName") ?? login).slice(0, 60) || login;
  if ((platform !== "TWITCH" && platform !== "KICK") || !/^[a-z0-9_-]{2,40}$/.test(login)) return;
  const d = await db.discovery.findUnique({ where: { userId: user.id } });
  const existing = await db.streamer.findUnique({ where: { userId_platform_login: { userId: user.id, platform, login } } });
  if (existing) {
    await db.streamer.update({ where: { id: existing.id }, data: { autoFollowed: false, autoViewers: null, enabled: true } });
  } else if ((await db.streamer.count({ where: { userId: user.id } })) < MAX_STREAMERS) {
    await db.streamer.create({
      data: { userId: user.id, platform, login, url: channelUrl({ platform, login }), displayName, gameFilter: d?.game ?? "Grand Theft Auto VI" },
    });
  }
  // Suivie volontairement : si elle avait été exclue du mode automatique, on lève l'exclusion.
  if (d?.excluded.includes(streamKey({ platform, login }))) {
    await db.discovery.update({ where: { id: d.id }, data: { excluded: d.excluded.filter((k) => k !== streamKey({ platform, login })) } });
  }
  revalidatePath("/app/streamers");
}

/** Remet à zéro la liste des chaînes que le mode automatique ne doit plus reprendre. */
export async function clearExcluded(): Promise<void> {
  const user = await requireUser();
  await db.discovery.updateMany({ where: { userId: user.id }, data: { excluded: [] } });
  revalidatePath("/app/streamers");
}
