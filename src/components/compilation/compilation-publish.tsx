"use client";

import Link from "next/link";
import { useState } from "react";
import { publishCompilation } from "@/app/actions/compilations";
import { ActionForm, SubmitButton } from "../action-form";
import { SocialIcon } from "../brand";
import { Badge, Select, cx } from "../ui";

export interface CompAccount {
  id: string;
  displayName: string;
  valid: boolean;
  already: string | null;
}

function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Publication d'une compilation : chaînes YouTube uniquement (vidéo classique), maintenant ou programmée. */
export function CompilationPublish({
  id,
  accounts,
  privacyOptions,
  blocker,
}: {
  id: string;
  accounts: CompAccount[];
  privacyOptions: Array<{ value: string; label: string }>;
  /** Raison pour laquelle on ne peut pas encore publier (montage en cours, vidéo à remonter…) */
  blocker: string | null;
}) {
  const selectable = accounts.filter((a) => a.valid && !a.already);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectable.slice(0, 1).map((a) => a.id)));
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState("");
  const iso = later && when ? new Date(when).toISOString() : "";

  if (accounts.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-muted">
        Aucune chaîne YouTube connectée. <Link href="/app/accounts" className="font-semibold text-brand hover:underline">Connecte une chaîne</Link> pour publier la compilation — ou télécharge la vidéo et envoie-la depuis YouTube Studio.
      </p>
    );
  }

  return (
    <ActionForm action={publishCompilation} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="scheduledAt" value={iso} />
      <ul className="space-y-2">
        {accounts.map((a) => {
          const off = !a.valid || !!a.already;
          return (
            <li key={a.id}>
              <label className={cx("flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition", off ? "cursor-not-allowed border-line opacity-60" : "cursor-pointer border-line hover:border-line-strong", selected.has(a.id) && !off && "border-brand/60 bg-brand/5")}>
                <input
                  type="checkbox"
                  name="account"
                  value={a.id}
                  checked={selected.has(a.id) && !off}
                  disabled={off}
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(a.id)) next.delete(a.id);
                      else next.add(a.id);
                      return next;
                    })
                  }
                  className="size-4 accent-[var(--color-brand)]"
                />
                <SocialIcon platform="YOUTUBE" className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">{a.displayName}</span>
                {a.already ? <Badge tone="ok">{a.already}</Badge> : !a.valid ? <Badge tone="bad">À reconnecter</Badge> : null}
              </label>
            </li>
          );
        })}
      </ul>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted">Visibilité</span>
        <Select name="privacy" defaultValue="" className="w-auto max-w-[60%]">
          <option value="">Selon chaque chaîne</option>
          {privacyOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </label>
      <div className="flex gap-1 rounded-xl border border-line bg-bg p-1 text-sm">
        <button type="button" onClick={() => setLater(false)} className={cx("flex-1 rounded-lg px-3 py-1.5 font-medium", !later ? "bg-surface-2 text-ink" : "text-muted")}>Maintenant</button>
        <button
          type="button"
          onClick={() => {
            setLater(true);
            if (!when) setWhen(localInputValue(new Date(Date.now() + 3600_000)));
          }}
          className={cx("flex-1 rounded-lg px-3 py-1.5 font-medium", later ? "bg-surface-2 text-ink" : "text-muted")}
        >
          Programmer
        </button>
      </div>
      {later ? (
        <input
          type="datetime-local"
          value={when}
          min={localInputValue(new Date())}
          onChange={(e) => setWhen(e.target.value)}
          required
          aria-label="Date et heure de publication"
          className="h-10 w-full rounded-xl border border-line bg-bg px-3 text-sm focus:border-brand focus:outline-none"
        />
      ) : null}
      <SubmitButton variant="primary" className="w-full" disabled={!!blocker || selected.size === 0} pendingLabel="Envoi…">
        {later ? "Programmer sur YouTube" : "Publier sur YouTube"}
      </SubmitButton>
      {blocker ? <p className="text-xs text-warn">{blocker}</p> : <p className="text-xs leading-relaxed text-muted">Envoyée comme vidéo classique (pas un Short), avec la miniature si ta chaîne a le droit d'en utiliser une (chaîne vérifiée).</p>}
    </ActionForm>
  );
}
