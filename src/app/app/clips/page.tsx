import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Clapperboard, Layers } from "lucide-react";
import { AutoRefresh } from "@/components/client";
import { clipStatus } from "@/components/clip-card";
import { ClipTile } from "@/components/clip-tile";
import { Card, EmptyState, LinkButton, PageHeader, cx } from "@/components/ui";
import { db } from "@/lib/db";
import { ago, clock } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Clips" };

const TABS = [
  { key: "review", label: "À valider" },
  { key: "approved", label: "Approuvés" },
  { key: "published", label: "Publiés" },
  { key: "rejected", label: "Écartés" },
  { key: "all", label: "Tous" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const PAGE_SIZE = 48;

function whereFor(tab: TabKey, userId: string): Prisma.ClipWhereInput {
  const live: Prisma.PublicationWhereInput = { status: { in: ["QUEUED", "UPLOADING", "PROCESSING", "PUBLISHED"] } };
  switch (tab) {
    case "review":
      return { userId, status: { in: ["READY", "PROCESSING", "FAILED"] } };
    case "approved":
      return { userId, status: "APPROVED", publications: { none: live } };
    case "published":
      return { userId, publications: { some: live } };
    case "rejected":
      return { userId, status: "REJECTED" };
    default:
      return { userId };
  }
}

export default async function ClipsPage({ searchParams }: { searchParams: Promise<{ tab?: string; sort?: string; page?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "review";
  const sort = sp.sort === "score" ? "score" : "recent";
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));

  const [clips, counts] = await Promise.all([
    db.clip.findMany({
      where: whereFor(tab, user.id),
      orderBy: sort === "score" ? [{ score: "desc" }, { createdAt: "desc" }] : { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      include: { streamer: { select: { displayName: true, platform: true } }, recording: { select: { author: true } }, publications: { select: { status: true } } },
    }),
    Promise.all(TABS.map((t) => db.clip.count({ where: whereFor(t.key, user.id) }))),
  ]);
  const hasMore = clips.length > PAGE_SIZE;
  const link = (params: Record<string, string | number>) => `/app/clips?${new URLSearchParams({ tab, sort, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) })}`;

  return (
    <>
      <AutoRefresh seconds={10} />
      <PageHeader
        title="Clips"
        subtitle="Les moments forts repérés par le bot, déjà montés. Trie-les directement depuis la carte, ou ouvre un clip pour le retoucher et le publier."
        action={counts[0] ? <LinkButton href="/app/review" variant="primary"><Layers className="size-4" /> Mode validation · {counts[0]}</LinkButton> : undefined}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1" role="tablist">
          {TABS.map((t, i) => (
            <Link
              key={t.key}
              href={`/app/clips?tab=${t.key}&sort=${sort}`}
              role="tab"
              aria-selected={t.key === tab}
              className={cx(
                "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition",
                t.key === tab ? "bg-surface-2 text-ink" : "text-muted hover:text-ink",
              )}
            >
              {t.label}
              <span className="text-xs tabular-nums text-faint">{counts[i]}</span>
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1 text-sm">
          <span className="mr-1 text-faint">Trier :</span>
          <Link href={link({ sort: "recent", page: 1 })} className={cx("rounded-lg px-2.5 py-1.5 font-medium", sort === "recent" ? "bg-surface-2 text-ink" : "text-muted hover:text-ink")}>Récents</Link>
          <Link href={link({ sort: "score", page: 1 })} className={cx("rounded-lg px-2.5 py-1.5 font-medium", sort === "score" ? "bg-surface-2 text-ink" : "text-muted hover:text-ink")}>Meilleur score</Link>
        </div>
      </div>

      {clips.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Clapperboard className="size-6" />}
            title={tab === "review" ? "Rien à valider pour l'instant" : "Aucun clip ici"}
            action={tab === "review" ? <LinkButton href="/app/streamers" variant="primary">Ajouter un streamer ou importer une VOD</LinkButton> : undefined}
          >
            {tab === "review"
              ? "Les clips arrivent tout seuls dès qu'un streamer que tu suis est en live. Pour tester sans attendre, importe une VOD."
              : "Change d'onglet pour voir tes autres clips."}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {clips.slice(0, PAGE_SIZE).map((c) => {
            const st = clipStatus(c);
            return (
              <ClipTile
                key={c.id}
                clip={{
                  id: c.id,
                  status: c.status,
                  title: c.title,
                  score: c.score,
                  durationLabel: clock(c.endSec - c.startSec),
                  agoLabel: ago(c.createdAt),
                  hasFinal: c.hasFinal,
                  version: c.renderedAt?.getTime() ?? 0,
                  author: c.streamer?.displayName ?? c.recording?.author ?? "Import",
                  platform: c.streamer?.platform ?? null,
                  statusLabel: st.label,
                  statusTone: st.tone,
                }}
              />
            );
          })}
        </div>
      )}

      {page > 1 || hasMore ? (
        <div className="mt-6 flex justify-center gap-2">
          {page > 1 ? <LinkButton href={link({ page: page - 1 })}>← Précédents</LinkButton> : null}
          {hasMore ? <LinkButton href={link({ page: page + 1 })}>Suivants →</LinkButton> : null}
        </div>
      ) : null}
    </>
  );
}
