import type { Metadata } from "next";
import { AutoRefresh } from "@/components/client";
import { ReviewDeck, type ReviewItem } from "@/components/review-deck";
import { db } from "@/lib/db";
import { ago, clock } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Mode validation" };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ start?: string; sort?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const sort = sp.sort === "recent" ? "recent" : "score";
  const [clips, processing] = await Promise.all([
    db.clip.findMany({
      where: { userId: user.id, status: "READY", hasFinal: true },
      orderBy: sort === "recent" ? { createdAt: "desc" } : [{ score: "desc" }, { createdAt: "desc" }],
      take: 150,
      include: {
        streamer: { select: { displayName: true, platform: true } },
        recording: { select: { author: true, title: true, category: true, source: true } },
      },
    }),
    db.clip.count({ where: { userId: user.id, status: "PROCESSING" } }),
  ]);

  const items: ReviewItem[] = clips.map((c) => {
    const s = (c.signals ?? {}) as { audio?: number; chat?: number | null; scene?: number | null; ai?: number | null; reason?: string };
    return {
      id: c.id,
      title: c.title,
      hashtags: c.hashtags,
      author: c.streamer?.displayName ?? c.recording?.author ?? "Import",
      platform: c.streamer?.platform ?? null,
      hasFinal: c.hasFinal,
      version: c.renderedAt?.getTime() ?? 0,
      score: c.score,
      status: c.status,
      durationLabel: clock(c.endSec - c.startSec),
      agoLabel: ago(c.createdAt),
      context: [c.recording?.category, c.recording?.title].filter(Boolean).join(" · "),
      momentLabel: `à ${clock(c.originSec + c.peakSec)} du ${c.recording?.source === "VOD" ? "replay" : "live"}`,
      signals: {
        audio: typeof s.audio === "number" ? s.audio : null,
        chat: typeof s.chat === "number" ? s.chat : null,
        scene: typeof s.scene === "number" ? s.scene : null,
        ai: typeof s.ai === "number" ? s.ai : null,
        reason: typeof s.reason === "string" ? s.reason : "",
      },
    };
  });

  return (
    <>
      <AutoRefresh seconds={20} />
      <ReviewDeck initial={items} startId={sp.start ?? null} processing={processing} sort={sort} />
    </>
  );
}
