"use client";

import { MessageSquareReply } from "lucide-react";
import { startTransition, useActionState } from "react";
import { suggestReplies, type RepliesState } from "@/app/actions/coach";
import { TONES } from "@/lib/coach/types";
import { Button, Field, Input, Select, Textarea } from "../ui";
import { SourceBadge } from "./ai-notice";
import { CopyButton } from "./copy-button";

export function ReplyHelper() {
  const [state, action, pending] = useActionState(suggestReplies, {} as RepliesState);
  return (
    <div className="space-y-5">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          // Envoi via onSubmit : les champs gardent leur saisie (voir action-form.tsx).
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => action(data));
        }}
      >
        <Field label="Commentaire reçu">
          <Textarea name="comment" rows={3} required maxLength={1500} placeholder="Colle ici le commentaire, ex. « c'est fake, il a tout scripté »" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <Field label="Ton">
            <Select name="tone" defaultValue="chaleureux">
              {Object.entries(TONES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Contexte (facultatif)" hint="Le streamer, le jeu, ce qui se passe dans le clip.">
            <Input name="context" maxLength={400} placeholder="ex. clip de Streamer1 sur GTA 6, il rate un saut en moto" />
          </Field>
        </div>
        <Button type="submit" variant="primary" disabled={pending} aria-busy={pending}>
          <MessageSquareReply className="size-4" /> {pending ? "Recherche de réponses…" : "Proposer des réponses"}
        </Button>
      </form>

      {state.error && !pending ? <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{state.error}</p> : null}

      {state.replies?.length && !pending ? (
        <div className="space-y-3 border-t border-line pt-5" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Réponses possibles</h3>
            {state.source ? <SourceBadge source={state.source} /> : null}
          </div>
          {state.note ? <p className="text-xs text-warn">{state.note}</p> : null}
          <ul className="space-y-2">
            {state.replies.map((r) => (
              <li key={r} className="flex items-start gap-3 rounded-xl border border-line bg-bg px-3 py-2.5">
                <p className="min-w-0 flex-1 break-words text-sm leading-relaxed">{r}</p>
                <CopyButton text={r} compact label="Copier la réponse" />
              </li>
            ))}
          </ul>
          {state.source === "template" ? (
            <p className="text-xs text-faint">Remplace les passages entre crochets avant de poster.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
