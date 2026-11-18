"use client";

import { useState } from "react";
import { updateClip } from "@/app/actions/clips";
import { clock } from "@/lib/format";
import { ActionForm, SubmitButton } from "./action-form";
import { Field, Input, Select, Textarea, cx } from "./ui";

export interface EditableClip {
  id: string;
  title: string;
  hook: string;
  description: string;
  hashtags: string[];
  captions: boolean;
  template: string;
  startSec: number;
  endSec: number;
  sourceDur: number;
  peakSec: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function ClipEditor({ clip, hasFacecam, hasTranscript }: { clip: EditableClip; hasFacecam: boolean; hasTranscript: boolean }) {
  const max = round1(Math.max(clip.sourceDur, clip.endSec));
  const [start, setStart] = useState(round1(clip.startSec));
  const [end, setEnd] = useState(round1(clip.endSec));
  const [title, setTitle] = useState(clip.title);

  const clampStart = (v: number) => setStart(round1(Math.min(Math.max(0, v), end - 5)));
  const clampEnd = (v: number) => setEnd(round1(Math.max(Math.min(max, v), start + 5)));
  const pct = (v: number) => `${(v / max) * 100}%`;
  const length = end - start;

  const nudge = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className="h-8 rounded-lg border border-line bg-bg px-2.5 text-xs font-semibold text-muted transition hover:border-line-strong hover:text-ink">
      {label}
    </button>
  );

  return (
    <ActionForm action={updateClip} className="space-y-5">
      <input type="hidden" name="id" value={clip.id} />
      <input type="hidden" name="startSec" value={start} />
      <input type="hidden" name="endSec" value={end} />

      <Field label="Titre de la publication" hint={`${title.length}/100 — c'est le texte posté avec la vidéo.`}>
        <Input name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required />
      </Field>
      <Field label="Accroche incrustée" hint="Le texte en gros en haut de la vidéo. Laisse vide pour ne rien afficher.">
        <Input name="hook" defaultValue={clip.hook} maxLength={70} placeholder="IL S'ATTENDAIT PAS À ÇA" />
      </Field>
      <Field label="Description">
        <Textarea name="description" defaultValue={clip.description} rows={2} maxLength={1500} />
      </Field>
      <Field label="Hashtags" hint="Séparés par des espaces, avec ou sans #.">
        <Input name="hashtags" defaultValue={clip.hashtags.map((t) => `#${t}`).join(" ")} />
      </Field>

      <fieldset className="rounded-xl border border-line bg-bg p-4">
        <legend className="px-1.5 text-sm font-medium">Découpe</legend>
        <div className="relative mb-4 mt-1 h-9 overflow-hidden rounded-lg bg-surface-2" aria-hidden>
          <div className="brand-gradient absolute inset-y-0 opacity-80" style={{ left: pct(start), width: pct(length) }} />
          <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: pct(Math.min(clip.peakSec, max)) }} title="Moment fort" />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-white/80 mix-blend-difference">{clock(start)}</span>
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-white/80 mix-blend-difference">{clock(max)}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-xs text-muted">
              <span>Début</span>
              <span className="tabular-nums text-ink">{start.toFixed(1)} s</span>
            </span>
            <input type="range" min={0} max={max} step={0.1} value={start} onChange={(e) => clampStart(Number(e.target.value))} className="w-full" aria-label="Début du clip" />
            <span className="mt-1.5 flex gap-1.5">{nudge("−1 s", () => clampStart(start - 1))}{nudge("+1 s", () => clampStart(start + 1))}</span>
          </label>
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-xs text-muted">
              <span>Fin</span>
              <span className="tabular-nums text-ink">{end.toFixed(1)} s</span>
            </span>
            <input type="range" min={0} max={max} step={0.1} value={end} onChange={(e) => clampEnd(Number(e.target.value))} className="w-full" aria-label="Fin du clip" />
            <span className="mt-1.5 flex gap-1.5">{nudge("−1 s", () => clampEnd(end - 1))}{nudge("+1 s", () => clampEnd(end + 1))}</span>
          </label>
        </div>
        <p className={cx("mt-3 text-xs", length > 60 ? "text-warn" : "text-muted")}>
          Durée du clip : <strong className="tabular-nums text-ink">{length.toFixed(1)} s</strong>
          {length > 60 ? " — au-delà de 60 s, la rétention chute sur la plupart des formats courts." : ". Le trait blanc marque le moment fort détecté."}
        </p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mise en page">
          <Select name="template" defaultValue={clip.template}>
            <option value="BLUR">Gameplay centré, fond flouté</option>
            <option value="FULL">Plein écran (recadré)</option>
            <option value="FACECAM" disabled={!hasFacecam}>Facecam en haut + gameplay{hasFacecam ? "" : " (zone à définir sur la chaîne)"}</option>
          </Select>
        </Field>
        <label className="flex cursor-pointer items-center gap-3 self-end rounded-xl border border-line bg-bg px-3 py-2.5 text-sm">
          <input type="checkbox" name="captions" defaultChecked={clip.captions} className="size-4 accent-[var(--color-brand)]" />
          <span>
            Sous-titres
            {!hasTranscript ? <span className="block text-xs text-faint">Aucune transcription pour ce clip</span> : null}
          </span>
        </label>
      </div>

      <SubmitButton variant="primary" pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
    </ActionForm>
  );
}
