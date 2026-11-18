// ⚠ DONNÉES FICTIVES — pour vérifier la page « Performances » dans le navigateur, jamais en production.
// Crée sur le compte de démo trois comptes sociaux fictifs, des streamers fictifs, ~70 publications et leurs relevés
// (vues, j'aime…) inventés mais réalistes. Tout est marqué « fictif » et le worker n'y touche pas (aucun relevé programmé).
//
//   npx tsx --env-file=.env tests/e2e/seed-stats.ts          crée (ou recrée) les données
//   npx tsx --env-file=.env tests/e2e/seed-stats.ts --clear  les supprime
import type { Prisma } from "@prisma/client";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { nextCheckDelayMs } from "@/lib/stats/math";

const email = process.env.E2E_EMAIL ?? "demo@cliping.local";
const MARK = "fictif-";
const NEVER = new Date("2099-01-01T00:00:00Z"); // le worker ne relèvera jamais ces publications
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const user = await db.user.findUnique({ where: { email } });
if (!user) {
  console.error(`Compte ${email} introuvable : lance d'abord npm run demo:seed`);
  process.exit(1);
}

async function clear(): Promise<void> {
  const streamers = await db.streamer.findMany({ where: { userId: user!.id, login: { startsWith: MARK } }, select: { id: true } });
  await db.clip.deleteMany({ where: { userId: user!.id, streamerId: { in: streamers.map((s) => s.id) } } });
  await db.socialAccount.deleteMany({ where: { userId: user!.id, externalId: { startsWith: MARK } } });
  await db.streamer.deleteMany({ where: { userId: user!.id, login: { startsWith: MARK } } });
}

await clear();
if (process.argv.includes("--clear")) {
  console.log("données fictives supprimées");
  await db.$disconnect();
  process.exit(0);
}

// Générateur pseudo-aléatoire déterministe : les mêmes données à chaque lancement.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
const noise = () => Math.exp((rand() + rand() + rand() - 1.5) * 0.9); // log-normale grossière

const token = encrypt("jeton-fictif");
const account = (platform: "TIKTOK" | "YOUTUBE", slug: string, name: string, scopes: string, size: number) => ({ platform, slug, name, scopes, size });
const ACCOUNTS = [
  account("TIKTOK", "tt-main", "GTA Clips FR (fictif)", "user.info.basic,video.publish,video.upload,video.list", 9000),
  account("YOUTUBE", "yt-main", "Shorts GTA 6 (fictif)", "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly", 3500),
  account("TIKTOK", "tt-alt", "Vice City Moments (fictif)", "user.info.basic,video.publish,video.upload", 2000),
];
const STREAMERS = [
  { login: "kenzo", name: "Kenzo (fictif)", factor: 1.9 },
  { login: "lilou", name: "Lilou (fictif)", factor: 1.0 },
  { login: "mehdi_rp", name: "Mehdi RP (fictif)", factor: 0.6 },
  { login: "zed", name: "Zed (fictif)", factor: 1.2 },
];
const HOOKS: Array<{ text: string; factor: number }> = [
  { text: "Il a vraiment fait ça en plein braquage ?", factor: 1.5 },
  { text: "Personne ne s'attendait à ce final ?", factor: 1.4 },
  { text: "Quand le chat te spoile la mission", factor: 1.2 },
  { text: "POV : tu rates le saut de 2 mètres", factor: 1.2 },
  { text: "3 secondes pour tout perdre", factor: 1.0 },
  { text: "ÇA NE PEUT PAS ÊTRE RÉEL", factor: 0.8 },
  { text: "Le meilleur moment du stream", factor: 0.8 },
  { text: "", factor: 0.6 },
];
const DURATIONS = [{ sec: 16, f: 0.8 }, { sec: 28, f: 1.3 }, { sec: 42, f: 1.1 }, { sec: 58, f: 0.8 }, { sec: 78, f: 0.6 }];
// Heures locales (Europe/Paris, UTC+1 en novembre) et leur effet
const HOURS = [{ h: 7, f: 0.7 }, { h: 12, f: 1.0 }, { h: 13, f: 1.0 }, { h: 17, f: 1.4 }, { h: 18, f: 1.5 }, { h: 21, f: 1.2 }, { h: 22, f: 1.1 }, { h: 1, f: 0.5 }];
const TITLES = ["Course-poursuite à Vice City", "Le casse parfait… presque", "Bug physique légendaire", "Il trouve un easter egg", "Duel sur le toit", "Atterrissage impossible", "La police ne lâche rien", "Fou rire en pleine mission"];

