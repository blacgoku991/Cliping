"use client";

import { useMemo, useState } from "react";
import { Check, Clapperboard } from "lucide-react";
import type { FormState } from "../action-form";
import { ActionForm, SubmitButton } from "../action-form";
import { Select, cx } from "../ui";

export interface PickerClip {
  id: string;
  title: string;
  streamer: string;
  score: number;
  duration: number;
  thumb: string | null;
  /** « il y a 2 h » (calculé côté serveur) */
  when: string;
}

/** Choix de clips à cocher (création d'une compilation à la main, ou ajout de moments). */
export function ClipPicker({
  clips,
  action,
  hidden,
  submitLabel,
  min = 1,
  max = 30,
  withOrder = false,
}: {
  clips: PickerClip[];
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  hidden?: Record<string, string>;
  submitLabel: string;
  min?: number;
  max?: number;
  withOrder?: boolean;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [streamer, setStreamer] = useState("");
  const streamers = useMemo(() => [...new Set(clips.map((c) => c.streamer).filter(Boolean))].sort(), [clips]);
  const shown = streamer ? clips.filter((c) => c.streamer === streamer) : clips;
  const toggle = (id: string) => setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= max ? prev : [...prev, id]));

  return (
    <ActionForm action={action} className="space-y-4">
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {picked.map((id) => <input key={id} type="hidden" name="clip" value={id} />)}
      <div className="flex flex-wrap items-center gap-2">
        {streamers.length > 1 ? (
          <Select value={streamer} onChange={(e) => setStreamer(e.target.value)} aria-label="Filtrer par streamer" className="w-auto">
            <option value="">Tous les streamers</option>
            {streamers.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        ) : null}
        <button type="button" onClick={() => setPicked(shown.slice(0, max).map((c) => c.id))} className="h-10 rounded-xl px-3 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink">
          Cocher les {Math.min(max, shown.length)} meilleurs
        </button>
        {picked.length ? (
          <button type="button" onClick={() => setPicked([])} className="h-10 rounded-xl px-3 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink">Tout décocher</button>
        ) : null}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((c) => {
          const on = picked.includes(c.id);
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => toggle(c.id)}
                aria-pressed={on}
                className={cx("flex w-full items-center gap-3 rounded-xl border p-2 text-left transition", on ? "border-brand/70 bg-brand/5" : "border-line bg-bg hover:border-line-strong")}
              >
                <span className="relative block aspect-[9/16] w-10 shrink-0 overflow-hidden rounded-md bg-surface-2">
                  {c.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumb} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <Clapperboard className="absolute inset-0 m-auto size-4 text-faint" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.title || "Sans titre"}</span>
                  <span className="block truncate text-xs text-muted">{c.streamer || "Import"} · {Math.round(c.duration)} s · {c.when}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted">🔥 {c.score}</span>
                <span className={cx("grid size-6 shrink-0 place-items-center rounded-full border", on ? "border-brand bg-brand text-white" : "border-line")}>
                  {on ? <Check className="size-3.5" /> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 backdrop-blur">
        <span className="text-sm text-muted">{picked.length} sélectionné{picked.length > 1 ? "s" : ""}{min > 1 && picked.length < min ? ` · au moins ${min}` : ""}</span>
        {withOrder ? (
          <Select name="order" defaultValue="countdown" aria-label="Ordre" className="w-auto">
            <option value="countdown">Compte à rebours (le meilleur à la fin)</option>
            <option value="chrono">Ordre chronologique</option>
          </Select>
        ) : null}
        <SubmitButton variant="primary" className="ml-auto" disabled={picked.length < min} pendingLabel="Création…">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
