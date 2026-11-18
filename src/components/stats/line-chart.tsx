"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { compact } from "@/lib/stats/math";

export interface LineSeries {
  label: string;
  color: string;
  values: number[];
}

const H = 240;
const PAD = { top: 12, right: 16, bottom: 28, left: 52 };

/** Graduations « rondes » de 0 à au moins max. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) ticks.push(v);
  return ticks;
}

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

/**
 * Courbe de plusieurs séries partageant un axe de dates : réticule qui suit le pointeur (ou les flèches du clavier)
 * et info-bulle qui liste toutes les séries à la date visée. Les valeurs restent lisibles sans survol dans le tableau.
 */
export function LineChart({ days, series, ariaLabel }: { days: string[]; series: LineSeries[]; ariaLabel: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const [labels, setLabels] = useState<string[]>([]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Dates formatées côté navigateur (fuseau de l'utilisateur), pas au rendu serveur.
  useEffect(() => setLabels(days.map(dayLabel)), [days]);

  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const ticks = useMemo(() => niceTicks(max), [max]);
  const top = ticks[ticks.length - 1]!;
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (days.length <= 1 ? innerW / 2 : (i * innerW) / (days.length - 1));
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");

  const xTickEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(innerW / 90))));

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((px - PAD.left) / innerW) * (days.length - 1));
    setActive(Math.max(0, Math.min(days.length - 1, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setActive((a) => Math.max(0, Math.min(days.length - 1, (a ?? days.length - 1) + (e.key === "ArrowRight" ? 1 : -1))));
  };

  const tipLeft = active !== null ? x(active) : 0;

  return (
    <div ref={wrap} className="relative w-full select-none">
      <svg
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        className="block touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-lg"
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? days.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-faint text-[11px] tabular-nums">
              {compact(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % xTickEvery === 0 || i === days.length - 1 ? (
            i !== days.length - 1 && days.length - 1 - i < xTickEvery * 0.6 ? null : (
              <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"} className="fill-faint text-[11px]">
                {l}
              </text>
            )
          ) : null,
        )}
        {series.map((s) => (
          <path key={s.label} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series.map((s) => {
          const last = s.values.length - 1;
          return <circle key={s.label} cx={x(last)} cy={y(s.values[last] ?? 0)} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />;
        })}
        {active !== null ? (
          <g pointerEvents="none">
            <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--color-line-strong)" strokeWidth={1} />
            {series.map((s) => (
              <circle key={s.label} cx={x(active)} cy={y(s.values[active] ?? 0)} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />
            ))}
          </g>
        ) : null}
      </svg>

      {active !== null ? (
        <div
          role="status"
          className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-xl border border-line-strong bg-bg/95 px-3 py-2 text-xs shadow-xl backdrop-blur"
          style={tipLeft > width / 2 ? { right: width - tipLeft + 12 } : { left: tipLeft + 12 }}
        >
          <p className="mb-1 text-faint">{labels[active] ?? ""}</p>
          {[...series]
            .sort((a, b) => (b.values[active] ?? 0) - (a.values[active] ?? 0))
            .map((s) => (
              <p key={s.label} className="flex items-center gap-2">
                <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                <strong className="tabular-nums text-ink">{(s.values[active] ?? 0).toLocaleString("fr-FR")}</strong>
                <span className="truncate text-muted">{s.label}</span>
              </p>
            ))}
        </div>
      ) : null}
    </div>
  );
}