const accounts = [];
for (const a of ACCOUNTS) {
  accounts.push({
    ...a,
    row: await db.socialAccount.create({
      data: { userId: user.id, platform: a.platform, externalId: MARK + a.slug, displayName: a.name, handle: a.slug, accessTokenEnc: token, scopes: a.scopes, valid: true },
    }),
  });
}
const streamers = [];
for (const s of STREAMERS) {
  streamers.push({
    ...s,
    row: await db.streamer.create({
      data: { userId: user.id, platform: "TWITCH", login: MARK + s.login, url: `https://www.twitch.tv/${MARK}${s.login}`, displayName: s.name, enabled: false },
    }),
  });
}

/** Courbe de vues : démarrage rapide puis plateau, avec une seconde vie occasionnelle. */
function viewsAt(total: number, tau: number, ageH: number): number {
  return Math.round(total * (1 - Math.exp(-ageH / tau)));
}

const now = Date.now();
let pubCount = 0;
let statCount = 0;
for (let i = 0; i < 72; i++) {
  const acc = i % 9 === 8 ? accounts[2]! : i % 3 === 0 ? accounts[1]! : accounts[0]!;
  const st = pick(streamers);
  const hook = pick(HOOKS);
  const dur = pick(DURATIONS);
  const hr = pick(HOURS);
  const daysAgo = Math.floor((i / 72) * 40 + rand() * 0.6);
  const local = new Date(now - daysAgo * DAY);
  local.setUTCHours(hr.h - 1, Math.floor(rand() * 60), 0, 0);
  let publishedAt = local;
  if (publishedAt.getTime() > now - 20 * 60_000) publishedAt = new Date(now - (1 + rand() * 4) * HOUR);

  const clip = await db.clip.create({
    data: {
      userId: user.id,
      streamerId: st.row.id,
      status: "APPROVED",
      peakSec: 10,
      startSec: 0,
      endSec: dur.sec,
      sourceDur: dur.sec + 20,
      score: Math.round(50 + rand() * 45),
      title: `${pick(TITLES)} (fictif)`,
      hook: hook.text,
      hashtags: ["gta6", "fictif"],
      createdAt: new Date(publishedAt.getTime() - HOUR),
    },
  });

  const draft = acc.slug === "tt-main" && i % 17 === 5; // quelques brouillons TikTok : non suivables
  const externalId = acc.platform === "TIKTOK" ? (draft ? `v_pub_file~${MARK}${i}` : String(7300000000000000000n + BigInt(i))) : `${MARK}yt${i}`;
  const total = Math.round(acc.size * st.factor * hook.factor * dur.f * hr.f * noise() * 4);
  const tau = 6 + rand() * 18;
  const ageH = (now - publishedAt.getTime()) / HOUR;

  // Relevés au même rythme que le vrai worker.
  const stats: Prisma.PublicationStatCreateManyInput[] = [];
  if (!draft && acc.slug !== "tt-alt") {
    let t = publishedAt.getTime() + 10 * 60_000;
    while (t <= now) {
      const age = (t - publishedAt.getTime()) / HOUR;
      const views = viewsAt(total, tau, age);
      stats.push({
        publicationId: "",
        userId: user.id,
        at: new Date(t),
        views,
        likes: Math.round(views * (0.06 + rand() * 0.01)),
        comments: Math.round(views * 0.004),
        shares: acc.platform === "TIKTOK" ? Math.round(views * 0.003) : null,
      });
      const delay = nextCheckDelayMs(t - publishedAt.getTime());
      if (delay === null) break;
      t += delay;
    }
  }
  const last = stats[stats.length - 1];
  const pub = await db.publication.create({
    data: {
      userId: user.id,
      clipId: clip.id,
      accountId: acc.row.id,
      status: "PUBLISHED",
      title: clip.title,
      privacy: draft ? "draft" : "public",
      scheduledAt: publishedAt,
      publishedAt,
      externalId,
      externalUrl: draft ? null : acc.platform === "YOUTUBE" ? `https://www.youtube.com/shorts/${externalId}` : `https://www.tiktok.com/@${acc.slug}/video/${externalId}`,
      note: draft ? "Envoyé dans tes brouillons TikTok (fictif)." : null,
      viewCount: last?.views ?? null,
      likeCount: last?.likes ?? null,
      commentCount: last?.comments ?? null,
      shareCount: last?.shares ?? null,
      statsAt: last?.at ?? null,
      statsStatus: draft ? "DRAFT" : acc.slug === "tt-alt" ? "NO_SCOPE" : ageH > 90 * 24 ? "ENDED" : "OK",
      statsNextAt: NEVER,
      createdAt: new Date(publishedAt.getTime() - 5 * 60_000),
    },
  });
  if (stats.length) {
    await db.publicationStat.createMany({ data: stats.map((s) => ({ ...s, publicationId: pub.id })) });
    statCount += stats.length;
  }
  pubCount++;
}

console.log(`données FICTIVES créées pour ${email} : ${accounts.length} comptes, ${streamers.length} streamers, ${pubCount} publications, ${statCount} relevés`);
await db.$disconnect();
