import { channelUrl, type Credit } from "@/lib/compilation";
import { db } from "@/lib/db";

/** Streamers crédités dans la description d'une compilation, dans l'ordre d'apparition. */
export async function compilationCredits(compilationId: string): Promise<Credit[]> {
  const items = await db.compilationItem.findMany({
    where: { compilationId },
    orderBy: { position: "asc" },
    include: { clip: { select: { streamer: { select: { platform: true, login: true, displayName: true } }, recording: { select: { author: true } } } } },
  });
  const seen = new Set<string>();
  const out: Credit[] = [];
  for (const it of items) {
    const s = it.clip.streamer;
    const name = s?.displayName ?? it.clip.recording?.author ?? "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, url: s ? channelUrl(s.platform, s.login) : null });
  }
  return out;
}
