/**
 * Ajoute à un compte Cliping une liste de chaînes à suivre (avec leur zone de webcam) et les réglages conseillés.
 * Sert à préparer un serveur neuf en une commande, sans tout ressaisir dans l'interface.
 *
 *   docker compose exec worker node_modules/.bin/tsx scripts/import-chaines.ts ton@email.fr
 *   npx tsx --env-file=.env scripts/import-chaines.ts ton@email.fr [fichier.json]   (hors Docker)
 *
 * Par défaut : scripts/chaines-gta6-fr.json. Relancer ne crée pas de doublon : une chaîne déjà suivie est mise à jour.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Prisma, SourcePlatform } from "@prisma/client";
import { db } from "@/lib/db";

interface Chaine {
  platform: SourcePlatform;
  login: string;
  displayName: string;
  gameFilter?: string;
  quality?: string;
  facecam?: { x: number; y: number; w: number; h: number } | null;
}

/** Adresse d'une chaîne à partir de son identifiant ; les sources « OTHER » (liens importés) ne sont pas des chaînes à suivre. */
const URLS: Partial<Record<SourcePlatform, (login: string) => string>> = {
  TWITCH: (l) => `https://www.twitch.tv/${l}`,
  KICK: (l) => `https://kick.com/${l}`,
  YOUTUBE: (l) => `https://www.youtube.com/${l.startsWith("@") ? l : "@" + l}/live`,
  TIKTOK: (l) => `https://www.tiktok.com/@${l.replace(/^@/, "")}/live`,
};

async function main(): Promise<void> {
  const [email, file = path.join(import.meta.dirname, "chaines-gta6-fr.json")] = process.argv.slice(2);
  if (!email) {
    console.error("Indique l'adresse email de ton compte Cliping : import-chaines.ts ton@email.fr");
    process.exit(1);
  }
  const user = await db.user.findFirst({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    console.error(`Aucun compte avec l'adresse ${email} : crée d'abord ton compte sur le site, puis relance.`);
    process.exit(1);
  }
  const chaines = JSON.parse(readFileSync(file, "utf8")) as Chaine[];
  for (const c of chaines) {
    const url = URLS[c.platform];
    if (!url) {
      console.warn(`  ignorée (plateforme inconnue) : ${c.login}`);
      continue;
    }
    const data = {
      url: url(c.login),
      displayName: c.displayName,
      gameFilter: c.gameFilter ?? "",
      quality: c.quality ?? "best",
      enabled: true,
      ...(c.facecam ? { facecam: c.facecam as Prisma.InputJsonValue } : {}),
    };
    await db.streamer.upsert({
      where: { userId_platform_login: { userId: user.id, platform: c.platform, login: c.login } },
      create: { userId: user.id, platform: c.platform, login: c.login, ...data },
      update: data,
    });
    console.log(`  ✔ ${c.displayName}${c.facecam ? " (webcam placée)" : ""}${c.gameFilter ? ` — seulement ${c.gameFilter}` : ""}`);
  }
  // Réglages conseillés : format TikTok webcam en haut, seuls les clips à fort potentiel sont gardés.
  const current = user.settings && typeof user.settings === "object" && !Array.isArray(user.settings) ? user.settings : {};
  await db.user.update({ where: { id: user.id }, data: { settings: { ...current, template: "FACECAM", minScore: 65 } } });
  console.log(`${chaines.length} chaînes suivies par ${email}. Réglages : webcam en haut, potentiel minimum 65.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
