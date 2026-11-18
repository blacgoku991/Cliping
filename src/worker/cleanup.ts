import { readdir } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { parseSettings } from "@/lib/settings";
import { clipDir, removeDir } from "@/lib/storage";
import { log } from "./proc";

/**
 * Ménage périodique :
 *  - clips jamais publiés et plus vieux que la durée de conservation choisie par l'utilisateur
 *  - dossiers orphelins (clip supprimé depuis le site)
 *  - sessions expirées, vieilles tâches terminées
 */
export async function cleanup(): Promise<void> {
  let removed = 0;
  const users = await db.user.findMany({ select: { id: true, settings: true } });
  for (const user of users) {
    const days = parseSettings(user.settings).retentionDays;
    if (days <= 0) continue;
    const old = await db.clip.findMany({
      where: {
        userId: user.id,
        createdAt: { lt: new Date(Date.now() - days * 86_400_000) },
        status: { in: ["READY", "REJECTED", "FAILED"] },
        publications: { none: {} },
        // Un clip retenu dans une compilation garde sa source : elle sert à remonter la vidéo.
        compilationItems: { none: {} },
      },
      select: { id: true },
      take: 500,
    });
    for (const c of old) {
      await removeDir(clipDir(c.id));
      await db.clip.delete({ where: { id: c.id } }).catch(() => {});
      removed++;
    }
  }

  // On liste les dossiers AVANT d'interroger la base : un clip ou un enregistrement créé entre-temps
  // n'est pas dans la liste, donc ne risque pas d'être pris pour un orphelin.
  const clipDirs = await readdir(path.join(env.dataDir, "clips")).catch(() => [] as string[]);
  const recordingDirs = await readdir(path.join(env.dataDir, "recordings")).catch(() => [] as string[]);
  const known = new Set((await db.clip.findMany({ select: { id: true } })).map((c) => c.id));
  for (const name of clipDirs) {
    if (!known.has(name)) {
      await removeDir(path.join(env.dataDir, "clips", name));
      removed++;
    }
  }
  // Les enregistrements en cours sont marqués en base : on ne touche pas à leurs dossiers.
  const busy = new Set(
    (await db.recording.findMany({ where: { status: { in: ["PENDING", "PROCESSING", "RECORDING"] } }, select: { id: true } })).map((r) => r.id),
  );
  for (const name of recordingDirs) {
    if (!busy.has(name)) await removeDir(path.join(env.dataDir, "recordings", name));
  }

  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.job.deleteMany({ where: { status: { in: ["DONE", "FAILED"] }, finishedAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
  if (removed) log("cleanup", `${removed} élément(s) supprimé(s)`);
}
