import type { Metadata } from "next";
import { ArrowLeft, Film } from "lucide-react";
import { createManual } from "@/app/actions/compilations";
import { ClipPicker } from "@/components/compilation/clip-picker";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { MAX_MOMENTS, MIN_MOMENTS } from "@/lib/compilation";
import { ELIGIBLE } from "@/lib/compilation-proposals";
import { db } from "@/lib/db";
import { ago } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Nouvelle compilation" };

export default async function NewCompilationPage() {
  const user = await requireUser();
  const clips = await db.clip.findMany({
    where: { userId: user.id, ...ELIGIBLE },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: 150,
    include: { streamer: { select: { displayName: true } }, recording: { select: { author: true } } },
  });

  return (
    <>
      <PageHeader
        title="Composer une compilation"
        subtitle={`Coche de ${MIN_MOMENTS} à ${MAX_MOMENTS} clips. Tu pourras ensuite les réordonner, renommer chaque moment et lancer le montage.`}
        action={<LinkButton href="/app/compilations" variant="ghost" size="sm"><ArrowLeft className="size-3.5" /> Compilations</LinkButton>}
      />
      {clips.length < MIN_MOMENTS ? (
        <Card>
          <EmptyState icon={<Film className="size-6" />} title="Pas encore assez de clips">
            Il faut au moins {MIN_MOMENTS} clips prêts ou approuvés pour faire une compilation.
          </EmptyState>
        </Card>
      ) : (
        <ClipPicker
          action={createManual}
          submitLabel="Créer la compilation"
          min={MIN_MOMENTS}
          max={MAX_MOMENTS}
          withOrder
          clips={clips.map((c) => ({
            id: c.id,
            title: c.title,
            streamer: c.streamer?.displayName ?? c.recording?.author ?? "",
            score: c.score,
            duration: c.endSec - c.startSec,
            thumb: c.hasFinal ? `/api/media/${c.id}/thumb.jpg?v=${c.renderedAt?.getTime() ?? 0}` : null,
            when: ago(c.createdAt),
          }))}
        />
      )}
    </>
  );
}
