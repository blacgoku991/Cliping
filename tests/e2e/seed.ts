// Crée (ou réinitialise) un compte de démonstration avec une chaîne Twitch fictive à surveiller.
import { hashPassword } from "@/lib/crypto";
import { db } from "@/lib/db";

const email = process.env.E2E_EMAIL ?? "demo@cliping.local";
const password = process.env.E2E_PASSWORD ?? "demo-cliping-2026";

const user = await db.user.upsert({
  where: { email },
  update: {},
  create: { email, name: "Démo", passwordHash: await hashPassword(password) },
});
await db.streamer.upsert({
  where: { userId_platform_login: { userId: user.id, platform: "TWITCH", login: "teststreamer" } },
  update: { enabled: true },
  create: {
    userId: user.id,
    platform: "TWITCH",
    login: "teststreamer",
    url: "https://www.twitch.tv/teststreamer",
    displayName: "TestStreamer",
    gameFilter: "Grand Theft Auto VI",
  },
});
console.log(`compte de démo : ${email} / ${password}`);
await db.$disconnect();
