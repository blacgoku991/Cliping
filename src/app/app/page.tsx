import Link from "next/link";
import { Activity, Clapperboard, Flame, Layers, Radio, Send, Sparkles, Trophy } from "lucide-react";
import { SourceIcon } from "@/components/brand";
import { ActivityByDay, CountUp, IntensityChart, ScoreHistogram, Sparkline, type IntensityData } from "@/components/charts";
import { AutoRefresh } from "@/components/client";
import { DashboardStage, type StageClip } from "@/components/dashboard-stage";
import { Card, CardHeader, LinkButton, LiveBadge, Notice, cx } from "@/components/ui";
import { db } from "@/lib/db";
import { ago, clock, duration } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { getWorkerStatus } from "@/lib/worker-status";

const DAY = 86_400_000;

type ClipRow = {
  id: string;
  title: string;
  hashtags: string[];
  score: number;
  status: string;
  hasFinal: boolean;
  renderedAt: Date | null;
  createdAt: Date;
  startSec: number;
  endSec: number;
  streamer: { displayName: string; platform: string } | null;
  recording: { author: string | null } | null;
};

function toStage(c: ClipRow): StageClip {
  return {
    id: c.id,
    title: c.title,
    hashtags: c.hashtags,
    author: c.streamer?.displayName ?? c.recording?.author ?? "Import",
    hasFinal: c.hasFinal,
    version: c.renderedAt?.getTime() ?? 0,
    score: c.score,
    status: c.status,
    platform: c.streamer?.platform ?? null,
    durationLabel: clock(c.endSec - c.startSec),
    agoLabel: ago(c.createdAt),
  };
}

function parseIntensity(v: unknown): IntensityData | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.points) || typeof o.from !== "number" || typeof o.step !== "number" || typeof o.threshold !== "number") return null;
  return { from: o.from, step: o.step, threshold: o.threshold, points: o.points.filter((p): p is number => typeof p === "number") };
}

/** Compte par tranche de 24 h glissantes (indépendant du fuseau), du plus ancien au plus récent. */
function rolling(times: Date[], days: number, now: number): number[] {
  const out = new Array<number>(days).fill(0);
  for (const t of times) {
    const k = Math.floor((now - t.getTime()) / DAY);
    if (k >= 0 && k < days) out[days - 1 - k]!++;
  }
  return out;
}

function Kpi({ label, value, hint, href, icon, trend, accent, delay }: {
  label: string; value: number; hint: string; href: string; icon: React.ReactNode; trend?: number[]; accent?: boolean; delay: number;
}) {
  return (
    <Link
      href={href}
      style={{ animationDelay: `${delay}ms` }}
      className={cx(
        "rise-in group relative overflow-hidden rounded-2xl border p-4 transition hover:-translate-y-0.5",
        accent ? "border-brand/40 bg-brand/[0.07] hover:border-brand/70" : "border-line bg-bg/50 hover:border-line-strong",
      )}
    >
      <div className="flex items-center justify-between gap-2 text-muted">
        <span className="text-xs font-medium">{label}</span>
        <span className={cx("grid size-7 place-items-center rounded-lg", accent ? "brand-gradient text-white" : "bg-surface-2")}>{icon}</span>
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl"><CountUp value={value} /></p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className="text-xs text-faint">{hint}</p>
        {trend ? <Sparkline values={trend} label={`${label} sur 14 jours`} className="hidden sm:block" /> : null}
      </div>
    </Link>
  );
}

