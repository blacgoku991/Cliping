"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, ChevronRight, Clapperboard, Layers, Loader2, Send, Sparkles, X } from "lucide-react";
import { reviewClip } from "@/app/actions/review";
import { SourceIcon } from "./brand";
import { PhonePreview, type PhoneClip } from "./phone-preview";
import { Badge, ScoreBadge, buttonClass, cx } from "./ui";

export interface StageClip extends PhoneClip {
  score: number;
  status: string;
  platform: string | null;
  durationLabel: string;
  agoLabel: string;
}

/**
 * Cœur du tableau de bord : le téléphone qui joue le clip choisi, et la file « à valider »
 * où un clic charge le clip dans le téléphone.
 */
export function DashboardStage({ featured, queue, toReview }: { featured: StageClip | null; queue: StageClip[]; toReview: number }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(featured?.id ?? queue[0]?.id ?? null);
  const [decided, setDecided] = useState<Record<string, "APPROVED" | "REJECTED">>({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const all = featured && !queue.some((c) => c.id === featured.id) ? [featured, ...queue] : queue;
  const current = all.find((c) => c.id === selectedId) ?? featured ?? queue[0] ?? null;
  const pendingQueue = queue.filter((c) => !decided[c.id]);
  const isFeatured = !!featured && current?.id === featured.id;
  const status = current ? (decided[current.id] ?? current.status) : null;

  const decide = (id: string, s: "APPROVED" | "REJECTED") => {
    setError(null);
    setDecided((d) => ({ ...d, [id]: s }));
    // Passe au clip suivant de la file
    const next = pendingQueue.find((c) => c.id !== id);
    if (next) setSelectedId(next.id);
    startTransition(async () => {
      const res = await reviewClip(id, s);
      if (res.error) {
        setError(res.error);
        setDecided((d) => {
          const rest = { ...d };
          delete rest[id];
          return rest;
        });
      }
      router.refresh();
    });
  };

  return (
    <div className="grid gap-6 md:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* Téléphone */}
      <div className="min-w-0">
        <PhonePreview
          key={current?.id ?? "vide"}
          clip={current}
          size="md"
          empty={
            <span className="flex flex-col items-center gap-3 px-4">
              <span className="brand-gradient grid size-12 place-items-center rounded-2xl text-white"><Sparkles className="size-6" /></span>
              <span className="font-display text-xl tracking-wide text-ink">TON PROCHAIN CLIP</span>
              <span className="text-xs leading-relaxed">Dès qu&apos;un live passe, le meilleur moment s&apos;affiche ici, tel qu&apos;il sortira sur TikTok.</span>
            </span>
          }
        />
      </div>

      {/* Infos du clip + file */}
      <div className="flex min-w-0 flex-col gap-5">
        {current ? (
          <div className="rise-in rounded-2xl border border-line bg-bg/60 p-4" key={current.id}>
            <div className="flex flex-wrap items-center gap-2">
              {isFeatured ? <Badge tone="brand"><Sparkles className="size-3" /> Meilleur clip récent</Badge> : null}
              <ScoreBadge score={current.score} />
              {status === "APPROVED" ? <Badge tone="ok">Approuvé</Badge> : status === "REJECTED" ? <Badge>Écarté</Badge> : status === "READY" ? <Badge tone="violet">À valider</Badge> : null}
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                {current.platform ? <SourceIcon platform={current.platform} className="size-3.5 shrink-0" /> : null}
                <span className="truncate">{current.author}</span> · {current.durationLabel} · {current.agoLabel}
              </span>
            </div>
            <h3 className="mt-2.5 line-clamp-2 text-lg font-bold leading-snug">{current.title || "Titre en cours de génération…"}</h3>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/app/clips/${current.id}`} className={buttonClass({ variant: "primary", size: "md" })}>
                <Send className="size-4" /> Ouvrir pour publier
              </Link>
              {status === "READY" ? (
                <>
                  <button type="button" disabled={pending} onClick={() => decide(current.id, "APPROVED")} className={buttonClass({ variant: "secondary" })}>
                    <Check className="size-4 text-ok" /> Approuver
                  </button>
                  <button type="button" disabled={pending} onClick={() => decide(current.id, "REJECTED")} className={buttonClass({ variant: "ghost" })}>
                    <X className="size-4" /> Écarter
                  </button>
                </>
              ) : null}
            </div>
            {error ? <p role="alert" className="mt-3 text-sm text-bad">{error}</p> : null}
          </div>
        ) : null}

        <div className="min-w-0">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Layers className="size-4 text-brand" /> À valider
              <span className="rounded-full bg-surface-2 px-2 text-xs tabular-nums text-muted">{Math.max(0, toReview - Object.keys(decided).length)}</span>
              {pending ? <Loader2 className="size-3.5 animate-spin text-faint" aria-label="Enregistrement…" /> : null}
            </h2>
            {toReview > 0 ? (
              <Link href="/app/review" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
                Mode validation <ChevronRight className="size-4" />
              </Link>
            ) : null}
          </div>
          {pendingQueue.length > 0 ? (
            <ul className="grid gap-1.5" aria-label="Clips à valider">
              {pendingQueue.slice(0, 6).map((c, i) => {
                const active = c.id === current?.id;
                return (
                  <li key={c.id} className="rise-in" style={{ animationDelay: `${i * 50}ms` }}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      aria-pressed={active}
                      className={cx(
                        "group flex w-full items-center gap-3 rounded-xl border p-2 text-left transition",
                        active ? "border-brand/50 bg-brand/[0.07]" : "border-transparent hover:border-line hover:bg-surface-2/60",
                      )}
                    >
                      <span className="relative h-14 w-8 shrink-0 overflow-hidden rounded-md bg-surface-2">
                        {c.hasFinal ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/media/${c.id}/thumb.jpg?v=${c.version}`} alt="" loading="lazy" className="size-full object-cover" />
                        ) : <Clapperboard className="m-auto mt-4 size-4 text-faint" />}
                        {active ? <span className="absolute inset-0 ring-2 ring-inset ring-brand" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-1 text-sm font-semibold">{c.title || "Titre en cours…"}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                          {c.platform ? <SourceIcon platform={c.platform} className="size-3 shrink-0" /> : null}
                          <span className="truncate">{c.author}</span>
                          <span className="shrink-0 text-faint">· {c.agoLabel}</span>
                        </span>
                      </span>
                      <ScoreBadge score={c.score} className="shrink-0" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
              {queue.length > 0 ? "Tout est trié pour l'instant. 🎉" : "Rien à valider pour l'instant. Les nouveaux clips arrivent ici dès qu'un live passe."}
            </p>
          )}
          {toReview > 6 ? (
            <Link href="/app/review" className={buttonClass({ variant: "secondary", size: "sm" }, "mt-3 w-full")}>
              Trier les {toReview} clips en mode validation
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
