"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

// Graphiques maison en SVG : pas de bibliothèque, mêmes règles partout
// (traits fins, grille discrète, texte jamais dans la couleur des séries, infobulle au survol et au clavier).

const C = {
  made: "var(--color-viz-made)",
  posted: "var(--color-viz-posted)",
  grid: "var(--color-line)",
  axis: "var(--color-faint)",
  surface: "var(--color-surface)",
};

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.round(e?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Graduations « rondes » de 0 à au moins `max`. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 100) / 100);
  if (out[out.length - 1]! < max) out.push(out[out.length - 1]! + step);
  return out;
}

/** Chemin d'une barre verticale arrondie (4 px) en haut, carrée sur la ligne de base. */
function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  // Reste dans le cadre du graphique.
  const left = Math.min(Math.max(x, 70), Math.max(70, width - 70));
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-line-strong bg-bg/95 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur"
      style={{ left, top: y - 8 }}
    >
      {children}
    </div>
  );
}

export function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className="size-2.5 rounded-[3px]" style={{ background: color }} />
      {label}
    </span>
  );
}

// ───────────── Activité : clips créés / publiés par jour ─────────────

export interface DayActivity {
  /** Libellé court (ex. « 12/11 ») */
  label: string;
  /** Libellé long pour l'infobulle */
  long: string;
  made: number;
  posted: number;
}

