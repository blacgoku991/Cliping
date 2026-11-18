import Link from "next/link";
import { LogOut } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { Logo } from "@/components/brand";
import { BottomNav, SideNav } from "@/components/nav";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getWorkerStatus } from "@/lib/worker-status";

export const dynamic = "force-dynamic";

function WorkerPill({ online, recordings }: { online: boolean; recordings: number }) {
  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-line bg-bg px-3 py-2 text-xs"
      title={online ? "Le worker tourne et surveille tes chaînes" : "Le worker ne répond pas : lance-le pour capter les lives"}
    >
      <span className={online ? "live-dot size-2 rounded-full bg-ok" : "size-2 rounded-full bg-bad"} />
      <span className="font-medium">{online ? "Bot actif" : "Bot à l'arrêt"}</span>
      {online && recordings > 0 ? <span className="text-muted">· {recordings} live{recordings > 1 ? "s" : ""}</span> : null}
    </div>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [toReview, failedPubs, worker] = await Promise.all([
    db.clip.count({ where: { userId: user.id, status: "READY" } }),
    db.publication.count({ where: { userId: user.id, status: "FAILED" } }),
    getWorkerStatus(),
  ]);
  const badges = { "/app/review": toReview, "/app/queue": failedPubs };

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface px-4 py-5 lg:flex">
        <Link href="/app" className="mb-7 px-2"><Logo /></Link>
        <SideNav badges={badges} />
        <div className="mt-auto space-y-3">
          <WorkerPill online={worker.online} recordings={worker.recordings} />
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="min-w-0 truncate text-xs text-muted" title={user.email}>{user.name || user.email}</span>
            <form action={logout}>
              <button type="submit" className="rounded-lg p-2 text-faint transition hover:bg-surface-2 hover:text-ink" aria-label="Se déconnecter" title="Se déconnecter">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-bg/90 px-4 pb-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur lg:hidden">
          <Link href="/app"><Logo className="text-xl" /></Link>
          <div className="flex items-center gap-2">
            <WorkerPill online={worker.online} recordings={worker.recordings} />
            <form action={logout}>
              <button type="submit" className="rounded-lg p-2 text-faint hover:text-ink" aria-label="Se déconnecter"><LogOut className="size-4" /></button>
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">{children}</main>
      </div>
      <BottomNav badges={badges} />
    </div>
  );
}
