"use client";

import { Check, ExternalLink, Lightbulb } from "lucide-react";
import { startTransition, useOptimistic } from "react";
import { toggleCoachItem } from "@/app/actions/coach";
import { GUIDE, type GuideItem } from "@/lib/coach/guide";
import { SOURCES, shortLabel } from "@/lib/coach/sources";
import { Badge, Card, cx } from "../ui";
import { THEME_ICONS } from "./icons";

type Done = Record<string, boolean>;

export function CoachChecklist({ initialDone }: { initialDone: string[] }) {
  const [done, setDone] = useOptimistic<Done, { id: string; value: boolean }>(
    Object.fromEntries(initialDone.map((id) => [id, true])),
    (state, { id, value }) => ({ ...state, [id]: value }),
  );

  const total = GUIDE.reduce((n, t) => n + t.items.length, 0);
  const count = GUIDE.reduce((n, t) => n + t.items.filter((i) => done[i.id]).length, 0);
  const pct = Math.round((count / total) * 100);

  function toggle(id: string) {
    const value = !done[id];
    startTransition(async () => {
      setDone({ id, value });
      await toggleCoachItem(id, value);
    });
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="grid-glow flex flex-wrap items-center gap-5 px-5 py-5 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">Ta progression</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums">
              {count} <span className="text-base font-medium text-muted">/ {total} conseils appliqués</span>
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={count} aria-label="Conseils appliqués">
              <div className="brand-gradient h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-muted">
            Coche un conseil quand tu l&apos;as mis en place. Ta progression est enregistrée sur ton compte.
          </p>
        </div>
        <nav aria-label="Thèmes" className="flex gap-2 overflow-x-auto border-t border-line px-5 py-3 sm:px-6 [scrollbar-width:none]">
          {GUIDE.map((t) => {
            const Icon = THEME_ICONS[t.icon];
            const n = t.items.filter((i) => done[i.id]).length;
            const complete = n === t.items.length;
            return (
              <a
                key={t.id}
                href={`#${t.id}`}
                className={cx(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                  complete ? "border-ok/30 bg-ok/10 text-ok" : "border-line bg-bg text-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {complete ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
                {t.title.replace(/^(L'|La |Les |Le )/, "").replace(/^./, (c) => c.toUpperCase())}
              </a>
            );
          })}
        </nav>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        {GUIDE.map((theme) => {
          const Icon = THEME_ICONS[theme.icon];
          const n = theme.items.filter((i) => done[i.id]).length;
          return (
            <Card key={theme.id} id={theme.id} className={cx("scroll-mt-24 flex flex-col", theme.id === "launch" && "xl:col-span-2 border-brand/30")}>
              <div className="flex items-start gap-3 border-b border-line px-5 py-4">
                <div className={cx("grid size-10 shrink-0 place-items-center rounded-xl", theme.id === "launch" ? "brand-gradient text-white" : "bg-surface-2 text-brand")}>
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">{theme.title}</h2>
                    <span className={cx("text-xs tabular-nums", n === theme.items.length ? "text-ok" : "text-faint")}>
                      {n}/{theme.items.length}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted">{theme.intro}</p>
                </div>
              </div>
              <ul className="divide-y divide-line">
                {theme.items.map((item) => (
                  <ChecklistItem key={item.id} item={item} done={!!done[item.id]} onToggle={() => toggle(item.id)} />
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ChecklistItem({ item, done, onToggle }: { item: GuideItem; done: boolean; onToggle: () => void }) {
  return (
    <li className="flex gap-3 bg-surface px-5 py-4">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Décocher : ${item.title}` : `Cocher : ${item.title}`}
        onClick={onToggle}
        className={cx(
          "mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg border transition",
          done ? "border-transparent bg-ok text-bg" : "border-line-strong bg-bg hover:border-brand",
        )}
      >
        {done ? <Check className="size-4" strokeWidth={3} /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
          <h3 className={cx("min-w-0 flex-1 text-sm font-semibold leading-snug", done && "text-muted")}>{item.title}</h3>
          {item.basis === "official" ? (
            <Badge tone="ok" title="Ce point s'appuie sur une page officielle de la plateforme">Officiel</Badge>
          ) : (
            <Badge tone="neutral" title="Pratique courante chez les créateurs, pas une règle officielle">Usage</Badge>
          )}
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.why}</p>
        {item.example ? (
          <p className="mt-2.5 flex gap-2 rounded-xl border border-line bg-bg px-3 py-2 text-sm leading-relaxed">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-brand-2" />
            <span>{item.example}</span>
          </p>
        ) : null}
        {item.sources?.length ? (
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {item.sources.map((id) => {
              const s = SOURCES[id];
              return (
                <a key={id} href={s.url} target="_blank" rel="noreferrer" title={s.label} className="inline-flex items-center gap-1 text-faint hover:text-brand">
                  <ExternalLink className="size-3" /> {shortLabel(s)}
                </a>
              );
            })}
          </p>
        ) : null}
      </div>
    </li>
  );
}
