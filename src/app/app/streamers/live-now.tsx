import { Check, Eye, RefreshCw, Sparkles } from "lucide-react";
import { clearExcluded, followDiscovered, refreshDiscoveryNow, saveDiscovery } from "@/app/actions/discovery";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SourceIcon } from "@/components/brand";
import { Badge, Button, Card, CardHeader, Field, Input, Notice, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { AUTO_FOLLOW_MAX, compactViewers, DISCOVERY_LANGUAGES, parseResults, streamKey } from "@/lib/discovery";
import { env } from "@/lib/env";
import { ago } from "@/lib/format";
import { directoryConfigured } from "@/lib/live-apis";

const SHOWN = 12;

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">{children}</code>;
}

/** Section « En live maintenant » : les plus gros lives d'un jeu, et le mode automatique. */
export async function LiveNow({ userId, followed }: { userId: string; followed: Map<string, { auto: boolean }> }) {
  const twitch = directoryConfigured("TWITCH");
  const kick = directoryConfigured("KICK");

  if (!twitch && !kick) {
    return (
      <Card className="mb-6">
        <CardHeader title="En live maintenant" hint="Les plus gros lives d'un jeu, pour savoir qui clipper le jour de la sortie." />
        <div className="space-y-3 px-5 py-4 text-sm leading-relaxed text-muted">
          <p className="font-medium text-warn">À activer sur le serveur (gratuit, 5 minutes)</p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>Connecte-toi sur <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">dev.twitch.tv/console</a> (avec ton compte Twitch, double authentification activée).</li>
            <li>« Enregistrer votre application » : un nom au choix, URL de redirection <Code>http://localhost</Code>, catégorie « Application Integration », type de client « Confidentiel ».</li>
            <li>Copie l&apos;identifiant client et génère un secret, puis renseigne <Code>TWITCH_CLIENT_ID</Code> et <Code>TWITCH_CLIENT_SECRET</Code> dans le fichier <Code>.env</Code> et redémarre.</li>
          </ol>
          <p className="text-xs text-faint">
            Facultatif : Kick en plus, avec une application créée dans les réglages développeur de ton compte Kick (<Code>KICK_CLIENT_ID</Code> / <Code>KICK_CLIENT_SECRET</Code>).
            Ces identifiants ne servent qu&apos;à lire l&apos;annuaire public des lives : aucune connexion à ton compte.
          </p>
        </div>
      </Card>
    );
  }

  const discovery =
    (await db.discovery.findUnique({ where: { userId } })) ?? (await db.discovery.create({ data: { userId } }).catch(() => null));
  if (!discovery) return null;
  const results = parseResults(discovery.results);
  const maxAuto = Math.min(AUTO_FOLLOW_MAX, env.worker.maxRecordings);
  const sources = [twitch ? "Twitch" : null, kick ? "Kick" : null].filter(Boolean).join(" et ");

  return (
    <Card className="mb-6">
      <CardHeader
        title={<span className="flex items-center gap-2">En live maintenant {discovery.autoFollow ? <Badge tone="brand"><Sparkles className="size-3" /> Auto · {discovery.autoCount}</Badge> : null}</span>}
        hint={`Les plus gros lives de « ${discovery.game} » sur ${sources}${discovery.fetchedAt ? `, actualisé ${ago(discovery.fetchedAt)}` : ""}.`}
        action={
          <form action={refreshDiscoveryNow}>
            <SubmitButton size="sm" pendingLabel="…" aria-label="Actualiser le classement"><RefreshCw className="size-3.5" /> Actualiser</SubmitButton>
          </form>
        }
      />

      <ActionForm action={saveDiscovery} className="grid gap-3 border-b border-line px-5 py-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_auto_auto]" messageClassName="sm:col-span-2 lg:col-span-4">
        <Field label="Jeu">
          <Input name="game" defaultValue={discovery.game} placeholder="Grand Theft Auto VI" required />
        </Field>
        <Field label="Langue">
          <Select name="language" defaultValue={discovery.language}>
            {DISCOVERY_LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </Select>
        </Field>
        <div className="flex flex-col justify-end gap-1.5 sm:col-span-2 lg:col-span-1">
          <label className="flex h-10 items-center gap-2 rounded-xl border border-line bg-bg px-3 text-sm">
            <input type="checkbox" name="autoFollow" defaultChecked={discovery.autoFollow} className="size-4 accent-[var(--color-brand)]" />
            Suivre auto. les
            <input
              type="number"
              name="autoCount"
              min={1}
              max={maxAuto}
              defaultValue={Math.min(discovery.autoCount, maxAuto)}
              aria-label="Nombre de lives à suivre automatiquement"
              className="h-7 w-14 rounded-lg border border-line bg-surface px-2 text-sm"
            />
            plus gros
          </label>
        </div>
        <div className="flex items-end sm:col-span-2 lg:col-span-1">
          <SubmitButton variant="primary" pendingLabel="Enregistrement…" className="w-full">Enregistrer</SubmitButton>
        </div>
        <p className="text-xs leading-relaxed text-faint sm:col-span-2 lg:col-span-4">
          Mode automatique : le bot ajoute les plus gros lives du jeu dans cette langue et retire ceux qui sortent du classement, au plus {env.worker.maxRecordings} captures en même temps
          (<Code>MAX_CONCURRENT_RECORDINGS</Code>), places des chaînes que tu suis à la main déduites. Tes chaînes ajoutées à la main ne sont jamais touchées, et une capture en cours n&apos;est pas coupée.
        </p>
      </ActionForm>

      {discovery.error ? <Notice tone="bad" className="mx-5 mt-4">{discovery.error}</Notice> : null}

      {results.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">
          {discovery.fetchedAt ? `Aucun live « ${discovery.game} » dans cette langue pour l'instant.` : "Classement en cours de chargement (le worker l'actualise toutes les 2 minutes)…"}
        </p>
      ) : (
        <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {results.slice(0, SHOWN).map((s, i) => {
            const state = followed.get(streamKey(s));
            return (
              <li key={streamKey(s)} className="overflow-hidden rounded-xl border border-line bg-bg">
                <div className="relative aspect-video bg-surface-2">
                  {s.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
                  ) : null}
                  <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-bold tabular-nums text-white">#{i + 1}</span>
                  <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white">
                    <Eye className="size-3" /> {compactViewers(s.viewers)}
                  </span>
                </div>
                <div className="flex items-start gap-2 p-3">
                  <SourceIcon platform={s.platform} className="mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <a href={s.platform === "KICK" ? `https://kick.com/${s.login}` : `https://www.twitch.tv/${s.login}`} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold hover:underline">
                      {s.displayName}
                    </a>
                    <p className="line-clamp-2 text-xs leading-snug text-muted" title={s.title}>{s.title || "Sans titre"}</p>
                  </div>
                  {state && !state.auto ? (
                    <Badge tone="ok"><Check className="size-3" /> Suivie</Badge>
                  ) : (
                    <form action={followDiscovered}>
                      <input type="hidden" name="platform" value={s.platform} />
                      <input type="hidden" name="login" value={s.login} />
                      <input type="hidden" name="displayName" value={s.displayName} />
                      <Button type="submit" size="sm" variant={state ? "secondary" : "primary"} title={state ? "Suivie par le mode auto : la garder pour de bon" : "Ajouter à mes chaînes"}>
                        {state ? "Garder" : "Suivre"}
                      </Button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {discovery.excluded.length > 0 ? (
        <form action={clearExcluded} className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3 text-xs text-faint">
          {discovery.excluded.length} chaîne{discovery.excluded.length > 1 ? "s" : ""} retirée{discovery.excluded.length > 1 ? "s" : ""} à la main ne {discovery.excluded.length > 1 ? "seront" : "sera"} plus reprise{discovery.excluded.length > 1 ? "s" : ""} par le mode auto.
          <button type="submit" className="font-semibold text-muted underline hover:text-ink">Les autoriser à nouveau</button>
        </form>
      ) : null}
    </Card>
  );
}
