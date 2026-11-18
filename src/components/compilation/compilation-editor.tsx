"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Clapperboard, GripVertical, Trash2 } from "lucide-react";
import { saveCompilation } from "@/app/actions/compilations";
import { MIN_MOMENTS, momentNumber, moveItem } from "@/lib/compilation";
import { ActionForm, SubmitButton } from "../action-form";
import { Field, Input, Textarea, cx } from "../ui";

export interface EditorMoment {
  clipId: string;
  label: string;
  /** Titre d'origine du clip (repli si le titre du moment est vidé) */
  title: string;
  streamer: string;
  duration: number;
  score: number;
  thumb: string | null;
}

export interface EditorValues {
  title: string;
  description: string;
  tags: string;
  thumbText: string;
  countdown: boolean;
  captions: boolean;
  intro: boolean;
}

const sec = (n: number) => `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, "0")}`;

/** Moments (ordre, titres) + titre/description/miniature + options de montage, enregistrés d'un coup. */
export function CompilationEditor({ id, moments, values, busy }: { id: string; moments: EditorMoment[]; values: EditorValues; busy: boolean }) {
  const [items, setItems] = useState(moments);
  const [countdown, setCountdown] = useState(values.countdown);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const total = items.reduce((n, m) => n + m.duration, 0);
  const move = (from: number, to: number) => setItems((prev) => moveItem(prev, from, to));

  return (
    <ActionForm action={saveCompilation} className="space-y-6" messageClassName="mt-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="items" value={JSON.stringify(items.map((m) => ({ clipId: m.clipId, label: m.label })))} />

      <section aria-labelledby="moments-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="moments-title" className="text-base font-semibold">Ordre des moments</h2>
            <p className="text-sm text-muted">
              Glisse une ligne (ou utilise les flèches) pour changer l'ordre. Le titre de chaque moment s'affiche à l'écran et devient un chapitre YouTube.
            </p>
          </div>
          <span className="text-sm tabular-nums text-muted">{items.length} moments · {sec(total)} de contenu</span>
        </div>
        <ol className="space-y-2">
          {items.map((m, i) => (
            <li
              key={m.clipId}
              draggable
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(i);
              }}
              onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null) move(dragFrom, i);
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              className={cx(
                "flex items-center gap-2 rounded-xl border bg-bg p-2 transition sm:gap-3",
                dragOver === i && dragFrom !== null && dragFrom !== i ? "border-brand" : "border-line",
                dragFrom === i && "opacity-50",
              )}
            >
              <GripVertical className="hidden size-4 shrink-0 cursor-grab text-faint sm:block" aria-hidden />
              <span className="grid h-9 w-11 shrink-0 place-items-center rounded-lg brand-gradient font-display text-lg text-white tabular-nums">
                #{momentNumber(i, items.length, countdown)}
              </span>
              <div className="hidden aspect-video w-20 shrink-0 overflow-hidden rounded-md bg-surface-2 sm:block">
                {m.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.thumb} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <Clapperboard className="m-auto mt-3 size-4 text-faint" aria-hidden />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <input
                  value={m.label}
                  onChange={(e) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  placeholder={m.title || "Titre du moment"}
                  maxLength={80}
                  aria-label={`Titre du moment ${i + 1}`}
                  className="h-9 w-full rounded-lg border border-transparent bg-transparent px-2 text-sm font-medium text-ink hover:border-line focus:border-brand focus:outline-none"
                />
                <p className="truncate px-2 text-xs text-muted">
                  {m.streamer || "Import"} · {sec(m.duration)} · 🔥 {m.score}
                </p>
              </div>
              <div className="flex shrink-0 items-center">
                <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Monter le moment ${i + 1}`} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30">
                  <ArrowUp className="size-4" />
                </button>
                <button type="button" onClick={() => move(i, i + 1)} disabled={i === items.length - 1} aria-label={`Descendre le moment ${i + 1}`} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30">
                  <ArrowDown className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                  disabled={items.length <= MIN_MOMENTS}
                  title={items.length <= MIN_MOMENTS ? `Il faut au moins ${MIN_MOMENTS} moments` : undefined}
                  aria-label={`Retirer le moment ${i + 1}`}
                  className="grid size-8 place-items-center rounded-lg text-muted hover:bg-bad/10 hover:text-bad disabled:opacity-30"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 sm:grid-cols-2" aria-label="Titre, description et miniature">
        <Field label="Titre de la vidéo" hint="Pensé pour la recherche YouTube : qui, quel jeu, quoi. 100 caractères max." className="sm:col-span-2">
          <Input name="title" defaultValue={values.title} maxLength={100} required />
        </Field>
        <Field label="Description" hint="Les chapitres, les crédits des streamers et 3 hashtags sont ajoutés automatiquement à l'envoi." className="sm:col-span-2">
          <Textarea name="description" defaultValue={values.description} rows={4} maxLength={3000} />
        </Field>
        <Field label="Texte de la miniature" hint="2 à 4 mots, lisibles en petit. « TOP N » est ajouté dans un cadre.">
          <Input name="thumbText" defaultValue={values.thumbText} maxLength={40} />
        </Field>
        <Field label="Mots-clés" hint="Séparés par des virgules (recherche YouTube).">
          <Input name="tags" defaultValue={values.tags} />
        </Field>
      </section>

      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-medium">Montage</legend>
        <Toggle name="countdown" checked={countdown} onChange={setCountdown} label="Compte à rebours" hint={`#${items.length} → #1, le meilleur à la fin`} />
        <Toggle name="intro" defaultChecked={values.intro} label="Ouverture" hint="Flash du meilleur moment + titre" />
        <Toggle name="captions" defaultChecked={values.captions} label="Sous-titres" hint="En bas de l'image, une ligne" />
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <SubmitButton name="render" value="1" variant="primary" disabled={busy} pendingLabel="Enregistrement…">
          <Clapperboard className="size-4" /> Enregistrer et monter
        </SubmitButton>
        <SubmitButton pendingLabel="Enregistrement…">Enregistrer sans monter</SubmitButton>
      </div>
    </ActionForm>
  );
}

function Toggle({
  name,
  label,
  hint,
  checked,
  defaultChecked,
  onChange,
}: {
  name: string;
  label: string;
  hint: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-bg px-3 py-2.5 text-sm hover:border-line-strong">
      <input
        type="checkbox"
        name={name}
        {...(onChange ? { checked, onChange: (e) => onChange(e.target.checked) } : { defaultChecked })}
        className="mt-0.5 size-4 accent-[var(--color-brand)]"
      />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}
