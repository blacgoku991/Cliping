// Petits graphiques en SVG/HTML rendus côté serveur (pas de bibliothèque) : les valeurs sont écrites à côté des marques,
// donc rien ne dépend du survol.
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { compact, ratioLabel, type GroupResult } from "@/lib/stats/math";

/** Couleurs des comptes (palette catégorielle validée sur fond sombre, ordre fixe ; au-delà de 4 : « autres »). */
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500"] as const;
export const OTHER_COLOR = "#6d6782";
/** Série unique : couleur de la marque */
export const ACCENT = "#ff4d8d";

export function StatTile({ label, value, hint, children }: { label: string; value: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1.5 text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">{value}</p>
      {hint ? <div className="mt-1 text-xs text-faint">{hint}</div> : null}
      {children}
    </div>
  );
}

/** Variation signée par rapport à la période précédente. Monter est une bonne nouvelle ici. */
export function Delta({ current, previous, period }: { current: number; previous: number; period: string }) {
  if (previous <= 0) return <span>{current > 0 ? `+${compact(current)} ${period}` : `aucune vue gagnée ${period}`}</span>;
  const pct = Math.round(((current - previous) / previous) * 100);
  const up = pct >= 0;
  return (
    <span>
      +{compact(current)} {period}{" "}
      <span className={cx("font-semibold", up ? "text-ok" : "text-bad")}>
        {up ? "▲" : "▼"} {Math.abs(pct)} %
      </span>{" "}
      vs les 7 jours d'avant
    </span>
  );
}

/** Courbe des 48 premières heures d'une publication. */
export function Sparkline({ points, className }: { points: Array<[number, number]>; className?: string }) {
  const W = 120;
  const H = 32;
  const maxV = Math.max(1, ...points.map((p) => p[1]));
  const x = (h: number) => 2 + (Math.min(48, h) / 48) * (W - 4);
  const y = (v: number) => H - 3 - (v / maxV) * (H - 6);
  const d = points.map(([h, v], i) => `${i ? "L" : "M"}${x(h).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className={className} aria-hidden>
      <line x1={2} x2={W - 2} y1={H - 3} y2={H - 3} stroke="var(--color-line)" strokeWidth={1} />
      <path d={d} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {last ? <circle cx={x(last[0])} cy={y(last[1])} r={3} fill={ACCENT} stroke="var(--color-surface)" strokeWidth={1.5} /> : null}
    </svg>
  );
}

/**
 * Barres horizontales « par rapport à la médiane du compte » : un trait vertical marque 1 (la médiane habituelle).
 * Les groupes trop petits n'ont pas de barre : on écrit qu'il manque des données plutôt que d'afficher un chiffre fragile.
 */
export function RatioBars({ groups, minSample, unit = "vues à 24 h" }: { groups: GroupResult[]; minSample: number; unit?: string }) {
  const ok = groups.filter((g) => g.enough && g.medianRatio !== null);
  const maxRatio = Math.max(1.25, ...ok.map((g) => g.medianRatio!)) * 1.08;
  const pos = (r: number) => `${(r / maxRatio) * 100}%`;
  const best = ok.length >= 2 ? ok.reduce((a, b) => (b.medianRatio! > a.medianRatio! ? b : a)) : null;
  return (
    <ul className="space-y-3">
      {groups.map((g) => (
        <li key={g.key} className="text-sm">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-muted" title={g.label}>{g.label}</span>
            {g.enough && g.medianRatio !== null ? (
              <span className="shrink-0 text-xs tabular-nums">
                <strong className="text-ink">{ratioLabel(g.medianRatio)}</strong>
                <span className="text-faint"> · {compact(g.medianValue)} {unit} · n={g.n}</span>
              </span>
            ) : (
              <span className="shrink-0 text-xs text-faint">pas encore assez de données ({g.n}/{minSample})</span>
            )}
          </div>
          <div
            className="relative h-3"
            title={g.enough && g.medianRatio !== null ? `${g.label} : médiane ${compact(g.medianValue)} ${unit}, ${ratioLabel(g.medianRatio)} par rapport à la médiane du compte (${g.n} publications)` : undefined}
          >
            {g.enough && g.medianRatio !== null ? (
              <div className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: pos(g.medianRatio), background: g === best ? ACCENT : "#3987e5" }} />
            ) : (
              <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
            )}
            <div className="absolute -inset-y-1 w-px bg-ink/40" style={{ left: pos(1) }} aria-hidden />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Barres simples (une seule série) avec la valeur au bout. */
export function ValueBars({ rows }: { rows: Array<{ key: string; label: ReactNode; value: number | null; note?: ReactNode; color?: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="text-sm">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted">{r.note}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 min-w-0 flex-1">
              {r.value !== null ? (
                <div className="h-full rounded-r-[4px]" style={{ width: `${Math.max(1, (r.value / max) * 100)}%`, background: r.color ?? ACCENT }} />
              ) : (
                <div className="h-px w-full translate-y-1.5 bg-line" />
              )}
            </div>
            <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums">{r.value !== null ? compact(r.value) : "—"}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
