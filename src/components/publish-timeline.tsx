"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Check, Clock, Loader2, TriangleAlert, UserX } from "lucide-react";
import { SocialIcon } from "./brand";
import { cx } from "./ui";

export interface TimelineAccount {
  id: string;
  platform: string;
  displayName: string;
  handle: string | null;
  valid: boolean;
}

export interface TimelinePub {
  id: string;
  accountId: string;
  clipId: string;
  /** Lien à ouvrir à la place de la page du clip (publication d'une compilation) */
  href?: string;
  title: string;
  status: string;
  /** Heure de mise en ligne (publiée) ou prévue, en ms */
  at: number;
  thumb: string | null;
}

const STATUS: Record<string, { label: string; ring: string; icon: typeof Check }> = {
  PUBLISHED: { label: "En ligne", ring: "ring-ok", icon: Check },
  QUEUED: { label: "Programmé", ring: "ring-violet", icon: Clock },
  UPLOADING: { label: "Envoi en cours", ring: "ring-warn", icon: Loader2 },
  PROCESSING: { label: "Traitement par la plateforme", ring: "ring-warn", icon: Loader2 },
  FAILED: { label: "Échec", ring: "ring-bad", icon: TriangleAlert },
};

const RANGES = [
  { id: "day", label: "24 h", past: 6, ahead: 24, tick: 6 },
  { id: "days", label: "3 jours", past: 12, ahead: 72, tick: 12 },
] as const;

const H = 3_600_000;

/**
 * Planning des publications, compte par compte : ce qui est parti (à gauche du trait « maintenant »)
 * et ce qui est programmé (à droite). Lecture seule ; les heures sont celles du navigateur.
 */