export default async function Dashboard() {
  const user = await requireUser();
  const now = Date.now();
  const since14 = new Date(now - 14 * DAY);
  const since30 = new Date(now - 30 * DAY);
  const since7 = new Date(now - 7 * DAY);
  const clipSelect = {
    id: true, title: true, hashtags: true, score: true, status: true, hasFinal: true, renderedAt: true, createdAt: true, startSec: true, endSec: true,
    streamer: { select: { displayName: true, platform: true } },
    recording: { select: { author: true } },
  } as const;

  const [streamerCount, accounts, worker, toReview, queued, recordings, queue, bestRecent, latest, made14, posted14, scores30, byStreamer, postedByStreamer, captured] = await Promise.all([
    db.streamer.count({ where: { userId: user.id } }),
    db.socialAccount.count({ where: { userId: user.id } }),
    getWorkerStatus(),
    db.clip.count({ where: { userId: user.id, status: "READY" } }),
    db.publication.count({ where: { userId: user.id, status: { in: ["QUEUED", "UPLOADING", "PROCESSING"] } } }),
    db.recording.findMany({
      where: { userId: user.id, status: "RECORDING" },
      include: {
        streamer: { select: { displayName: true, platform: true } },
        clips: { select: { id: true, title: true, score: true, originSec: true, peakSec: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { startedAt: "desc" },
    }),
    db.clip.findMany({ where: { userId: user.id, status: "READY", hasFinal: true }, orderBy: [{ score: "desc" }, { createdAt: "desc" }], take: 8, select: clipSelect }),
    db.clip.findFirst({
      where: { userId: user.id, hasFinal: true, status: { in: ["READY", "APPROVED"] }, createdAt: { gte: since7 } },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      select: clipSelect,
    }),
    db.clip.findFirst({ where: { userId: user.id, hasFinal: true, status: { not: "REJECTED" } }, orderBy: { createdAt: "desc" }, select: clipSelect }),
    db.clip.findMany({ where: { userId: user.id, createdAt: { gte: since14 } }, select: { createdAt: true } }),
    db.publication.findMany({ where: { userId: user.id, status: "PUBLISHED", publishedAt: { gte: since14 } }, select: { publishedAt: true } }),
    db.clip.findMany({ where: { userId: user.id, createdAt: { gte: since30 }, status: { in: ["READY", "APPROVED", "REJECTED"] } }, select: { score: true } }),
    db.clip.groupBy({ by: ["streamerId"], where: { userId: user.id, createdAt: { gte: since30 }, streamerId: { not: null } }, _count: { _all: true }, _max: { score: true } }),
    db.publication.findMany({ where: { userId: user.id, status: "PUBLISHED", publishedAt: { gte: since30 } }, select: { clip: { select: { streamerId: true } } } }),
    db.recording.findMany({
      where: { userId: user.id, startedAt: { gte: since7 }, status: { in: ["RECORDING", "DONE", "PROCESSING"] }, durationSec: { gt: 0 } },
      orderBy: { startedAt: "desc" },
      take: 6,
      include: {
        streamer: { select: { displayName: true, platform: true } },
        clips: { select: { id: true, title: true, score: true, originSec: true, peakSec: true } },
      },
    }),
  ]);

  const featured = bestRecent ?? latest;
  const postedTimes = posted14.map((p) => p.publishedAt).filter((d): d is Date => !!d);
  const madeTrend = rolling(made14.map((c) => c.createdAt), 14, now);
  const postedTrend = rolling(postedTimes, 14, now);
  const published7 = postedTrend.slice(-7).reduce((a, b) => a + b, 0);

  const bins = new Array<number>(10).fill(0);
  for (const { score } of scores30) bins[Math.min(9, Math.floor(score / 10))]!++;
  const strong = scores30.filter((c) => c.score >= 75).length;

  const streamerIds = byStreamer.map((s) => s.streamerId).filter((id): id is string => !!id);
  const names = streamerIds.length
    ? await db.streamer.findMany({ where: { id: { in: streamerIds }, userId: user.id }, select: { id: true, displayName: true, platform: true } })
    : [];
  const postedCount = new Map<string, number>();
  for (const p of postedByStreamer) if (p.clip.streamerId) postedCount.set(p.clip.streamerId, (postedCount.get(p.clip.streamerId) ?? 0) + 1);
  const top = byStreamer
    .map((s) => ({ ...names.find((n) => n.id === s.streamerId), id: s.streamerId!, clips: s._count._all, best: s._max.score ?? 0, posted: postedCount.get(s.streamerId!) ?? 0 }))
    .filter((s) => s.displayName)
    .sort((a, b) => b.clips - a.clips)
    .slice(0, 6);
  const topMax = Math.max(1, ...top.map((s) => s.clips));
  const hasHistory = made14.length > 0 || scores30.length > 0 || captured.length > 0;
  const capturedMax = Math.max(1, ...captured.map((r) => r.durationSec));

  return (
    <>
      <AutoRefresh seconds={recordings.length > 0 ? 8 : 15} />

      {/* En-tête */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted">{`Salut${user.name ? ` ${user.name}` : ""} 👋`}</p>
          <h1 className="mt-1 font-display text-4xl leading-none tracking-wide sm:text-5xl">
            {recordings.length > 0 ? <><span className="brand-text">{recordings.length} LIVE{recordings.length > 1 ? "S" : ""}</span> EN CAPTURE</> : toReview > 0 ? <><span className="brand-text">{toReview} CLIP{toReview > 1 ? "S" : ""}</span> À VALIDER</> : "TON QG DE CLIPS"}
          </h1>
        </div>
        {toReview > 0 ? (
          <LinkButton href="/app/review" variant="primary" size="lg">
            <Layers className="size-5" /> Mode validation
          </LinkButton>
        ) : null}
      </div>

      {!worker.online ? (
        <Notice tone="warn" className="mb-6">
          <strong>Le bot ne tourne pas.</strong> Aucun live ne sera capté tant que le worker est arrêté
          {worker.lastSeen ? ` (vu pour la dernière fois ${ago(worker.lastSeen)})` : ""}. Lance-le avec <code className="rounded bg-black/30 px-1.5 py-0.5">docker compose up -d</code> ou <code className="rounded bg-black/30 px-1.5 py-0.5">npm run worker</code>.
        </Notice>
      ) : null}

      {streamerCount === 0 || accounts === 0 ? (
        <Card className="glass mb-6 overflow-hidden">
          <CardHeader title="Pour démarrer" hint="Deux étapes et le bot travaille tout seul." />
          <ol className="divide-y divide-line">
            <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="font-medium">{streamerCount > 0 ? "✅" : "1."} Ajoute les streamers à surveiller</p>
                <p className="text-sm text-muted">Leurs lives seront enregistrés et découpés automatiquement.</p>
              </div>
              <LinkButton href="/app/streamers" variant={streamerCount > 0 ? "secondary" : "primary"} size="sm">{streamerCount > 0 ? "Gérer" : "Ajouter un streamer"}</LinkButton>
            </li>
            <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="font-medium">{accounts > 0 ? "✅" : "2."} Connecte tes comptes TikTok et YouTube</p>
                <p className="text-sm text-muted">Pour publier en un clic. En attendant, tu peux déjà télécharger les clips.</p>
              </div>
              <LinkButton href="/app/accounts" variant={accounts > 0 ? "secondary" : "primary"} size="sm">{accounts > 0 ? "Gérer" : "Connecter un compte"}</LinkButton>
            </li>
          </ol>
        </Card>
      ) : null}

      {/* Indicateurs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi delay={0} label="Lives captés" value={recordings.length} hint={`en ce moment · ${streamerCount} suivi${streamerCount > 1 ? "s" : ""}`} href="/app/streamers" icon={<Radio className="size-3.5" />} accent={recordings.length > 0} />
        <Kpi delay={60} label="À valider" value={toReview} hint="clips prêts" href="/app/review" icon={<Clapperboard className="size-3.5" />} trend={madeTrend} accent={recordings.length === 0 && toReview > 0} />
        <Kpi delay={120} label="En file" value={queued} hint="publications programmées" href="/app/queue" icon={<Send className="size-3.5" />} />
        <Kpi delay={180} label="En ligne" value={published7} hint="publiés sur 7 jours" href="/app/queue" icon={<Sparkles className="size-3.5" />} trend={postedTrend} />
      </div>

      {/* Scène : téléphone + file à valider */}
      <section aria-label="Aperçu et clips à valider" className="glass hero-glow mt-6 rounded-3xl border border-line p-4 sm:p-6">
        <DashboardStage featured={featured ? toStage(featured) : null} queue={queue.map(toStage)} toReview={toReview} />
      </section>

      {/* Lives en cours */}
      {recordings.length > 0 ? (
        <section className="mt-8" aria-labelledby="lives-title">
          <h2 id="lives-title" className="mb-3 flex items-center gap-2 text-lg font-semibold"><Activity className="size-5 text-brand" /> En direct</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {recordings.map((r) => {
              const data = parseIntensity(r.intensity);
              const markers = r.clips.map((c) => ({ id: c.id, at: c.originSec + c.peakSec, score: c.score, title: c.title }));
              const last = data?.points[data.points.length - 1] ?? 0;
              const hot = data ? last >= data.threshold * 0.8 : false;
              return (
                <Card key={r.id} className="glass overflow-hidden">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 pt-4">
                    <LiveBadge />
                    <span className="flex min-w-0 items-center gap-2 font-semibold">
                      {r.streamer ? <SourceIcon platform={r.streamer.platform} className="size-4 shrink-0" /> : null}
                      <span className="truncate">{r.streamer?.displayName ?? r.author ?? "Live"}</span>
                    </span>
                    {hot ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-2"><Flame className="size-3.5" /> ça chauffe</span> : null}
                    <span className="ml-auto text-xs tabular-nums text-faint">{duration(r.durationSec)} · {r.clips.length} clip{r.clips.length > 1 ? "s" : ""}</span>
                  </div>
                  <p className="truncate px-5 pt-1 text-sm text-muted">{[r.category, r.title].filter(Boolean).join(" · ") || " "}</p>
                  <div className="px-3 pb-3 pt-2">
                    {data ? (
                      <IntensityChart data={data} markers={markers} />
                    ) : (
                      <div className="grid h-[120px] place-items-center rounded-xl border border-dashed border-line text-xs text-faint">La courbe d&apos;intensité arrive dans quelques secondes…</div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Visualisations */}
      {hasHistory ? (
        <section className="mt-8 grid gap-4 lg:grid-cols-5" aria-label="Statistiques">
          <Card className="glass lg:col-span-3">
            <CardHeader title="Activité des 14 derniers jours" hint="Clips sortis par le bot et vidéos parties en ligne, jour par jour." />
            <div className="p-5"><ActivityByDay made={made14.map((c) => c.createdAt.getTime())} posted={postedTimes.map((d) => d.getTime())} /></div>
          </Card>
          <Card className="glass lg:col-span-2">
            <CardHeader title="Répartition des scores" hint={<>30 derniers jours · <span className="text-ink">{strong}</span> clip{strong > 1 ? "s" : ""} à 75 ou plus</>} />
            <div className="p-5">
              {scores30.length > 0 ? <ScoreHistogram bins={bins} /> : <p className="py-10 text-center text-sm text-faint">Pas encore de clip noté.</p>}
            </div>
          </Card>

          <Card className="glass lg:col-span-2">
            <CardHeader title="Streamers les plus productifs" hint="Clips sur 30 jours" />
            {top.length > 0 ? (
              <ul className="space-y-3 p-5">
                {top.map((s, i) => (
                  <li key={s.id}>
                    <div className="mb-1 flex items-center gap-2 text-sm">
                      {i === 0 ? <Trophy className="size-3.5 shrink-0 text-warn" aria-label="Premier" /> : <span className="w-3.5 shrink-0 text-center text-xs text-faint">{i + 1}</span>}
                      {s.platform ? <SourceIcon platform={s.platform} className="size-3.5 shrink-0" /> : null}
                      <span className="min-w-0 flex-1 truncate font-medium">{s.displayName}</span>
                      <span className="shrink-0 text-xs text-muted"><span className="font-semibold tabular-nums text-ink">{s.clips}</span> clip{s.clips > 1 ? "s" : ""}{s.posted ? ` · ${s.posted} en ligne` : ""}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-2" title={`${s.clips} clips, meilleur score ${s.best}`}>
                      <div className="bar-grow-x h-full rounded-full brand-gradient" style={{ width: `${(s.clips / topMax) * 100}%`, animationDelay: `${i * 70}ms` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-10 text-center text-sm text-faint">Les streamers apparaîtront ici dès leurs premiers clips.</p>
            )}
          </Card>

          <Card className="glass lg:col-span-3">
            <CardHeader title="Lives captés" hint="7 derniers jours · chaque point est un moment fort découpé (survole pour le voir)" />
            {captured.length > 0 ? (
              <ul className="divide-y divide-line">
                {captured.map((r) => (
                  <li key={r.id} className="px-5 py-3">
                    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      {r.streamer ? <SourceIcon platform={r.streamer.platform} className="size-3.5 shrink-0" /> : null}
                      <span className="min-w-0 truncate font-medium">{r.streamer?.displayName ?? r.author ?? "Import"}</span>
                      {r.status === "RECORDING" ? <LiveBadge /> : <span className="text-xs text-faint">{r.source === "VOD" ? "replay" : "live"} · {ago(r.startedAt)}</span>}
                      <span className="ml-auto text-xs tabular-nums text-muted">{duration(r.durationSec)} · <span className="font-semibold text-ink">{r.clips.length}</span> moment{r.clips.length > 1 ? "s" : ""}</span>
                    </div>
                    {/* Frise : longueur proportionnelle à la durée, repères aux moments forts */}
                    <div className="relative h-5">
                      <div className="absolute inset-y-[7px] left-0 rounded-full bg-surface-2" style={{ width: `${Math.max(6, (r.durationSec / capturedMax) * 100)}%` }}>
                        {r.clips.map((c) => {
                          const pos = Math.min(100, Math.max(0, ((c.originSec + c.peakSec) / Math.max(1, r.durationSec)) * 100));
                          return (
                            <Link
                              key={c.id}
                              href={`/app/clips/${c.id}`}
                              className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2 p-1"
                              style={{ left: `${pos}%` }}
                              aria-label={`${c.title || "Clip"} — score ${c.score}, à ${clock(c.originSec + c.peakSec)}`}
                            >
                              <span className={cx("block size-3 rounded-full ring-2 ring-surface transition group-hover:scale-150 group-focus-visible:scale-150", c.score >= 75 ? "bg-brand" : "bg-violet")} />
                              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max max-w-[220px] -translate-x-1/2 rounded-lg border border-line-strong bg-bg/95 px-2.5 py-1.5 text-xs shadow-xl group-hover:block group-focus-visible:block">
                                <span className="line-clamp-2 font-semibold text-ink">{c.title || "Clip"}</span>
                                <span className="text-muted">🔥 {c.score} · à {clock(c.originSec + c.peakSec)}</span>
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-10 text-center text-sm text-faint">Aucun live capté ces 7 derniers jours.</p>
            )}
            <div className="flex flex-wrap gap-4 border-t border-line px-5 py-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-brand" /> score 75 ou plus</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-violet" /> moins de 75</span>
            </div>
          </Card>
        </section>
      ) : null}

    </>
  );
}
