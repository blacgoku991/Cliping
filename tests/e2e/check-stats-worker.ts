// Vérifie collectStats() contre la vraie base, avec un réseau simulé (aucun appel aux plateformes).
// Crée un compte et des publications temporaires marqués « fictif », puis les supprime.
//   npx tsx --env-file=.env tests/e2e/check-stats-worker.ts
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { collectStats } from "@/worker/stats";

const user = await db.user.findUniqueOrThrow({ where: { email: process.env.E2E_EMAIL ?? "demo@cliping.local" } });
const mk = (platform: "TIKTOK" | "YOUTUBE", slug: string, scopes: string) =>
  db.socialAccount.create({ data: { userId: user.id, platform, externalId: `fictif-check-${slug}`, displayName: `Vérif ${slug} (fictif)`, accessTokenEnc: encrypt("jeton-fictif"), scopes } });
const clip = await db.clip.create({ data: { userId: user.id, peakSec: 1, startSec: 0, endSec: 30, title: "vérif (fictif)" } });
const tt = await mk("TIKTOK", "tt", "user.info.basic,video.list");
const ttNoScope = await mk("TIKTOK", "tt2", "user.info.basic");
const yt = await mk("YOUTUBE", "yt", "");
const pub = (accountId: string, externalId: string, privacy = "public") =>
  db.publication.create({ data: { userId: user.id, clipId: clip.id, accountId, status: "PUBLISHED", title: "vérif", privacy, externalId, publishedAt: new Date(Date.now() - 3600_000) } });
const pOk = await pub(tt.id, "7300000000000000099");
const pDraft = await pub(tt.id, "v_pub_file~x", "draft");
const pNoScope = await pub(ttNoScope.id, "7300000000000000098");
const pYt = await pub(yt.id, "ytvid1");
const pGone = await pub(yt.id, "ytgone");

const urls: string[] = [];
globalThis.fetch = (async (url: string | URL) => {
  urls.push(String(url));
  if (String(url).includes("tiktokapis")) return Response.json({ data: { videos: [{ id: "7300000000000000099", view_count: 4200, like_count: 300, comment_count: 12, share_count: 7 }] }, error: { code: "ok" } });
  return Response.json({ items: [{ id: "ytvid1", statistics: { viewCount: "999", likeCount: "50", commentCount: "3" } }] });
}) as typeof fetch;

try {
  await collectStats();
  const get = (id: string) => db.publication.findUniqueOrThrow({ where: { id }, include: { stats: true } });
  const ok = await get(pOk.id);
  assert.equal(ok.statsStatus, "OK");
  assert.equal(ok.viewCount, 4200);
  assert.equal(ok.shareCount, 7);
  assert.equal(ok.stats.length, 1);
  // 1 h d'âge → prochain relevé dans 15 min
  assert.ok(Math.abs(ok.statsNextAt!.getTime() - Date.now() - 15 * 60_000) < 60_000);
  assert.equal((await get(pDraft.id)).statsStatus, "DRAFT");
  assert.equal((await get(pDraft.id)).statsNextAt, null);
  assert.equal((await get(pNoScope.id)).statsStatus, "NO_SCOPE");
  const y = await get(pYt.id);
  assert.equal(y.viewCount, 999);
  assert.equal(y.shareCount, null);
  assert.equal((await get(pGone.id)).statsStatus, "NOT_FOUND");
  assert.equal(urls.length, 2, "un appel par compte suivable");
  // Second passage immédiat : rien n'est dû, aucun appel.
  await collectStats();
  assert.equal(urls.length, 2);
  console.log("✔ collectStats : relevés, brouillon, autorisation manquante, vidéo supprimée, planification");
} finally {
  await db.socialAccount.deleteMany({ where: { externalId: { startsWith: "fictif-check-" } } });
  await db.clip.delete({ where: { id: clip.id } });
  await db.$disconnect();
}
