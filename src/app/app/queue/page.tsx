import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange, ExternalLink, RotateCcw, Send, X } from "lucide-react";
import { cancelPublication, retryPublication } from "@/app/actions/clips";
import { SocialIcon } from "@/components/brand";
import { AutoRefresh, LocalTime } from "@/components/client";
import { Badge, Button, Card, EmptyState, LinkButton, Notice, PageHeader, type Tone } from "@/components/ui";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Publications" };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  QUEUED: { label: "Programmé", tone: "violet" },
  UPLOADING: { label: "Envoi en cours", tone: "warn" },
  PROCESSING: { label: "Traitement par la plateforme", tone: "warn" },
  PUBLISHED: { label: "Publié", tone: "ok" },
  FAILED: { label: "Échec", tone: "bad" },
  CANCELED: { label: "Annulé", tone: "neutral" },
};

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ planned?: string }> }) {
  const user = await requireUser();
  const planned = Math.max(0, Math.floor(Number((await searchParams).planned) || 0));
  const pubs = await db.publication.findMany({
    where: { userId: user.id },
    orderBy: [{ scheduledAt: "desc" }],
    take: 100,
    include: {
      account: true,
      clip: { select: { id: true, title: true, hasFinal: true, renderedAt: true } },
      compilation: { select: { id: true, hasThumb: true, renderedAt: true } },
    },
  });
  const live = pubs.some((p) => ["QUEUED", "UPLOADING", "PROCESSING"].includes(p.status));

  return (
    <>
      {live ? <AutoRefresh seconds={6} /> : null}
      <PageHeader
        title="Publications"
        subtitle="Tout ce qui est programmé, en cours d'envoi ou déjà en ligne sur tes comptes."
        action={<LinkButton href="/app/queue/plan" variant="primary" size="sm"><CalendarRange className="size-3.5" /> Planifier tous les clips approuvés</LinkButton>}
      />
      {planned ? <Notice tone="ok" className="mb-5">{planned} publication{planned > 1 ? "s" : ""} programmée{planned > 1 ? "s" : ""}. Chacune part à son heure ; tu peux en annuler une ci-dessous.</Notice> : null}
      {pubs.length === 0 ? (
        <Card>
          <EmptyState icon={<Send className="size-6" />} title="Aucune publication" action={<LinkButton href="/app/clips" variant="primary">Voir mes clips</LinkButton>}>
            Ouvre un clip et clique sur « Publier », ou planifie plusieurs clips d'un coup sur tes comptes avec « Planifier en lot ».
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {pubs.map((p) => {
              const s = STATUS[p.status] ?? { label: p.status, tone: "neutral" as Tone };
              // Une publication porte un clip vertical ou une compilation (vidéo YouTube classique, miniature 16:9).
              const href = p.compilation ? `/app/compilations/${p.compilation.id}` : `/app/clips/${p.clip?.id ?? ""}`;
              const thumb = p.compilation
                ? p.compilation.hasThumb ? `/api/compilations/${p.compilation.id}/thumb.jpg?v=${p.compilation.renderedAt?.getTime() ?? 0}` : null
                : p.clip?.hasFinal ? `/api/media/${p.clip.id}/thumb.jpg?v=${p.clip.renderedAt?.getTime() ?? 0}` : null;
              return (
                <li key={p.id} className="flex gap-4 px-4 py-4 sm:px-5">
                  <Link href={href} className={`block shrink-0 overflow-hidden rounded-lg bg-surface-2 ${p.compilation ? "aspect-video w-24 self-start" : "aspect-[9/16] w-12"}`}>
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" loading="lazy" className="size-full object-cover" />
                    ) : null}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <Badge tone={s.tone}>{s.label}</Badge>
                      <span className="flex items-center gap-1.5 text-sm text-muted">
                        <SocialIcon platform={p.account.platform} className="size-3.5" /> {p.account.displayName}
                      </span>
                      {p.compilation ? <Badge tone="brand">Compilation · vidéo</Badge> : null}
                      <span className="text-xs text-faint">
                        {p.status === "PUBLISHED" && p.publishedAt ? <LocalTime iso={p.publishedAt.toISOString()} /> : <>prévu le <LocalTime iso={p.scheduledAt.toISOString()} /></>}
                      </span>
                    </div>
                    <Link href={href} className="mt-1.5 block truncate text-sm font-medium hover:underline">{p.title}</Link>
                    {p.error ? <p className="mt-1 break-words text-xs text-bad">{p.error}</p> : null}
                    {p.note ? <p className="mt-1 text-xs text-muted">{p.note}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-start gap-1.5">
                    {p.externalUrl ? (
                      <a href={p.externalUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-xl border border-line bg-surface-2 px-3 text-xs font-semibold hover:border-line-strong">
                        Voir <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                    {p.status === "QUEUED" ? (
                      <form action={cancelPublication}>
                        <input type="hidden" name="id" value={p.id} />
                        <Button type="submit" size="sm" variant="ghost"><X className="size-3.5" /> Annuler</Button>
                      </form>
                    ) : null}
                    {p.status === "FAILED" || p.status === "CANCELED" ? (
                      <form action={retryPublication}>
                        <input type="hidden" name="id" value={p.id} />
                        <Button type="submit" size="sm"><RotateCcw className="size-3.5" /> Relancer</Button>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
