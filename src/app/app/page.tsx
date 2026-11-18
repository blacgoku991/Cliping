import Link from "next/link";
import { Clapperboard, Radio, Send, Sparkles } from "lucide-react";
import { SourceIcon } from "@/components/brand";
import { AutoRefresh } from "@/components/client";
import { ClipCard } from "@/components/clip-card";
import { Card, CardHeader, EmptyState, LinkButton, LiveBadge, Notice, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { ago, duration } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { getWorkerStatus } from "@/lib/worker-status";

function Stat({ label, value, hint, href, icon }: { label: string; value: number; hint: string; href: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="rounded-2xl border border-line bg-surface p-5 transition hover:border-line-strong">
      <div className="flex items-center justify-between text-muted">
        <span className="text-sm">{label}</span>
        {icon}
      </div>
      <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-faint">{hint}</p>
    </Link>
  );
}

export default async function Dashboard() {
  const user = await requireUser();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [streamerCount, recordings, toReview, queued, published, recent, accounts, worker] = await Promise.all([
    db.streamer.count({ where: { userId: user.id } }),
    db.recording.findMany({
      where: { userId: user.id, status: "RECORDING" },
      include: { streamer: true, _count: { select: { clips: true } } },
      orderBy: { startedAt: "desc" },
    }),
    db.clip.count({ where: { userId: user.id, status: "READY" } }),
    db.publication.count({ where: { userId: user.id, status: { in: ["QUEUED", "UPLOADING", "PROCESSING"] } } }),
    db.publication.count({ where: { userId: user.id, status: "PUBLISHED", publishedAt: { gte: weekAgo } } }),
    db.clip.findMany({
      where: { userId: user.id, status: { in: ["READY", "PROCESSING", "APPROVED"] } },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { streamer: { select: { displayName: true, platform: true } }, recording: { select: { author: true } }, publications: { select: { status: true } } },
    }),
    db.socialAccount.count({ where: { userId: user.id } }),
    getWorkerStatus(),
  ]);

  return (
    <>
      <AutoRefresh seconds={10} />
      <PageHeader
        title={`Salut${user.name ? ` ${user.name}` : ""} 👋`}
        subtitle="Le bot surveille tes streamers et te prépare les clips. Voici où tu en es."
        action={toReview > 0 ? <LinkButton href="/app/clips" variant="primary">Valider {toReview} clip{toReview > 1 ? "s" : ""}</LinkButton> : undefined}
      />

      {!worker.online ? (
        <Notice tone="warn" className="mb-6">
          <strong>Le bot ne tourne pas.</strong> Aucun live ne sera capté tant que le worker est arrêté
          {worker.lastSeen ? ` (vu pour la dernière fois ${ago(worker.lastSeen)})` : ""}. Lance-le avec <code className="rounded bg-black/30 px-1.5 py-0.5">docker compose up -d</code> ou <code className="rounded bg-black/30 px-1.5 py-0.5">npm run worker</code>.
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lives captés" value={recordings.length} hint="en ce moment" href="/app/streamers" icon={<Radio className="size-4" />} />
        <Stat label="À valider" value={toReview} hint="clips prêts" href="/app/clips" icon={<Clapperboard className="size-4" />} />
        <Stat label="En file" value={queued} hint="publications programmées" href="/app/queue" icon={<Send className="size-4" />} />
        <Stat label="Publiés" value={published} hint="sur 7 jours" href="/app/queue" icon={<Sparkles className="size-4" />} />
      </div>

      {streamerCount === 0 || accounts === 0 ? (
        <Card className="mt-6">
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

      {recordings.length > 0 ? (
        <Card className="mt-6">
          <CardHeader title="En cours de capture" />
          <ul className="divide-y divide-line">
            {recordings.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <LiveBadge />
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  {r.streamer ? <SourceIcon platform={r.streamer.platform} className="size-4 shrink-0" /> : null}
                  <span className="truncate">{r.streamer?.displayName ?? r.author ?? "Live"}</span>
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{[r.category, r.title].filter(Boolean).join(" · ")}</span>
                <span className="text-xs tabular-nums text-faint">{duration(r.durationSec)} analysées · {r._count.clips} clip{r._count.clips > 1 ? "s" : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Derniers clips</h2>
        {recent.length > 0 ? <Link href="/app/clips" className="text-sm font-medium text-brand hover:underline">Tout voir</Link> : null}
      </div>
      {recent.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {recent.map((c) => <ClipCard key={c.id} clip={c} />)}
        </div>
      ) : (
        <Card className="mt-4">
          <EmptyState icon={<Clapperboard className="size-6" />} title="Pas encore de clip">
            Dès qu&apos;un de tes streamers passe en live, les moments forts apparaîtront ici, déjà montés. Tu peux aussi importer une VOD pour tester tout de suite.
          </EmptyState>
        </Card>
      )}
    </>
  );
}
