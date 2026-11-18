"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { publishClip } from "@/app/actions/clips";
import { ActionForm, SubmitButton } from "./action-form";
import { SocialIcon } from "./brand";
import { Badge, Select, cx } from "./ui";

export interface PanelAccount {
  id: string;
  platform: string;
  displayName: string;
  handle: string | null;
  valid: boolean;
  /** Libellé si le clip est déjà parti/programmé sur ce compte */
  already: string | null;
}

export interface PanelPlatform {
  id: string;
  label: string;
  defaultPrivacy: string;
  options: Array<{ value: string; label: string }>;
}

function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PublishPanel({ clipId, accounts, platforms, disabled }: { clipId: string; accounts: PanelAccount[]; platforms: PanelPlatform[]; disabled: boolean }) {
  const selectable = accounts.filter((a) => a.valid && !a.already);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectable.map((a) => a.id)));
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState("");

  const usedPlatforms = useMemo(
    () => platforms.filter((p) => accounts.some((a) => a.platform === p.id && selected.has(a.id))),
    [accounts, platforms, selected],
  );
  // L'heure saisie est celle du navigateur : on envoie un instant absolu (ISO) au serveur.
  const iso = later && when ? new Date(when).toISOString() : "";
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (accounts.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-muted">
        Aucun compte connecté. <Link href="/app/accounts" className="font-semibold text-brand hover:underline">Connecte TikTok ou YouTube</Link> pour publier en un clic — ou télécharge le clip et poste-le à la main.
      </p>
    );
  }

  return (
    <ActionForm action={publishClip} className="space-y-4">
      <input type="hidden" name="id" value={clipId} />
      <input type="hidden" name="scheduledAt" value={iso} />

      <ul className="space-y-2">
        {accounts.map((a) => {
          const off = !a.valid || !!a.already;
          return (
            <li key={a.id}>
              <label className={cx("flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition", off ? "cursor-not-allowed border-line opacity-60" : "cursor-pointer border-line hover:border-line-strong", selected.has(a.id) && !off && "border-brand/60 bg-brand/5")}>
                <input type="checkbox" name="account" value={a.id} checked={selected.has(a.id) && !off} disabled={off} onChange={() => toggle(a.id)} className="size-4 accent-[var(--color-brand)]" />
                <SocialIcon platform={a.platform} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">{a.displayName}</span>
                {a.already ? <Badge tone="ok">{a.already}</Badge> : !a.valid ? <Badge tone="bad">À reconnecter</Badge> : null}
              </label>
            </li>
          );
        })}
      </ul>

      {usedPlatforms.map((p) => (
        <label key={p.id} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted">Visibilité {p.label}</span>
          <Select name={`privacy_${p.id}`} defaultValue={p.defaultPrivacy} className="w-auto max-w-[60%]">
            {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </label>
      ))}

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

      <SubmitButton variant="primary" className="w-full" disabled={disabled || selected.size === 0 || selectable.length === 0} pendingLabel="Envoi…">
        {later ? "Programmer la publication" : `Publier sur ${selected.size || "…"} compte${selected.size > 1 ? "s" : ""}`}
      </SubmitButton>
      {disabled ? <p className="text-xs text-warn">Le montage doit être terminé avant de publier.</p> : null}
    </ActionForm>
  );
}
