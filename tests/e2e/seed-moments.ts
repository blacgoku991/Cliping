// Banc d'essai des compilations : crée N clips « prêts » sur le compte de démo, découpés dans le flux de test
// (chrono incrusté en haut à gauche), rattachés à un live terminé. La transcription est synthétique :
// chaque mot vaut l'instant du flux où il est prononcé (« T75 » = 1 min 15 au chrono), ce qui permet de
// vérifier à l'œil la synchro des sous-titres et des chapitres sur les images extraites.
//
//   npx tsx --env-file=.env tests/e2e/seed-moments.ts [N=10]
import { spawnSync } from "node:child_process";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { clipDir, clipFile, ensureDir } from "@/lib/storage";

const N = Math.max(3, Math.min(10, Number(process.argv[2]) || 10));
const STREAM = `${process.env.E2E_DIR ?? "/tmp/cliping-e2e"}/stream.mp4`;
const SOURCE_LEN = 34;

const user = await db.user.findUniqueOrThrow({ where: { email: process.env.E2E_EMAIL ?? "demo@cliping.local" } });
const streamer = await db.streamer.findFirstOrThrow({ where: { userId: user.id, login: "teststreamer" } });
const recording = await db.recording.create({
  data: {
    userId: user.id,
    streamerId: streamer.id,
    source: "LIVE",
    sourceUrl: streamer.url,
    status: "DONE",
    title: "Banc d'essai compilation",
    category: "Grand Theft Auto VI",
    durationSec: 240,
    endedAt: new Date(),
  },
});

for (let i = 0; i < N; i++) {
  const origin = 4 + i * 21; // début de source.mp4 dans le flux
  const start = 2;
  const end = start + 14 + ((i * 5) % 15); // fenêtres de 14 à 28 s
  const peak = start + (end - start) * 0.6;
  const clip = await db.clip.create({
    data: {
      userId: user.id,
      recordingId: recording.id,
      streamerId: streamer.id,
      status: "READY",
      originSec: origin,
      startSec: start,
      endSec: end,
      peakSec: peak,
      sourceDur: SOURCE_LEN,
      score: 50 + ((i * 37) % 50),
      title: `Moment d'essai ${i + 1} à ${Math.floor((origin + peak) / 60)}:${String(Math.floor((origin + peak) % 60)).padStart(2, "0")} 🔥`,
      hook: "",
      transcript: Array.from({ length: Math.floor(SOURCE_LEN / 2) }, (_, k) => {
        const s = k * 2 + 0.2;
        return { w: `T${Math.round(origin + s)}`, s, e: s + 0.6 };
      }),
    },
  });
  await ensureDir(clipDir(clip.id));
  // Réencodage (pas de copie) : la source commence exactement à `origin`, comme une vraie découpe à l'image près.
  const res = spawnSync(env.bin.ffmpeg, [
    "-v", "error", "-y", "-ss", String(origin), "-i", STREAM, "-t", String(SOURCE_LEN),
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-c:a", "aac", clipFile(clip.id, "source"),
  ]);
  if (res.status !== 0) throw new Error(res.stderr.toString());
  console.log(`clip ${i + 1}/${N} : ${clip.id} (flux ${origin + start}–${origin + end} s, score ${clip.score})`);
}
console.log(`live ${recording.id} : ${N} moments`);
await db.$disconnect();