export function PublishTimeline({ accounts, pubs }: { accounts: TimelineAccount[]; pubs: TimelinePub[] }) {
  const [now, setNow] = useState<number | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[0]);
  const [hover, setHover] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackW, setTrackW] = useState(600);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setTrackW(Math.max(100, e?.contentRect.width ?? 600)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [now === null]);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [pubs]);

  const view = useMemo(() => {
    if (now === null) return null;
    const from = now - range.past * H;
    const to = now + range.ahead * H;
    const pos = (t: number) => ((t - from) / (to - from)) * 100;
    // Graduations aux heures rondes locales
    const ticks: Array<{ x: number; label: string }> = [];
    const first = new Date(from);
    first.setMinutes(0, 0, 0);
    first.setHours(Math.ceil((first.getHours() + 1) / range.tick) * range.tick);
    for (let t = first.getTime(); t < to; t += range.tick * H) {
      const d = new Date(t);
      const label = d.getHours() === 0
        ? d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })
        : `${d.getHours()} h`;
      ticks.push({ x: pos(t), label });
    }
    // Écart minimal entre deux vignettes sur une même ligne (en % de la piste)
    const minGap = (26 / trackW) * 100;
    const rows = accounts.map((a) => {
      const items = pubs
        .filter((p) => p.accountId === a.id && p.at >= from && p.at <= to)
        .sort((x, y) => x.at - y.at)
        .map((p) => ({ ...p, x: pos(p.at), lane: 0 }));
      // Les vignettes trop proches passent sur une deuxième ou troisième ligne.
      const lastX: number[] = [];
      for (const it of items) {
        let lane = lastX.findIndex((lx) => it.x - lx > minGap);
        if (lane === -1) lane = lastX.length < 3 ? lastX.length : 2;
        lastX[lane] = it.x;
        it.lane = lane;
      }
      return { account: a, items, lanes: Math.max(1, lastX.length) };
    });
    const before = pubs.filter((p) => p.at < from).length;
    const after = pubs.filter((p) => p.at > to).length;
    const upcoming = pubs.filter((p) => p.at > now && p.at <= to && p.status === "QUEUED").length;
    const sent = pubs.filter((p) => p.at >= from && p.at <= now && p.status === "PUBLISHED").length;
    return { nowX: pos(now), ticks, rows, before, after, upcoming, sent };
  }, [accounts, pubs, now, range, trackW]);

  const hovered = hover ? pubs.find((p) => p.id === hover) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <p className="text-sm text-muted">
          {view ? (
            <>
              <span className="font-semibold text-ink">{view.sent}</span> parti{view.sent > 1 ? "s" : ""} ces {range.past} dernières heures ·{" "}
              <span className="font-semibold text-ink">{view.upcoming}</span> programmé{view.upcoming > 1 ? "s" : ""} sur {range.label}
            </>
          ) : " "}
        </p>
        <div role="radiogroup" aria-label="Période" className="flex rounded-xl border border-line bg-bg p-1 text-xs">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={range.id === r.id}
              onClick={() => setRange(r)}
              className={cx("rounded-lg px-2.5 py-1 font-semibold", range.id === r.id ? "bg-surface-2 text-ink" : "text-muted hover:text-ink")}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative px-5 pb-4 pt-3">
        {!view ? (
          <div className="skeleton h-24 rounded-xl" />
        ) : (
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-[minmax(0,150px)_minmax(0,1fr)]">
            {/* Graduations */}
            <div className="hidden sm:block" />
            <div ref={trackRef} className="relative h-5 text-[10px] text-faint">
              {view.ticks.filter((t) => Math.abs(t.x - view.nowX) > 4).map((t) => (
                <span key={t.x} className="absolute -translate-x-1/2 whitespace-nowrap tabular-nums" style={{ left: `${t.x}%` }}>{t.label}</span>
              ))}
              <span className="absolute -translate-x-1/2 font-semibold text-brand" style={{ left: `${view.nowX}%`, top: -2 }} aria-hidden>
                ▼
              </span>
            </div>

            {view.rows.map(({ account, items, lanes }) => (
              <div key={account.id} className="contents">
                <div className="flex min-w-0 items-center gap-2 border-t border-line pb-0.5 pt-2.5 text-sm sm:py-2">
                  <SocialIcon platform={account.platform} className="size-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{account.displayName}</span>
                    {!account.valid ? <span className="flex items-center gap-1 text-[11px] text-bad max-sm:-mt-0.5"><UserX className="size-3" /> à reconnecter</span> : null}
                  </span>
                </div>
                <div className="relative sm:border-t sm:border-line" style={{ height: 14 + lanes * 40 }}>
                  {/* Fond : passé grisé, futur clair */}
                  <div className="absolute inset-y-0 left-0 bg-white/[0.02]" style={{ width: `${view.nowX}%` }} />
                  {view.ticks.map((t) => <div key={t.x} className="absolute inset-y-0 w-px bg-line/60" style={{ left: `${t.x}%` }} />)}
                  <div className="absolute inset-y-0 w-0.5 rounded-full bg-brand" style={{ left: `${view.nowX}%` }} />
                  {items.map((p) => {
                    const st = STATUS[p.status] ?? STATUS.QUEUED!;
                    const busy = p.status === "UPLOADING" || p.status === "PROCESSING";
                    return (
                      <Link
                        key={p.id}
                        href={p.href ?? `/app/clips/${p.clipId}`}
                        onMouseEnter={() => setHover(p.id)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover(p.id)}
                        onBlur={() => setHover(null)}
                        aria-label={`${account.displayName} : « ${p.title || "Clip"} », ${st.label.toLowerCase()}, ${new Date(p.at).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`}
                        className={cx(
                          "rise-in absolute -translate-x-1/2 overflow-hidden rounded-md bg-surface-2 ring-2 ring-offset-2 ring-offset-surface transition hover:z-10 hover:scale-110 focus-visible:z-10",
                          st.ring,
                          p.status === "QUEUED" && "opacity-80",
                        )}
                        style={{ left: `clamp(11px, ${p.x}%, calc(100% - 11px))`, top: 8 + p.lane * 40, width: 18, height: 32 }}
                      >
                        {p.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumb} alt="" loading="lazy" className="size-full object-cover" />
                        ) : null}
                        {busy ? <span className="absolute inset-0 grid place-items-center bg-black/50"><Loader2 className="size-3 animate-spin text-white motion-reduce:animate-none" /></span> : null}
                        {p.status === "FAILED" ? <span className="absolute inset-0 grid place-items-center bg-bad/60"><TriangleAlert className="size-3 text-white" /></span> : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {view && view.rows.every((r) => r.items.length === 0) ? (
          <p className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-dashed border-line px-4 py-3 text-center text-sm text-muted">
            <CalendarClock className="size-4 shrink-0" /> Rien de parti ni de programmé sur cette période. Ouvre un clip approuvé pour le publier ou le programmer.
          </p>
        ) : null}

        {hovered && view ? (
          <div role="status" className="pointer-events-none absolute right-5 top-0 z-20 max-w-[260px] rounded-lg border border-line-strong bg-bg/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
            <p className="line-clamp-2 font-semibold text-ink">{hovered.title || "Clip"}</p>
            <p className="mt-0.5 text-muted">
              {(STATUS[hovered.status] ?? STATUS.QUEUED!).label} · {new Date(hovered.at).toLocaleString("fr-FR", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-5 py-3 text-xs text-muted">
        {(["PUBLISHED", "QUEUED", "UPLOADING", "FAILED"] as const).map((k) => {
          const st = STATUS[k]!;
          return (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={cx("h-3 w-2 rounded-[3px] bg-surface-2 ring-2 ring-offset-1 ring-offset-surface", st.ring)} />
              <st.icon className="size-3" aria-hidden /> {k === "UPLOADING" ? "En cours d'envoi" : st.label}
            </span>
          );
        })}
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 rounded bg-brand" /> maintenant</span>
        {view && (view.before > 0 || view.after > 0) ? (
          <span className="text-faint">· {view.after > 0 ? `${view.after} plus tard` : ""}{view.after > 0 && view.before > 0 ? ", " : ""}{view.before > 0 ? `${view.before} plus tôt` : ""} hors période</span>
        ) : null}
      </div>
    </div>
  );
}
