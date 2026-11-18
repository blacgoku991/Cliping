import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";
const BUTTON_SIZES = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" };
const BUTTON_VARIANTS = {
  primary: "brand-gradient text-white shadow-[0_8px_30px_-10px_rgb(255_77_141/0.7)] hover:brightness-110",
  secondary: "bg-surface-2 text-ink border border-line hover:border-line-strong hover:bg-line",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  danger: "bg-bad/10 text-bad border border-bad/30 hover:bg-bad/20",
};

type ButtonStyle = { variant?: keyof typeof BUTTON_VARIANTS; size?: keyof typeof BUTTON_SIZES };

export function buttonClass({ variant = "secondary", size = "md" }: ButtonStyle = {}, extra?: string): string {
  return cx(BUTTON_BASE, BUTTON_SIZES[size], BUTTON_VARIANTS[variant], extra);
}

export function Button({ variant, size, className, ...props }: ComponentProps<"button"> & ButtonStyle) {
  return <button {...props} className={buttonClass({ variant, size }, className)} />;
}

export function LinkButton({ variant, size, className, ...props }: ComponentProps<typeof Link> & ButtonStyle) {
  return <Link {...props} className={buttonClass({ variant, size }, className)} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cx("rounded-2xl border border-line bg-surface", className)} />;
}

export function CardHeader({ title, hint, action }: { title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        {hint ? <p className="mt-0.5 text-sm text-muted">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

const FIELD = "w-full rounded-xl border border-line bg-bg px-3 text-sm text-ink placeholder:text-faint transition focus:border-brand focus:outline-none";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cx(FIELD, "h-10", className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(FIELD, "py-2 leading-relaxed", className)} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={cx(FIELD, "h-10 pr-8", className)} />;
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs leading-relaxed text-muted">{hint}</span> : null}
    </label>
  );
}

const TONES = {
  neutral: "bg-surface-2 text-muted border-line",
  brand: "bg-brand/12 text-brand border-brand/30",
  ok: "bg-ok/10 text-ok border-ok/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  bad: "bg-bad/10 text-bad border-bad/30",
  violet: "bg-violet/12 text-violet border-violet/30",
  live: "bg-live/15 text-live border-live/40",
};

export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      {...props}
      className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone], className)}
    />
  );
}

export function LiveBadge() {
  return (
    <Badge tone="live">
      <span className="live-dot size-1.5 rounded-full bg-live" />
      EN LIVE
    </Badge>
  );
}

export function Notice({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <div className={cx("rounded-xl border px-4 py-3 text-sm leading-relaxed", TONES[tone], className)}>{children}</div>;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon ? <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-surface-2 text-muted">{icon}</div> : null}
      <h3 className="text-base font-semibold">{title}</h3>
      {children ? <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Score de potentiel 0..100 → pastille colorée. */
export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  const tone: Tone = score >= 75 ? "brand" : score >= 55 ? "warn" : "neutral";
  return (
    <Badge tone={tone} className={cx("tabular-nums", className)} title="Potentiel estimé du clip (signaux du live + avis de l'IA)">
      🔥 {score}
    </Badge>
  );
}
