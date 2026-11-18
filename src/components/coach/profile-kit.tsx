import type { SocialPlatform } from "@prisma/client";
import { Info } from "lucide-react";
import { saveProfileKit } from "@/app/actions/coach";
import { LIMITS, charCount } from "@/lib/coach/limits";
import { TONES, type ProfileKit } from "@/lib/coach/types";
import { ActionForm, SubmitButton } from "../action-form";
import { LocalTime } from "../client";
import { Field, Input, Select, cx } from "../ui";
import { SourceBadge } from "./ai-notice";
import { CopyButton } from "./copy-button";

/** Formulaire de génération + propositions conservées, pour un compte (ou un brouillon de compte). */
export function ProfileKitPanel({
  target,
  platform,
  kit,
  defaults,
}: {
  target: string;
  platform: SocialPlatform;
  kit: ProfileKit | null;
  defaults: { niche: string; tone: string; streamers: string };
}) {
  const l = LIMITS[platform];
  return (
    <div className="space-y-5">
      <ActionForm action={saveProfileKit} className="space-y-4" messageClassName="mt-1">
        <input type="hidden" name="target" value={target} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ta niche" hint="Le jeu, le type de moments, la langue." className="sm:col-span-2">
            <Input name="niche" required maxLength={120} defaultValue={defaults.niche} placeholder="ex. fails et fous rires sur GTA 6, streams FR" />
          </Field>
          <Field label="Ton">
            <Select name="tone" defaultValue={defaults.tone}>
              {Object.entries(TONES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Streamers que tu clippes" hint="Séparés par des virgules.">
            <Input name="streamers" maxLength={200} defaultValue={defaults.streamers} placeholder="ex. Streamer1, Streamer2" />
          </Field>
        </div>
        <SubmitButton variant="primary" pendingLabel="Génération…">{kit ? "Régénérer des propositions" : "Proposer des bios et des noms"}</SubmitButton>
      </ActionForm>

      {kit ? (
        <div className="space-y-5 border-t border-line pt-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
            <SourceBadge source={kit.source} />
            {kit.generatedAt ? <span>générées le <LocalTime iso={kit.generatedAt} /></span> : null}
          </div>

          <section>
            <h3 className="mb-2 text-sm font-semibold">{platform === "YOUTUBE" ? "Descriptions de chaîne" : "Bios"} <span className="font-normal text-faint">· {l.bio.max} caractères max.</span></h3>
            <ul className="space-y-2">
              {kit.bios.map((bio) => {
                const n = charCount(bio);
                return (
                  <li key={bio} className="flex items-start gap-3 rounded-xl border border-line bg-bg px-3 py-2.5">
                    <p className="min-w-0 flex-1 whitespace-pre-line break-words text-sm leading-relaxed">{bio}</p>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <CopyButton text={bio} compact label="Copier la bio" />
                      <span className={cx("text-[11px] tabular-nums", n > l.bio.max ? "text-bad" : "text-faint")}>{n}/{l.bio.max}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="grid gap-5 md:grid-cols-2">
            <IdeaList title="Noms affichés" hint={`${l.displayName.max} caractères max.`} items={kit.displayNames} />
            <IdeaList
              title={platform === "YOUTUBE" ? "Identifiants (@handle)" : "Noms d'utilisateur"}
              hint={`${l.username.min}-${l.username.max} caractères${platform === "TIKTOK" ? " · modifiable tous les 30 jours" : ""}`}
              items={kit.usernames}
              prefix="@"
            />
          </div>
          <p className="text-xs leading-relaxed text-faint">
            Vérifie dans l&apos;app que le nom est libre avant de t&apos;y attacher. Évite un nom qui laisse croire que tu es le streamer ou un compte officiel.
          </p>

          {kit.tips.length ? (
            <section>
              <h3 className="mb-2 text-sm font-semibold">Photo et lien</h3>
              <ul className="space-y-1.5">
                {kit.tips.map((t) => (
                  <li key={t} className="flex gap-2 text-sm leading-relaxed text-muted">
                    <Info className="mt-0.5 size-4 shrink-0 text-faint" /> {t}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function IdeaList({ title, hint, items, prefix = "" }: { title: string; hint: string; items: string[]; prefix?: string }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 text-sm font-semibold">{title} <span className="font-normal text-faint">· {hint}</span></h3>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((x) => (
            <li key={x} className="flex items-center gap-2 rounded-xl border border-line bg-bg py-1.5 pl-3 pr-1.5">
              <span className="min-w-0 flex-1 break-all text-sm font-medium">{prefix}{x}</span>
              <CopyButton text={x} compact label={`Copier ${prefix}${x}`} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-faint">Aucune proposition valide : régénère.</p>
      )}
    </section>
  );
}