export function ActivityChart({ days }: { days: DayActivity[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 190;
  const m = { top: 12, right: 4, bottom: 24, left: 28 };
  const max = Math.max(1, ...days.map((d) => Math.max(d.made, d.posted)));
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1]!;
  const iw = Math.max(0, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const band = days.length ? iw / days.length : 0;
  const barW = Math.max(3, Math.min(12, (band - 8) / 2));
  const y = (v: number) => m.top + ih - (v / top) * ih;
  const every = band < 26 ? Math.ceil(26 / Math.max(band, 1)) * 2 : 1;
  const h = hover !== null ? days[hover] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4">
        <LegendKey color={C.made} label="Clips créés" />
        <LegendKey color={C.posted} label="Publications en ligne" />
      </div>
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        {width > 0 ? (
          <svg width={width} height={height} role="img" aria-label={`Activité des ${days.length} derniers jours : ${days.reduce((n, d) => n + d.made, 0)} clips créés, ${days.reduce((n, d) => n + d.posted, 0)} publications.`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={C.grid} strokeWidth={1} />
                <text x={m.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill={C.axis} className="tabular-nums">{t}</text>
              </g>
            ))}
            {days.map((d, i) => {
              const cx0 = m.left + band * i + band / 2;
              return (
                <g key={i}>
                  {hover === i ? <rect x={m.left + band * i} y={m.top} width={band} height={ih} fill="rgb(255 255 255 / 0.04)" rx={4} /> : null}
                  <path className="bar-grow" style={{ animationDelay: `${i * 25}ms` }} d={columnPath(cx0 - barW - 1, y(d.made), barW, y(0) - y(d.made))} fill={C.made} />
                  <path className="bar-grow" style={{ animationDelay: `${i * 25 + 60}ms` }} d={columnPath(cx0 + 1, y(d.posted), barW, y(0) - y(d.posted))} fill={C.posted} />
                  {i % every === 0 || i === days.length - 1 ? (
                    <text x={cx0} y={height - 6} textAnchor="middle" fontSize={10} fill={i === days.length - 1 ? "var(--color-muted)" : C.axis}>{i === days.length - 1 ? "auj." : d.label}</text>
                  ) : null}
                  <rect
                    x={m.left + band * i}
                    y={m.top}
                    width={band}
                    height={ih + m.bottom}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${d.long} : ${d.made} clip${d.made > 1 ? "s" : ""} créé${d.made > 1 ? "s" : ""}, ${d.posted} publication${d.posted > 1 ? "s" : ""}`}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    className="outline-none"
                  />
                </g>
              );
            })}
            <line x1={m.left} x2={width - m.right} y1={y(0)} y2={y(0)} stroke="var(--color-line-strong)" strokeWidth={1} />
          </svg>
        ) : (
          <div style={{ height }} className="skeleton rounded-xl" />
        )}
        {h && hover !== null ? (
          <Tooltip x={m.left + band * hover + band / 2} y={y(Math.max(h.made, h.posted))} width={width}>
            <p className="mb-1 font-semibold text-ink">{h.long}</p>
            <p className="flex items-center gap-1.5 text-muted"><span className="size-2 rounded-sm" style={{ background: C.made }} /><span className="tabular-nums text-ink">{h.made}</span> créé{h.made > 1 ? "s" : ""}</p>
            <p className="flex items-center gap-1.5 text-muted"><span className="size-2 rounded-sm" style={{ background: C.posted }} /><span className="tabular-nums text-ink">{h.posted}</span> en ligne</p>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

// ───────────── Répartition des scores ─────────────

export function ScoreHistogram({ bins, strongFrom = 75 }: { bins: number[]; strongFrom?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 150;
  const m = { top: 18, right: 4, bottom: 22, left: 4 };
  const max = Math.max(1, ...bins);
  const iw = Math.max(0, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const band = bins.length ? iw / bins.length : 0;
  const barW = Math.min(24, band - 4);
  const size = 100 / bins.length;
  const y = (v: number) => m.top + ih - (v / max) * ih;
  const peak = bins.indexOf(max);
  const total = bins.reduce((a, b) => a + b, 0);

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={`Répartition des scores de ${total} clips`}>
          {bins.map((v, i) => {
            const x = m.left + band * i + (band - barW) / 2;
            const from = Math.round(i * size);
            const strong = from >= strongFrom - size / 2;
            return (
              <g key={i}>
                {hover === i ? <rect x={m.left + band * i} y={m.top} width={band} height={ih} fill="rgb(255 255 255 / 0.04)" rx={4} /> : null}
                <path className="bar-grow" style={{ animationDelay: `${i * 40}ms` }} d={columnPath(x, y(v), barW, y(0) - y(v))} fill={C.posted} opacity={strong ? 1 : 0.45} />
                {i === peak && v > 0 ? <text x={x + barW / 2} y={y(v) - 5} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--color-ink)" className="tabular-nums">{v}</text> : null}
                {i % 2 === 0 ? <text x={m.left + band * i} y={height - 6} fontSize={10} fill={C.axis} className="tabular-nums">{from}</text> : null}
                <rect
                  x={m.left + band * i} y={m.top} width={band} height={ih + m.bottom} fill="transparent" tabIndex={0} className="outline-none"
                  aria-label={`Score ${from} à ${Math.round((i + 1) * size) - 1} : ${v} clip${v > 1 ? "s" : ""}`}
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
          <line x1={m.left} x2={width - m.right} y1={y(0)} y2={y(0)} stroke="var(--color-line-strong)" strokeWidth={1} />
          <text x={width - m.right} y={height - 6} textAnchor="end" fontSize={10} fill={C.axis}>100</text>
        </svg>
      ) : (
        <div style={{ height }} className="skeleton rounded-xl" />
      )}
      {hover !== null ? (
        <Tooltip x={m.left + band * hover + band / 2} y={y(bins[hover] ?? 0)} width={width}>
          <p className="font-semibold text-ink">Score {Math.round(hover * size)}–{Math.round((hover + 1) * size) - 1}</p>
          <p className="text-muted"><span className="tabular-nums text-ink">{bins[hover]}</span> clip{(bins[hover] ?? 0) > 1 ? "s" : ""}</p>
        </Tooltip>
      ) : null}
    </div>
  );
}

// ───────────── Courbe d'intensité d'un live ─────────────

export interface IntensityData {
  /** Seconde de stream du premier point */
  from: number;
  step: number;
  threshold: number;
  points: number[];
}

export function IntensityChart({
  data,
  markers,
  height = 120,
}: {
  data: IntensityData;
  /** Clips découpés : position en secondes de stream */
  markers: Array<{ id: string; at: number; score: number; title: string }>;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pts = data.points;
  const n = pts.length;
  const m = { top: 14, right: 6, bottom: 20, left: 6 };
  const iw = Math.max(0, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const max = Math.max(data.threshold * 1.6, ...pts, 0.5);
  const end = data.from + Math.max(0, n - 1) * data.step;
  const span = Math.max(data.step, end - data.from);
  const x = (sec: number) => m.left + ((sec - data.from) / span) * iw;
  const y = (v: number) => m.top + ih - (Math.max(0, v) / max) * ih;
  const line = pts.map((v, i) => `${i ? "L" : "M"}${x(data.from + i * data.step).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = n ? `${line}L${x(end).toFixed(1)},${y(0)}L${x(data.from).toFixed(1)},${y(0)}Z` : "";
  const gid = `int-${data.from}-${n}`;
  const visible = markers.filter((mk) => mk.at >= data.from - 1 && mk.at <= end + 1);
  const minutes = span / 60;
  const tickEvery = minutes > 6 ? 2 : 1;
  const ticks: number[] = [];
  for (let mn = 0; mn <= minutes; mn += tickEvery) ticks.push(mn);

  const onMove = (clientX: number) => {
    const el = ref.current;
    if (!el || !n) return;
    const rx = clientX - el.getBoundingClientRect().left;
    const i = Math.round(((rx - m.left) / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  if (n < 2) {
    return <div style={{ height }} className="grid place-items-center rounded-xl border border-dashed border-line text-xs text-faint">La courbe apparaît après quelques secondes d&apos;analyse…</div>;
  }
  const hv = hover !== null ? pts[hover]! : null;
  const hs = hover !== null ? data.from + hover * data.step : 0;

  return (
    <div
      ref={ref}
      className="relative touch-pan-y"
      onMouseMove={(e) => onMove(e.clientX)}
      onMouseLeave={() => setHover(null)}
      onTouchMove={(e) => e.touches[0] && onMove(e.touches[0].clientX)}
      onTouchEnd={() => setHover(null)}
    >
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={`Intensité du live sur les ${Math.round(minutes)} dernières minutes, ${visible.length} moment${visible.length > 1 ? "s" : ""} découpé${visible.length > 1 ? "s" : ""}`}>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <line x1={m.left} x2={width - m.right} y1={y(0)} y2={y(0)} stroke={C.grid} />
          {/* Seuil de détection */}
          <line x1={m.left} x2={width - m.right} y1={y(data.threshold)} y2={y(data.threshold)} stroke="var(--color-brand-2)" strokeOpacity={0.6} strokeWidth={1} />
          <text x={m.left + 2} y={y(data.threshold) - 4} fontSize={9} fill="var(--color-muted)">seuil de clip</text>
          <path d={area} fill={`url(#${gid})`} />
          <path d={line} fill="none" stroke="var(--color-brand)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {visible.map((mk) => (
            <g key={mk.id}>
              <line x1={x(mk.at)} x2={x(mk.at)} y1={m.top - 2} y2={y(0)} stroke="var(--color-ink)" strokeOpacity={0.35} strokeWidth={1} />
              <circle cx={x(mk.at)} cy={m.top} r={5} fill="var(--color-brand-2)" stroke={C.surface} strokeWidth={2} />
            </g>
          ))}
          {ticks.map((mn) => {
            const sec = end - mn * 60;
            if (sec < data.from) return null;
            return (
              <text key={mn} x={x(sec)} y={height - 5} fontSize={10} fill={C.axis} textAnchor={mn === 0 ? "end" : "middle"}>
                {mn === 0 ? "maintenant" : `−${mn} min`}
              </text>
            );
          })}
          {hover !== null && hv !== null ? (
            <g>
              <line x1={x(hs)} x2={x(hs)} y1={m.top} y2={y(0)} stroke="var(--color-muted)" strokeWidth={1} />
              <circle cx={x(hs)} cy={y(hv)} r={4} fill="var(--color-brand)" stroke={C.surface} strokeWidth={2} />
            </g>
          ) : null}
        </svg>
      ) : (
        <div style={{ height }} className="skeleton rounded-xl" />
      )}
      {/* Repères cliquables des clips */}
      {width > 0
        ? visible.map((mk) => (
            <Link
              key={mk.id}
              href={`/app/clips/${mk.id}`}
              title={`${mk.title || "Clip"} · score ${mk.score}`}
              aria-label={`Clip découpé : ${mk.title || "sans titre"}, score ${mk.score}`}
              className="absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full"
              style={{ left: x(mk.at), top: m.top }}
            />
          ))
        : null}
      {hover !== null && hv !== null ? (
        <Tooltip x={x(hs)} y={y(hv)} width={width}>
          <p className="font-semibold text-ink">{end - hs < 5 ? "À l'instant" : `Il y a ${formatAgo(end - hs)}`}</p>
          <p className="text-muted">Intensité <span className="tabular-nums text-ink">{data.threshold > 0 ? (hv / data.threshold).toFixed(1).replace(".", ",") : hv.toFixed(1)}×</span> le seuil</p>
        </Tooltip>
      ) : null}
    </div>
  );
}

function formatAgo(sec: number): string {
  const s = Math.round(sec);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
}

// ───────────── Petits éléments animés ─────────────

/** Nombre qui s'anime jusqu'à sa valeur (instantané si l'utilisateur limite les animations). */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || from === value) {
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const dur = 700;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      setShown(Math.round(from + (value - from) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={className}>{shown.toLocaleString("fr-FR")}</span>;
}

/** Mini-courbe sans axes pour une tuile chiffrée. */
export function Sparkline({ values, className, label }: { values: number[]; className?: string; label: string }) {
  const w = 96;
  const h = 28;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, h - 3 - (v / max) * (h - 6)] as const);
  const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`-4 0 ${w + 8} ${h}`} className={cx("h-7 w-24 overflow-visible", className)} role="img" aria-label={label}>
      <path d={d} fill="none" stroke="var(--color-muted)" strokeOpacity={0.6} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {last ? <circle cx={last[0]} cy={last[1]} r={3} fill="var(--color-brand)" stroke="var(--color-surface)" strokeWidth={1.5} /> : null}
    </svg>
  );
}

/**
 * Activité par jour, regroupée dans le fuseau du navigateur (le serveur ne le connaît pas) :
 * reçoit des horodatages bruts et compose les journées côté client.
 */
export function ActivityByDay({ made, posted, days = 14 }: { made: number[]; posted: number[]; days?: number }) {
  const [data, setData] = useState<DayActivity[] | null>(null);
  useEffect(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const out: DayActivity[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push({
        label: d.toLocaleDateString("fr-FR", { day: "numeric", month: "numeric" }),
        long: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
        made: 0,
        posted: 0,
      });
    }
    const idx = (t: number) => {
      const d = new Date(t);
      d.setHours(0, 0, 0, 0);
      return Math.round((d.getTime() - start.getTime()) / 86_400_000);
    };
    for (const t of made) { const i = idx(t); if (out[i]) out[i].made++; }
    for (const t of posted) { const i = idx(t); if (out[i]) out[i].posted++; }
    setData(out);
  }, [made, posted, days]);
  if (!data) return <div className="h-[220px] skeleton rounded-xl" />;
  return <ActivityChart days={data} />;
}
