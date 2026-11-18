"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, ChevronUp, Keyboard, Loader2, MessageSquare, PartyPopper, Send, Sparkles, Undo2, Volume2, X, Zap,
} from "lucide-react";
import { reviewClip } from "@/app/actions/review";
import { SourceIcon } from "./brand";
import { PhonePreview, type PhoneClip } from "./phone-preview";
import { Badge, ScoreBadge, buttonClass, cx } from "./ui";

export interface ReviewItem extends PhoneClip {
  score: number;
  status: string;
  platform: string | null;
  durationLabel: string;
  agoLabel: string;
  context: string;
  momentLabel: string;
  signals: { audio: number | null; chat: number | null; scene: number | null; ai: number | null; reason: string };
}

type Decision = "APPROVED" | "REJECTED";

function Signal({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | null }) {
  if (value === null) return null;
  const level = Math.min(100, Math.round((value / 6) * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted">{icon}{label}</span>
        <span className="tabular-nums text-faint">×{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="brand-gradient h-full rounded-full" style={{ width: `${level}%` }} /></div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-grid min-w-6 place-items-center rounded-md border border-line-strong bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-ink">{children}</kbd>;
}

/**
 * Parcours plein écran pour trier les clips à la chaîne :
 * ← écarter, → approuver, ↑ / ↓ clip précédent / suivant, Entrée pour ouvrir, Z pour annuler.
 * Sur téléphone : glisser le téléphone à gauche / à droite.
 */
export function ReviewDeck({ initial, startId, processing, sort }: { initial: ReviewItem[]; startId: string | null; processing: number; sort: "score" | "recent" }) {
  const router = useRouter();
  const [items, setItems] = useState<ReviewItem[]>(initial);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [history, setHistory] = useState<string[]>([]);
  const [index, setIndex] = useState(() => Math.max(0, initial.findIndex((c) => c.id === startId)));
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();
  const [fly, setFly] = useState<Decision | null>(null);
  const [drag, setDrag] = useState(0);
  const [showKeys, setShowKeys] = useState(false);
  const dragStart = useRef<{ x: number; y: number; id: number } | null>(null);
  const dragged = useRef(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Les nouveaux clips arrivés pendant le tri s'ajoutent à la fin, sans bousculer la position.
  useEffect(() => {
    setItems((prev) => {
      const known = new Set(prev.map((c) => c.id));
      const fresh = initial.filter((c) => !known.has(c.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, [initial]);

  const current = items[index] ?? null;
  const decidedCount = Object.keys(decisions).length;
  const remaining = items.filter((c) => !decisions[c.id]).length;
  const done = items.length > 0 && remaining === 0;
  const approved = Object.values(decisions).filter((d) => d === "APPROVED").length;

  // Précharge la miniature du clip suivant pour un passage instantané.
  useEffect(() => {
    const next = items[index + 1];
    if (next?.hasFinal) {
      const img = new Image();
      img.src = `/api/media/${next.id}/thumb.jpg?v=${next.version}`;
    }
  }, [items, index]);

  const nextUndecided = useCallback(
    (from: number, decided: Record<string, Decision>) => {
      for (let k = 1; k <= items.length; k++) {
        const i = (from + k) % items.length;
        if (!decided[items[i]!.id]) return i;
      }
      return from;
    },
    [items],
  );

  const decide = useCallback(
    (d: Decision) => {
      if (!current || fly) return;
      const id = current.id;
      setError(null);
      const nextDecisions = { ...decisions, [id]: d };
      const go = () => {
        setDecisions(nextDecisions);
        setHistory((h) => [...h, id]);
        setIndex(nextUndecided(index, nextDecisions));
        setFly(null);
        setDrag(0);
      };
      if (reduced.current) go();
      else {
        setFly(d);
        setTimeout(go, 220);
      }
      startTransition(async () => {
        const res = await reviewClip(id, d);
        if (res.error) {
          setError(res.error);
          setDecisions((prev) => {
            const copy = { ...prev };
            delete copy[id];
            return copy;
          });
        }
      });
    },
    [current, decisions, fly, index, nextUndecided],
  );

  const undo = useCallback(() => {
    const id = history[history.length - 1];
    if (!id) return;
    setHistory((h) => h.slice(0, -1));
    setDecisions((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    const i = items.findIndex((c) => c.id === id);
    if (i >= 0) setIndex(i);
    startTransition(async () => {
      const res = await reviewClip(id, "READY");
      if (res.error) setError(res.error);
    });
  }, [history, items]);

  const move = useCallback((delta: number) => setIndex((i) => Math.max(0, Math.min(items.length - 1, i + delta))), [items.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight") { e.preventDefault(); decide("APPROVED"); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); decide("REJECTED"); }
      else if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); move(-1); }
      else if (e.key === "z" || e.key === "Z") { e.preventDefault(); undo(); }
      else if (e.key === "Enter" && current && t?.tagName !== "BUTTON" && t?.tagName !== "A") router.push(`/app/clips/${current.id}`);
      else if (e.key === "?") setShowKeys((s) => !s);
      else if (e.key === "Escape") router.push("/app");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, move, undo, current, router]);

  // Bloque le défilement de la page derrière le mode plein écran.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const swipe = useMemo(
    () => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        dragStart.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        dragged.current = false;
      },
      onPointerMove: (e: React.PointerEvent) => {
        const s = dragStart.current;
        if (!s || s.id !== e.pointerId) return;
        const dx = e.clientX - s.x;
        if (!dragged.current && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(e.clientY - s.y)) dragged.current = true;
        if (dragged.current) setDrag(dx);
      },
      onPointerUp: (e: React.PointerEvent) => {
        const s = dragStart.current;
        dragStart.current = null;
        if (!s || !dragged.current) return;
        const dx = e.clientX - s.x;
        if (dx > 90) decide("APPROVED");
        else if (dx < -90) decide("REJECTED");
        else setDrag(0);
      },
      onPointerCancel: () => {
        dragStart.current = null;
        setDrag(0);
      },
      onClickCapture: (e: React.MouseEvent) => {
        // Un glissé ne doit pas aussi compter comme un clic (son / pause).
        if (dragged.current) {
          e.stopPropagation();
          e.preventDefault();
          dragged.current = false;
        }
      },
    }),
    [decide],
  );

  const offset = fly === "APPROVED" ? 600 : fly === "REJECTED" ? -600 : drag;
  const tilt = Math.max(-12, Math.min(12, offset / 25));
  const stamp = offset > 40 ? "APPROVED" : offset < -40 ? "REJECTED" : null;
  const stampOpacity = Math.min(1, Math.abs(offset) / 110);
  const decision = current ? decisions[current.id] : undefined;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label="Mode validation">
      <div aria-hidden className="hero-glow pointer-events-none absolute inset-0 opacity-70" />

      {/* Barre du haut */}
      <header className="relative z-10 flex items-center gap-3 border-b border-line/70 px-3 py-2.5 sm:px-5">
        <Link href="/app" className="grid size-9 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink" aria-label="Quitter le mode validation">
          <X className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h1 className="truncate font-display text-lg tracking-wide sm:text-xl">MODE VALIDATION</h1>
            {items.length > 0 ? <span className="shrink-0 text-xs tabular-nums text-muted">{Math.min(index + 1, items.length)} / {items.length}</span> : null}
            {saving ? <Loader2 className="size-3.5 shrink-0 animate-spin text-faint" aria-label="Enregistrement…" /> : null}
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Clips triés" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={decidedCount}>
            <div className="brand-gradient h-full rounded-full transition-[width] duration-300" style={{ width: `${items.length ? (decidedCount / items.length) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-1 rounded-xl border border-line bg-surface p-1 text-xs sm:flex" aria-label="Ordre">
          <Link href="/app/review?sort=score" className={cx("rounded-lg px-2.5 py-1 font-medium", sort === "score" ? "bg-surface-2 text-ink" : "text-muted hover:text-ink")}>Meilleurs</Link>
          <Link href="/app/review?sort=recent" className={cx("rounded-lg px-2.5 py-1 font-medium", sort === "recent" ? "bg-surface-2 text-ink" : "text-muted hover:text-ink")}>Récents</Link>
        </div>
        <button type="button" onClick={undo} disabled={history.length === 0} className={buttonClass({ variant: "ghost", size: "sm" }, "shrink-0")} title="Annuler la dernière décision (Z)">
          <Undo2 className="size-4" /> <span className="hidden sm:inline">Annuler</span>
        </button>
        <button type="button" onClick={() => setShowKeys((s) => !s)} aria-expanded={showKeys} className="hidden size-9 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink lg:grid" title="Raccourcis clavier (?)" aria-label="Raccourcis clavier">
          <Keyboard className="size-4" />
        </button>
      </header>

      {showKeys ? (
        <div className="rise-in absolute right-4 top-16 z-20 w-64 space-y-2 rounded-2xl border border-line bg-surface p-4 text-sm shadow-2xl">
          <p className="mb-1 font-semibold">Raccourcis</p>
          <p className="flex items-center justify-between text-muted">Approuver <Kbd><ArrowRight className="size-3" /></Kbd></p>
          <p className="flex items-center justify-between text-muted">Écarter <Kbd><ArrowLeft className="size-3" /></Kbd></p>
          <p className="flex items-center justify-between text-muted">Précédent / suivant <span className="flex gap-1"><Kbd><ArrowUp className="size-3" /></Kbd><Kbd><ArrowDown className="size-3" /></Kbd></span></p>
          <p className="flex items-center justify-between text-muted">Ouvrir pour publier <Kbd>Entrée</Kbd></p>
          <p className="flex items-center justify-between text-muted">Annuler <Kbd>Z</Kbd></p>
          <p className="flex items-center justify-between text-muted">Quitter <Kbd>Échap</Kbd></p>
        </div>
      ) : null}

      {items.length === 0 || done ? (
        <div className="relative z-10 grid flex-1 place-items-center overflow-y-auto px-6 py-10 text-center">
          <div className="rise-in max-w-md">
            <span className="brand-gradient mx-auto grid size-16 place-items-center rounded-3xl text-white shadow-[0_20px_60px_-15px_rgb(255_77_141/0.7)]">
              {done ? <PartyPopper className="size-8" /> : <Sparkles className="size-8" />}
            </span>
            <h2 className="mt-5 font-display text-3xl tracking-wide">{done ? "TOUT EST TRIÉ" : "RIEN À VALIDER"}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {done
                ? `${approved} clip${approved > 1 ? "s" : ""} approuvé${approved > 1 ? "s" : ""}, ${decidedCount - approved} écarté${decidedCount - approved > 1 ? "s" : ""}. Les approuvés t'attendent pour être publiés.`
                : "Les nouveaux clips arrivent ici dès qu'un de tes streamers passe en live."}
              {processing > 0 ? ` ${processing} clip${processing > 1 ? "s sont" : " est"} encore en montage : ${processing > 1 ? "ils arriveront" : "il arrivera"} tout seul${processing > 1 ? "s" : ""}.` : ""}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {approved > 0 ? <Link href="/app/clips?tab=approved" className={buttonClass({ variant: "primary", size: "lg" })}><Send className="size-4" /> Publier les approuvés</Link> : null}
              <Link href="/app" className={buttonClass({ variant: "secondary", size: "lg" })}>Retour à l&apos;accueil</Link>
            </div>
            {history.length > 0 ? (
              <button type="button" onClick={undo} className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><Undo2 className="size-4" /> Annuler la dernière décision</button>
            ) : null}
          </div>
        </div>
      ) : current ? (
        <div className="relative z-10 flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-8 lg:px-8 lg:py-6">
          {/* Téléphone */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center gap-4 px-4 pt-3 lg:pt-0">
            <button type="button" onClick={() => move(-1)} disabled={index === 0} aria-label="Clip précédent" className="hidden size-11 shrink-0 place-items-center rounded-full border border-line bg-surface text-muted transition hover:text-ink disabled:opacity-30 lg:grid">
              <ChevronUp className="size-5" />
            </button>
            <div
              {...swipe}
              className="relative touch-pan-y select-none"
              style={{
                transform: `translateX(${offset}px) rotate(${tilt}deg)`,
                transition: drag !== 0 && !fly ? "none" : "transform 220ms cubic-bezier(0.2,0.7,0.2,1)",
                opacity: fly ? 0 : 1,
              }}
            >
              <PhonePreview
                key={current.id}
                clip={current}
                size="fill"
                className="w-[min(86vw,calc((100dvh-var(--review-chrome))*0.5625))] [--review-chrome:340px] lg:[--review-chrome:210px]"
                toolbar
              />
              {stamp ? (
                <span
                  aria-hidden
                  className={cx(
                    "pointer-events-none absolute top-[14%] z-40 rounded-xl border-4 px-3 py-1 font-display text-2xl tracking-wider",
                    stamp === "APPROVED" ? "left-6 -rotate-12 border-ok text-ok" : "right-6 rotate-12 border-bad text-bad",
                  )}
                  style={{ opacity: stampOpacity }}
                >
                  {stamp === "APPROVED" ? "APPROUVÉ" : "ÉCARTÉ"}
                </span>
              ) : null}
            </div>
            <button type="button" onClick={() => move(1)} disabled={index >= items.length - 1} aria-label="Clip suivant" className="hidden size-11 shrink-0 place-items-center rounded-full border border-line bg-surface text-muted transition hover:text-ink disabled:opacity-30 lg:grid">
              <ChevronDown className="size-5" />
            </button>
          </div>

          {/* Infos + décisions */}
          <aside className="shrink-0 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 lg:flex lg:min-h-0 lg:flex-col lg:justify-center lg:overflow-y-auto lg:p-0" aria-live="polite">
            <div key={current.id} className="rise-in">
              <div className="flex flex-wrap items-center gap-2">
                <ScoreBadge score={current.score} className="text-sm" />
                {decision === "APPROVED" ? <Badge tone="ok">Approuvé</Badge> : decision === "REJECTED" ? <Badge>Écarté</Badge> : null}
                <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
                  {current.platform ? <SourceIcon platform={current.platform} className="size-4 shrink-0" /> : null}
                  <span className="truncate font-medium text-ink">{current.author}</span>
                </span>
                <span className="text-xs text-faint">{current.durationLabel} · {current.agoLabel}</span>
              </div>
              <h2 className="mt-2 line-clamp-2 text-lg font-bold leading-snug lg:text-2xl">{current.title || "Titre en cours de génération…"}</h2>
              <div className="hidden lg:block">
                {current.context ? <p className="mt-1 truncate text-sm text-muted">{current.context}</p> : null}
                <p className="mt-0.5 text-xs text-faint">Moment {current.momentLabel}</p>
                {current.hashtags.length ? <p className="mt-3 text-sm text-brand">{current.hashtags.map((t) => `#${t}`).join(" ")}</p> : null}
                <div className="mt-5 grid gap-3 rounded-2xl border border-line bg-surface/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-faint">Pourquoi ce moment</p>
                  <Signal icon={<Volume2 className="size-3.5" />} label="Volume / voix" value={current.signals.audio} />
                  <Signal icon={<MessageSquare className="size-3.5" />} label="Réaction du chat" value={current.signals.chat} />
                  <Signal icon={<Zap className="size-3.5" />} label="Action à l'écran" value={current.signals.scene} />
                  {current.signals.reason ? (
                    <p className="flex gap-2 border-t border-line pt-3 text-sm leading-relaxed text-muted">
                      <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" />
                      <span>{current.signals.reason}{current.signals.ai !== null ? <span className="text-faint"> — IA : {current.signals.ai}/100</span> : null}</span>
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            {error ? <p role="alert" className="mt-3 text-sm text-bad">{error}</p> : null}

            <div className="mt-3 grid grid-cols-[1fr_auto_1fr] gap-2 lg:mt-6">
              <button type="button" onClick={() => decide("REJECTED")} disabled={!!fly} className={buttonClass({ variant: "secondary", size: "lg" }, "h-14 border-bad/30 text-base hover:border-bad/60 hover:bg-bad/10")}>
                <X className="size-5 text-bad" /> Écarter
              </button>
              <Link href={`/app/clips/${current.id}`} className={buttonClass({ variant: "secondary", size: "lg" }, "h-14 px-4")} aria-label="Ouvrir pour publier" title="Ouvrir pour publier (Entrée)">
                <Send className="size-5" />
              </Link>
              <button type="button" onClick={() => decide("APPROVED")} disabled={!!fly} className={buttonClass({ variant: "primary", size: "lg" }, "h-14 text-base")}>
                <Check className="size-5" /> Approuver
              </button>
            </div>
            <p className="mt-2.5 text-center text-xs text-faint lg:hidden">Glisse le téléphone : à droite pour approuver, à gauche pour écarter.</p>
            <p className="mt-3 hidden items-center justify-center gap-2 text-xs text-faint lg:flex">
              <Kbd><ArrowLeft className="size-3" /></Kbd> écarter · <Kbd><ArrowRight className="size-3" /></Kbd> approuver · <Kbd><ArrowUp className="size-3" /></Kbd><Kbd><ArrowDown className="size-3" /></Kbd> naviguer · <Kbd>?</Kbd>
            </p>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
