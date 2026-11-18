import type { Metadata } from "next";
import Link from "next/link";
import { Ban, CalendarClock, CheckCircle2, CirclePause, CirclePlay, OctagonX, Play, ScrollText, Settings2, SkipForward } from "lucide-react";
import { AutoRefresh, LocalTime } from "@/components/client";
import { Badge, Card, cx, EmptyState } from "@/components/ui";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Journal du pilote" };

const KINDS: Record<string, { icon: typeof Play; tone: string; label: string }> = {
  approve: { icon: CheckCircle2, tone: "text-ok", label: "Approbation" },
  schedule: { icon: CalendarClock, tone: "text-brand", label: "Programmation" },
  skip: { icon: SkipForward, tone: "text-faint", label: "Laissé de côté" },
  pause: { icon: CirclePause, tone: "text-warn", label: "Pause" },
  resume: { icon: CirclePlay, tone: "text-ok", label: "Reprise" },
  start: { icon: Play, tone: "text-ok", label: "Démarrage" },
  stop: { icon: OctagonX, tone: "text-bad", label: "Arrêt" },
  cancel: { icon: Ban, tone: "text-muted", label: "Annulation" },
  config: { icon: Settings2, tone: "text-muted", label: "Règles" },
};

const FILTERS = [
  { key: "", label: "Tout" },
  { key: "real", label: "Pour de vrai" },
  { key: "sim", label: "Simulation" },
];

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const user = await requireUser();
  const f = (await searchParams).f ?? "";
  const logs = await db.autopilotLog.findMany({
    where: { userId: user.id, ...(f === "sim" ? { dryRun: true } : f === "real" ? { dryRun: false } : {}) },
    orderBy: { at: "desc" },
    take: 300,
  });
  const ap = await db.autopilot.findUnique({ where: { userId: user.id }, select: { enabled: true } });

  return (
    <>
      {ap?.enabled ? <AutoRefresh seconds={20} /> : null}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((x) => (
          <Link
            key={x.key}
            href={x.key ? `/app/autopilot/journal?f=${x.key}` : "/app/autopilot/journal"}
            aria-current={f === x.key ? "page" : undefined}
            className={cx("rounded-full border px-3 py-1 text-xs font-semibold", f === x.key ? "border-brand/40 bg-brand/12 text-brand" : "border-line text-muted hover:text-ink")}
          >
            {x.label}
          </Link>
        ))}
        <span className="ml-auto text-xs text-faint">300 dernières lignes</span>
      </div>
      <Card>
        {logs.length === 0 ? (
          <EmptyState icon={<ScrollText className="size-6" />} title="Rien pour l'instant">
            Chaque décision du pilote (et chaque arrêt, reprise ou annulation) s'inscrit ici, avec sa raison.
          </EmptyState>
        ) : (
          <ol className="divide-y divide-line">
            {logs.map((l) => {
              const k = KINDS[l.kind] ?? KINDS.config!;
              const Icon = k.icon;
              return (
                <li key={l.id} className="flex gap-3 px-4 py-3 sm:px-5">
                  <Icon className={cx("mt-0.5 size-4 shrink-0", k.tone)} aria-label={k.label} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed">{l.message}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-faint">
                      <LocalTime iso={l.at.toISOString()} />
                      {l.dryRun ? <Badge tone="violet" className="py-0">simulation</Badge> : null}
                      {l.clipId ? <Link href={`/app/clips/${l.clipId}`} className="hover:text-ink hover:underline">voir le clip</Link> : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </>
  );
}
