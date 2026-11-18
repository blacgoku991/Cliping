"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Shuffle, X } from "lucide-react";
import { scheduleBatch } from "@/app/actions/clips";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SocialIcon } from "@/components/brand";
import { Badge, Button, Card, CardHeader, Field, Input, Select, cx } from "@/components/ui";
import { buildPlan, checkPlan, formatGap, type PlanAccount, type PlanRow } from "@/lib/schedule";

export interface PlannerClip {
  id: string;
  title: string;
  score: number;
  thumb: string;
  source: string;
  durationSec: number;
}

export interface PlannerAccount extends PlanAccount {
  platform: string;
  displayName: string;
  privacyLabel: string;
}

function localInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function label(ms: number): string {
  return new Date(ms).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function defaultStart(): number {
  // Dans 15 minutes, arrondi au quart d'heure suivant.
  const q = 15 * 60_000;
  return Math.ceil((Date.now() + q) / q) * q;
}

export function BatchPlanner({ clips, accounts }: { clips: PlannerClip[]; accounts: PlannerAccount[] }) {
  const [clipSel, setClipSel] = useState<Set<string>>(() => new Set(clips.map((c) => c.id)));
  const [accSel, setAccSel] = useState<Set<string>>(() => new Set(accounts.map((a) => a.id)));
  const [start, setStart] = useState<string>("");
  const [gapHours, setGapHours] = useState("3");
  const [stagger, setStagger] = useState("20");
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [now, setNow] = useState(0);

  const clipById = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips]);
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const gapMin = Math.max(0, Math.round(Number(gapHours.replace(",", ".")) * 60)) || 0;

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const compute = () => {
    const t = Date.now();
    const startMs = start ? new Date(start).getTime() : defaultStart();
    if (!start) setStart(localInputValue(startMs));
    const chosen = accounts.filter((a) => accSel.has(a.id));
    const order = clips.filter((c) => clipSel.has(c.id)).map((c) => c.id);
    setNow(t);
    setRows(buildPlan(order, chosen, { start: Math.max(startMs, t), gapMin, staggerMin: Math.max(0, Number(stagger) || 0) }));
  };

  const issues = useMemo(() => (rows ? checkPlan(rows, accounts, { gapMin, now }) : []), [rows, accounts, gapMin, now]);
  const rowIssues = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const i of issues) if (i.row !== null) m.set(i.row, [...(m.get(i.row) ?? []), i.message]);
    return m;
  }, [issues]);
  const general = issues.filter((i) => i.row === null);

  const update = (i: number, patch: Partial<PlanRow>) => setRows((prev) => (prev ? prev.map((r, k) => (k === i ? { ...r, ...patch } : r)) : prev));
  const remove = (i: number) => setRows((prev) => (prev ? prev.filter((_, k) => k !== i) : prev));

  const summary = useMemo(() => {
    if (!rows) return [];
    return accounts
      .map((a) => {
        const mine = rows.filter((r) => r.accountId === a.id).map((r) => r.at).sort((x, y) => x - y);
        return { a, count: mine.length, first: mine[0], last: mine[mine.length - 1] };
      })
      .filter((s) => s.count > 0);
  }, [rows, accounts]);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title={`Clips approuvés (${clipSel.size}/${clips.length})`}
            hint="Du meilleur score au moins bon : les premiers partent en premier."
            action={
              <button type="button" className="text-xs font-semibold text-muted hover:text-ink" onClick={() => setClipSel(clipSel.size === clips.length ? new Set() : new Set(clips.map((c) => c.id)))}>
                {clipSel.size === clips.length ? "Tout décocher" : "Tout cocher"}
              </button>
            }
          />
          <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
            {clips.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5 hover:bg-surface-2/40">
                  <input type="checkbox" checked={clipSel.has(c.id)} onChange={() => toggle(clipSel, setClipSel, c.id)} className="size-4 shrink-0 accent-[var(--color-brand)]" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.thumb} alt="" loading="lazy" className="aspect-[9/16] w-8 shrink-0 rounded-md bg-surface-2 object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.title}</span>
                    <span className="block truncate text-xs text-faint">{[c.source, `${c.durationSec} s`].filter(Boolean).join(" · ")}</span>
                  </span>
                  <Badge className="tabular-nums">🔥 {c.score}</Badge>
                </label>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title={`Comptes (${accSel.size}/${accounts.length})`} hint="Chaque clip ira sur un seul de ces comptes." />
          <ul className="divide-y divide-line">
            {accounts.map((a) => (
              <li key={a.id}>
                <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5 hover:bg-surface-2/40">
                  <input type="checkbox" checked={accSel.has(a.id)} onChange={() => toggle(accSel, setAccSel, a.id)} className="size-4 shrink-0 accent-[var(--color-brand)]" />
                  <SocialIcon platform={a.platform} className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{a.displayName}</span>
                    <span className="block truncate text-xs text-faint">
                      {a.privacyLabel} · {a.dailyCap ? `${a.dailyCap} max / 24 h` : "sans plafond"}
                      {a.existing.length ? ` · ${a.existing.length} déjà prévue${a.existing.length > 1 ? "s" : ""}` : ""}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="grid gap-3 border-t border-line p-5 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <Field label="Début">
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Première publication" />
            </Field>
            <Field label="Écart (heures)" hint="Entre 2 posts d'un compte">
              <Input type="number" min={0} max={72} step={0.5} value={gapHours} onChange={(e) => setGapHours(e.target.value)} />
            </Field>
            <Field label="Décalage (min)" hint="Entre comptes au départ">
              <Input type="number" min={0} max={240} step={5} value={stagger} onChange={(e) => setStagger(e.target.value)} />
            </Field>
          </div>
          <div className="border-t border-line p-5">
            <Button type="button" variant="primary" className="w-full" disabled={clipSel.size === 0 || accSel.size === 0} onClick={compute}>
              <Shuffle className="size-4" /> {rows ? "Recalculer l'aperçu" : "Calculer l'aperçu"}
            </Button>
          </div>
        </Card>
      </div>

      {rows ? (
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><CalendarClock className="size-4" /> Aperçu du planning · {rows.length} publication{rows.length > 1 ? "s" : ""}</span>}
            hint={`Un clip = un compte. Au moins ${formatGap(gapMin)} entre deux posts d'un même compte. Change le compte ou l'heure d'une ligne si besoin.`}
          />
          {summary.length ? (
            <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
              {summary.map((s) => (
                <Badge key={s.a.id} tone="violet">
                  <SocialIcon platform={s.a.platform} className="size-3" /> {s.a.displayName} · {s.count}
                  {s.first !== undefined && s.last !== undefined && s.count > 1 ? ` · ${label(s.first)} → ${label(s.last)}` : ""}
                </Badge>
              ))}
            </div>
          ) : null}
          <ol className="divide-y divide-line">
            {rows.map((r, i) => {
              const c = clipById.get(r.clipId);
              const problems = rowIssues.get(i);
              return (
                <li key={r.clipId} className={cx("grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5 md:grid-cols-[auto_minmax(0,1fr)_220px_200px_auto]", problems && "bg-bad/5")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c?.thumb} alt="" className="aspect-[9/16] w-8 rounded-md bg-surface-2 object-cover" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c?.title ?? r.clipId}</p>
                    {problems ? (
                      <p className="flex items-start gap-1 text-xs text-bad"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> {problems.join(" ")}</p>
                    ) : (
                      <p className="truncate text-xs text-faint">{label(r.at)}</p>
                    )}
                  </div>
                  <button type="button" onClick={() => remove(i)} className="rounded-lg p-1.5 text-faint hover:bg-surface-2 hover:text-ink md:order-last" aria-label={`Retirer « ${c?.title} » du planning`} title="Retirer du planning">
                    <X className="size-4" />
                  </button>
                  <Select value={r.accountId} onChange={(e) => update(i, { accountId: e.target.value })} aria-label="Compte" className="col-span-3 md:col-span-1">
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName} ({a.platform === "YOUTUBE" ? "YouTube" : "TikTok"})</option>)}
                  </Select>
                  <Input
                    type="datetime-local"
                    value={localInputValue(r.at)}
                    onChange={(e) => {
                      const t = new Date(e.target.value).getTime();
                      if (Number.isFinite(t)) update(i, { at: t });
                    }}
                    aria-label="Date et heure de publication"
                    className="col-span-3 md:col-span-1"
                  />
                </li>
              );
            })}
          </ol>
          <ActionForm action={scheduleBatch} className="space-y-3 border-t border-line p-5" messageClassName="">
            <input type="hidden" name="plan" value={JSON.stringify(rows)} />
            <input type="hidden" name="gapMin" value={gapMin} />
            {general.map((g) => <p key={g.message} className="text-sm text-bad">{g.message}</p>)}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs leading-relaxed text-faint">
                Les heures sont celles de ton appareil. Chaque compte reçoit sa visibilité par défaut ; tu peux annuler une publication programmée depuis « Publications ».
              </p>
              <SubmitButton variant="primary" disabled={issues.length > 0 || rows.length === 0} pendingLabel="Programmation…">
                Programmer {rows.length} publication{rows.length > 1 ? "s" : ""}
              </SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
