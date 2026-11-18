// Banc d'essai du pilote automatique et des notifications, sur le compte de démo.
//   npx tsx --env-file=.env tests/e2e/automation-bench.ts setup [simulation|reel] [scoreMin]
//       Crée deux FAUX comptes sociaux (faux jetons : aucune publication ne peut partir), règle le pilote
//       et branche deux canaux vers les faux récepteurs (tests/e2e/fake-notify.mjs, port 4100).
//       Lancer le worker et le site avec NOTIFY_EXTRA_HOSTS=127.0.0.1:4100.
//   npx tsx --env-file=.env tests/e2e/automation-bench.ts report
//       Affiche l'état : clips, publications du pilote, journal, notifications.
//   npx tsx --env-file=.env tests/e2e/automation-bench.ts clean
import { readFileSync } from "node:fs";
import type { Prisma } from "@prisma/client";
import { encrypt, sha256 } from "@/lib/crypto";
import { db } from "@/lib/db";

const DIR = process.env.E2E_DIR ?? "/tmp/cliping-e2e";
const email = process.env.E2E_EMAIL ?? "demo@cliping.local";
const user = await db.user.findUniqueOrThrow({ where: { email } });
const cmd = process.argv[2] ?? "report";

async function clean() {
  await db.socialAccount.deleteMany({ where: { userId: user.id, externalId: { startsWith: "e2e-fake-" } } });
  await db.autopilot.deleteMany({ where: { userId: user.id } });
  await db.autopilotLog.deleteMany({ where: { userId: user.id } });
  await db.notifyChannel.deleteMany({ where: { userId: user.id } });
  await db.notification.deleteMany({ where: { userId: user.id } });
  await db.notifySettings.deleteMany({ where: { userId: user.id } });
}

if (cmd === "clean") {
  await clean();
  console.log("banc nettoyé");
} else if (cmd === "setup") {
  const real = process.argv[3] === "reel";
  const minScore = Number(process.argv[4] ?? 0);
  await clean();
  const fakeToken = encrypt("faux-jeton-banc-essai");
  const a = await db.socialAccount.create({
    data: { userId: user.id, platform: "TIKTOK", externalId: "e2e-fake-tiktok", displayName: "Faux TikTok A", accessTokenEnc: fakeToken, scopes: "video.publish", defaultPrivacy: "SELF_ONLY" },
  });
  const b = await db.socialAccount.create({
    data: { userId: user.id, platform: "YOUTUBE", externalId: "e2e-fake-youtube", displayName: "Faux YouTube B", accessTokenEnc: fakeToken, scopes: "youtube.upload", defaultPrivacy: "private" },
  });
  const streamers = await db.streamer.findMany({ where: { userId: user.id }, select: { id: true } });
  const config = {
    approve: true,
    minScore,
    schedule: true,
    allStreamers: false,
    streamers: streamers.map((s) => s.id),
    accounts: [a.id, b.id],
    perAccountCap: 2,
    globalDailyCap: 3,
    gapMin: 15,
    staggerMin: 0,
    graceMin: 5,
    window: { from: 0, to: 0 },
    maxClipAgeH: 24,
    tz: "Europe/Paris",
  };
  await db.autopilot.create({ data: { userId: user.id, enabled: true, dryRun: !real, enabledAt: new Date(), config: config as Prisma.InputJsonValue } });
  await db.autopilotLog.create({ data: { userId: user.id, kind: "start", dryRun: !real, message: `Banc d'essai : pilote démarré (${real ? "pour de vrai, faux comptes" : "simulation"}).` } });
  await db.notifySettings.create({ data: { userId: user.id, prefs: { groupMin: 2, quiet: null, digestHour: 0, tz: "Europe/Paris" } } });
  const sub = JSON.parse(readFileSync(`${DIR}/push-sub.json`, "utf8")) as { endpoint: string; keys: { p256dh: string; auth: string } };
  await db.notifyChannel.create({ data: { userId: user.id, kind: "WEBPUSH", label: "Faux appareil (banc)", configEnc: encrypt(JSON.stringify(sub)), targetHash: sha256(`WEBPUSH:${sub.endpoint}`) } });
  await db.notifyChannel.create({
    data: { userId: user.id, kind: "NTFY", label: "Faux ntfy (banc)", configEnc: encrypt(JSON.stringify({ server: "http://127.0.0.1:4100", topic: "banc-essai" })), targetHash: sha256("NTFY:banc") },
  });
  console.log(`pilote ${real ? "RÉEL (faux comptes)" : "en simulation"} prêt · comptes ${a.id} ${b.id} · score min ${minScore}`);
} else {
  const [clips, pubs, logs, notifs, ap] = await Promise.all([
    db.clip.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { id: true, status: true, score: true, title: true, hasFinal: true } }),
    db.publication.findMany({ where: { userId: user.id }, orderBy: { scheduledAt: "asc" }, include: { account: { select: { displayName: true } } } }),
    db.autopilotLog.findMany({ where: { userId: user.id }, orderBy: { at: "asc" } }),
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    db.autopilot.findUnique({ where: { userId: user.id } }),
  ]);
  console.log(`PILOTE enabled=${ap?.enabled} dryRun=${ap?.dryRun} state=${JSON.stringify(ap?.state)}`);
  console.log("\nCLIPS");
  for (const c of clips) console.log(`  ${c.id} ${c.status} score=${c.score} final=${c.hasFinal} « ${c.title} »`);
  console.log("\nPUBLICATIONS");
  for (const p of pubs) console.log(`  ${p.id} ${p.status} pilote=${p.autopilot} ${p.account.displayName} prévu ${p.scheduledAt.toISOString()} ${p.error ?? p.note ?? ""}`);
  console.log("\nJOURNAL");
  for (const l of logs) console.log(`  ${l.at.toISOString()} [${l.kind}${l.dryRun ? " sim" : ""}] ${l.message}`);
  console.log("\nNOTIFICATIONS");
  for (const n of notifs) console.log(`  ${n.createdAt.toISOString()} ${n.type} ${n.status} ${n.sentAs ? `(parti comme « ${n.sentAs} »)` : ""} ${n.title} — ${n.body.replace(/\n/g, " / ")}`);
}
await db.$disconnect();
