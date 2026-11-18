import type { Metadata } from "next";
import Link from "next/link";
import { Film, ListPlus, Sparkles } from "lucide-react";
import { createFromProposal } from "@/app/actions/compilations";
import { SubmitButton } from "@/components/action-form";
import { AutoRefresh } from "@/components/client";
import { COMPILATION_STATUS } from "@/components/compilation/status";
import { Badge, Card, CardHeader, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui";
import { proposalsFor } from "@/lib/compilation-proposals";
import { db } from "@/lib/db";
import { ago, clock } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Compilations" };

export default async function CompilationsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { error } = await searchParams;
  const [comps, proposals] = await Promise.all([
    db.compilation.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 60,
      include: { _count: { select: { items: true } }, publications: { select: { status: true } } },
    }),
    proposalsFor(user.id),
  ]);
  const rendering = comps.some((c) => c.status === "RENDERING");

  return (
    <>
      {rendering ? <AutoRefresh seconds={5} /> : null}
      <PageHeader
        title="Compilations"
        subtitle="Les meilleurs moments mis bout à bout dans une vidéo horizontale pour YouTube : ouverture, numéro et titre de chaque moment, sous-titres, crédits, chapitres et miniature."
        action={<LinkButton href="/app/compilations/new" variant="primary"><ListPlus className="size-4" /> Composer à la main</LinkButton>}
      />
      {error === "moments" ? <Notice tone="warn" className="mb-5">Pas assez de clips disponibles pour cette proposition (il en faut au moins 3).</Notice> : null}

      {proposals.length ? (
        <Card className="mb-6">
          <CardHeader title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-brand" /> À compiler</span>} hint="Les meilleurs moments sont choisis et rangés pour toi (le meilleur à la fin) ; tu pourras tout réordonner avant de publier." />
          <ul className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
            {proposals.map((p) => (
              <li key={`${p.kind}:${p.id}`} className="flex flex-col gap-3 rounded-xl border border-line bg-bg p-3">
                <div className="flex gap-1.5">
                  {p.thumbs.length ? (
                    p.thumbs.map((id) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={id} src={`/api/media/${id}/thumb.jpg`} alt="" loading="lazy" className="aspect-[9/16] w-10 rounded-md bg-surface-2 object-cover" />
                    ))
                  ) : (
                    <div className="grid aspect-[9/16] w-10 place-items-center rounded-md bg-surface-2"><Film className="size-4 text-faint" /></div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">{p.label}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">{[p.hint, p.at ? ago(p.at) : ""].filter(Boolean).join(" · ")}</p>
                </div>
                <form action={createFromProposal}>
                  <input type="hidden" name="kind" value={p.kind} />
                  <input type="hidden" name="id" value={p.id} />
                  <SubmitButton variant="primary" size="sm" className="w-full" pendingLabel="Préparation…">
                    <Sparkles className="size-3.5" /> Faire le best-of · {p.count} moments
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {comps.length === 0 ? (
        <Card>
          <EmptyState icon={<Film className="size-6" />} title="Aucune compilation" action={<LinkButton href="/app/compilations/new" variant="primary">Composer une compilation</LinkButton>}>
            Dès qu'un live terminé a au moins 3 clips, il apparaît ici avec un bouton « Faire le best-of ». Tu peux aussi choisir toi-même les clips.
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {comps.map((c) => {
            const s = COMPILATION_STATUS[c.status] ?? COMPILATION_STATUS.DRAFT!;
            const published = c.publications.some((p) => p.status === "PUBLISHED");
            const planned = c.publications.some((p) => ["QUEUED", "UPLOADING", "PROCESSING"].includes(p.status));
            const duration = ((c.montage ?? {}) as { duration?: number }).duration;
            return (
              <li key={c.id}>
                <Link href={`/app/compilations/${c.id}`} className="group block overflow-hidden rounded-2xl border border-line bg-surface transition hover:border-line-strong">
                  <div className="relative aspect-video bg-surface-2">
                    {c.hasThumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/compilations/${c.id}/thumb.jpg?v=${c.renderedAt?.getTime() ?? 0}`} alt="" loading="lazy" className="size-full object-cover" />
                    ) : (
                      <Film className="absolute inset-0 m-auto size-8 text-faint" aria-hidden />
                    )}
                    {duration ? <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white">{clock(duration)}</span> : null}
                    {c.status === "RENDERING" ? (
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40"><div className="h-full brand-gradient" style={{ width: `${Math.round(c.progress * 100)}%` }} /></div>
                    ) : null}
                  </div>
                  <div className="p-4">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {published ? <Badge tone="brand">Publiée</Badge> : planned ? <Badge tone="violet">Programmée</Badge> : null}
                    </div>
                    <p className="line-clamp-2 font-semibold leading-snug group-hover:underline">{c.title || "Compilation sans titre"}</p>
                    <p className="mt-1 text-xs text-muted">{c._count.items} moments · créée {ago(c.createdAt)}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
