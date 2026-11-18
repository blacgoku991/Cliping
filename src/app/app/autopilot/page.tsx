import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CirclePause, FlaskConical, OctagonX, Play, Rocket, ShieldCheck, X } from "lucide-react";
import { cancelPilotPublication, resumePilotAccount, saveAutopilot, startAutopilot, stopAutopilot } from "@/app/actions/autopilot";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Countdown, TimeZoneField } from "@/components/automation";
import { SocialIcon } from "@/components/brand";
import { AutoRefresh, LocalTime } from "@/components/client";
import { Badge, Button, Card, CardHeader, Field, Input, Notice, ScoreBadge, Select } from "@/components/ui";
import { decide, DEFAULT_AUTOPILOT, LIMITS, parseAutopilotConfig } from "@/lib/autopilot";
import { loadDecisionInput, parseState } from "@/lib/autopilot-data";
import { db } from "@/lib/db";
import { ago } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Pilote automatique" };

function Check({ name, label, hint, checked, value, disabled }: { name: string; label: React.ReactNode; hint?: React.ReactNode; checked: boolean; value?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 rounded-xl border border-line bg-bg px-3 py-2.5 text-sm ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <input type="checkbox" name={name} value={value} defaultChecked={checked} disabled={disabled} className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]" />
      <span className="min-w-0">
        {label}
        {hint ? <span className="mt-0.5 block text-xs leading-relaxed text-faint">{hint}</span> : null}
      </span>
    </label>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default async function AutopilotPage() {
  const user = await requireUser();
  const [ap, accounts, streamers] = await Promise.all([
    db.autopilot.findUnique({ where: { userId: user.id } }),
    db.socialAccount.findMany({ where: { userId: user.id }, orderBy: [{ platform: "asc" }, { createdAt: "asc" }] }),
    db.streamer.findMany({ where: { userId: user.id }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, platform: true, autoFollowed: true } }),
  ]);
  const config = parseAutopilotConfig(ap?.config ?? DEFAULT_AUTOPILOT);
  const state = parseState(ap?.state);
  const enabled = !!ap?.enabled;
  const dry = ap?.dryRun ?? true;

  const [upcoming, preview] = await Promise.all([
    db.publication.findMany({
      where: { userId: user.id, autopilot: true, status: "QUEUED" },
      orderBy: { scheduledAt: "asc" },
      take: 50,
      include: { account: true, clip: { select: { id: true, title: true, score: true } } },
    }),
    ap ? loadDecisionInput(user.id, ap).then((l) => ({ l, d: decide(l.input) })) : Promise.resolve(null),
  ]);
  const pausedAccounts = accounts.filter((a) => state.paused[a.id]);

  return (
    <div className="space-y-6">
      {enabled ? <AutoRefresh seconds={20} /> : null}

      {/* ───── État et arrêt immédiat ───── */}
      <Card className={enabled && !dry ? "border-brand/50" : undefined}>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {enabled ? (
                dry ? (
                  <Badge tone="violet"><FlaskConical className="size-3" /> Simulation en cours</Badge>
                ) : (
                  <Badge tone="live"><span className="live-dot size-1.5 rounded-full bg-live" /> Pilote en marche</Badge>
                )
              ) : (
                <Badge><CirclePause className="size-3" /> Arrêté</Badge>
              )}
              {ap?.lastRunAt && enabled ? <span className="text-xs text-faint">dernier passage {ago(ap.lastRunAt)}</span> : null}
            </div>
            <p className="mt-2 text-sm text-muted">
              {enabled
                ? dry
                  ? "Le pilote décide comme s'il était aux commandes et note tout dans le journal, mais n'approuve et ne publie rien."
                  : "Le pilote approuve et programme des clips selon tes règles. Chaque publication attend le délai de grâce avant de partir."
                : "Le pilote ne fait rien. Tu peux le lancer en simulation pour voir ce qu'il ferait, sans risque."}
            </p>
            {enabled && state.lastNotes.length ? (
              <ul className="mt-2 space-y-0.5 text-xs text-faint">
                {state.lastNotes.map((n) => <li key={n}>• {n}</li>)}
              </ul>
            ) : null}
          </div>
          {enabled ? (
            <div className="flex shrink-0 flex-col gap-2 sm:items-end">
              <form action={stopAutopilot}>
                <Button type="submit" variant="danger" size="lg" className="w-full border-bad! bg-bad! text-white! hover:brightness-110 sm:w-auto">
                  <OctagonX className="size-5" /> Arrêter maintenant
                </Button>
              </form>
              <p className="text-xs text-faint sm:text-right">Annule aussi les {upcoming.length} publication{upcoming.length > 1 ? "s" : ""} pas encore partie{upcoming.length > 1 ? "s" : ""}.</p>
              {upcoming.length ? (
                <form action={stopAutopilot}>
                  <input type="hidden" name="keep" value="1" />
                  <button type="submit" className="text-xs text-muted underline hover:text-ink">Arrêter sans annuler les programmées</button>
                </form>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      {/* ───── Ce que l'utilisateur délègue ───── */}
      <Notice tone="warn">
        <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" /> Ce que tu délègues en activant le pilote</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>Des extraits de lives <span className="font-semibold">d'autres créateurs</span> partent sur tes comptes <span className="font-semibold">sans que tu les aies relus</span> : titre, sous-titres, contenu. Si un clip enfreint les règles d'une plateforme ou les droits d'un streamer, c'est ton compte qui est sanctionné.</li>
          <li>N'autorise que des streamers qui acceptent d'être clippés (programme de clipping, accord), et garde le crédit du streamer activé.</li>
          <li>Le pilote ne publie jamais la même vidéo sur deux comptes, respecte tes plafonds et ne contourne aucune règle des plateformes. Il ne promet aucune vue.</li>
          <li>Pendant le délai de grâce, tu reçois une notification et tu peux annuler. « Arrêter maintenant » coupe tout d'un coup.</li>
        </ul>
      </Notice>

      {/* ───── Démarrage ───── */}
      {!enabled || dry ? (
        <Card>
          <CardHeader title={enabled ? "Passer de la simulation au vrai pilote" : "Lancer le pilote"} hint={ap ? undefined : "Enregistre d'abord tes règles plus bas."} />
          <div className="grid gap-4 p-5 md:grid-cols-2">
            {!enabled ? (
              <ActionForm action={startAutopilot} className="flex flex-col gap-3 rounded-xl border border-line bg-bg p-4">
                <input type="hidden" name="mode" value="simulation" />
                <p className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4 text-violet" /> Simulation (conseillé pour commencer)</p>
                <p className="flex-1 text-sm text-muted">Le pilote tourne avec tes règles et écrit dans le journal ce qu'il aurait approuvé et programmé. Rien n'est publié.</p>
                <SubmitButton disabled={!ap} pendingLabel="Lancement…"><Play className="size-4" /> Lancer en simulation</SubmitButton>
              </ActionForm>
            ) : null}
            <ActionForm action={startAutopilot} className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-bg p-4">
              <input type="hidden" name="mode" value="real" />
              <p className="flex items-center gap-2 font-semibold"><Rocket className="size-4 text-brand" /> Pour de vrai</p>
              <label className="flex flex-1 cursor-pointer items-start gap-2.5 text-sm text-muted">
                <input type="checkbox" name="consent" className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]" />
                <span>J'ai compris que le pilote publie sur mes comptes des clips d'autres créateurs sans relecture, et que j'en suis responsable.</span>
              </label>
              <SubmitButton variant="primary" disabled={!ap} pendingLabel="Lancement…"><Play className="size-4" /> Lancer le pilote</SubmitButton>
            </ActionForm>
          </div>
        </Card>
      ) : null}

      {/* ───── Comptes en pause ───── */}
      {pausedAccounts.length ? (
        <Card>
          <CardHeader title="Comptes mis en pause par le pilote" hint="Après deux échecs de publication d'affilée, le pilote arrête d'utiliser le compte. Règle le problème, puis reprends-le." />
          <ul className="divide-y divide-line">
            {pausedAccounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium"><SocialIcon platform={a.platform} className="size-4" /> {a.displayName}</p>
                  <p className="text-xs text-bad">{state.paused[a.id]}</p>
                </div>
                <form action={resumePilotAccount}>
                  <input type="hidden" name="id" value={a.id} />
                  <Button type="submit" size="sm">Reprendre</Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ───── Publications du pilote pas encore parties ───── */}
      {upcoming.length ? (
        <Card>
          <CardHeader title="Programmé par le pilote" hint="Encore annulable : rien n'est parti." />
          <ul className="divide-y divide-line">
            {upcoming.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <Link href={p.clip ? `/app/clips/${p.clip.id}` : "/app/queue"} className="block truncate text-sm font-medium hover:underline">{p.clip?.title || p.title || "Clip sans titre"}</Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span className="flex items-center gap-1"><SocialIcon platform={p.account.platform} className="size-3.5" /> {p.account.displayName}</span>
                    <LocalTime iso={p.scheduledAt.toISOString()} />
                    <span className="text-warn"><Countdown iso={p.scheduledAt.toISOString()} /></span>
                  </p>
                </div>
                <form action={cancelPilotPublication}>
                  <input type="hidden" name="id" value={p.id} />
                  <Button type="submit" size="sm" variant="ghost" aria-label={`Annuler « ${p.clip?.title || p.title} »`}><X className="size-3.5" /> Annuler</Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ───── Aperçu de la décision ───── */}
      {preview ? (
        <Card>
          <CardHeader title="Si le pilote passait maintenant" hint="Calculé avec tes règles enregistrées et l'état actuel de tes clips et comptes, comme le ferait le worker." />
          <div className="space-y-3 p-5 text-sm">
            {preview.d.approve.length === 0 && preview.d.schedule.length === 0 ? <p className="text-muted">Rien à faire pour l'instant.</p> : null}
            {preview.d.approve.length ? (
              <div>
                <p className="mb-1 font-medium">Approuverait {preview.d.approve.length} clip{preview.d.approve.length > 1 ? "s" : ""}</p>
                <ul className="space-y-0.5 text-muted">
                  {preview.d.approve.slice(0, 8).map((a) => <li key={a.clipId} className="truncate">• {preview.l.clipTitles.get(a.clipId)} <span className="text-faint">({a.reason})</span></li>)}
                </ul>
              </div>
            ) : null}
            {preview.d.schedule.length ? (
              <div>
                <p className="mb-1 font-medium">Programmerait {preview.d.schedule.length} publication{preview.d.schedule.length > 1 ? "s" : ""}</p>
                <ul className="space-y-0.5 text-muted">
                  {preview.d.schedule.slice(0, 10).map((r) => (
                    <li key={r.clipId} className="truncate">• <LocalTime iso={new Date(r.at).toISOString()} /> — {preview.l.clipTitles.get(r.clipId)} → {preview.l.accountLabels.get(r.accountId)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {[...preview.d.notes, ...preview.d.blocked.map((b) => `${preview.l.accountLabels.get(b.accountId) ?? "Compte"} écarté : ${b.reason}.`)].map((n) => (
              <p key={n} className="text-xs text-faint">{n}</p>
            ))}
            {preview.d.approve.length || preview.d.schedule.length ? (
              <p className="flex items-center gap-1.5 pt-1 text-xs text-faint"><ShieldCheck className="size-3.5" /> Aperçu seulement : rien n'a été fait.</p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* ───── Règles ───── */}
      <ActionForm action={saveAutopilot} className="space-y-6">
        <TimeZoneField />
        <Card>
          <CardHeader title="1. Approuver automatiquement" />
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <Check name="approve" checked={config.approve} label="Approuver seul les clips au-dessus d'un score" hint="Les autres restent « à valider » et te sont notifiés." />
            <Field label="Score minimal" hint={<>Score de potentiel de 0 à 100 (<ScoreBadge score={80} className="align-middle" /> ou plus = un très bon moment).</>}>
              <Input name="minScore" type="number" min={LIMITS.minScore[0]} max={LIMITS.minScore[1]} defaultValue={config.minScore} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="2. Programmer automatiquement" hint="Reprend la planification en lot : un clip différent par publication, écart et plafonds respectés, meilleurs clips d'abord." />
          <div className="space-y-5 p-5">
            <Check name="schedule" checked={config.schedule} label="Programmer seul les clips approuvés sur les comptes cochés" hint="Seuls les clips encore jamais programmés, publiés ou annulés sont pris." />
            <div>
              <p className="mb-2 text-sm font-medium">Comptes que le pilote peut utiliser</p>
              {accounts.length === 0 ? (
                <p className="text-sm text-muted">Aucun compte connecté. <Link href="/app/accounts" className="text-brand hover:underline">Connecter un compte</Link></p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {accounts.map((a) => (
                    <Check
                      key={a.id}
                      name="accounts"
                      value={a.id}
                      checked={config.accounts.includes(a.id)}
                      label={<span className="flex items-center gap-2"><SocialIcon platform={a.platform} className="size-4" /> {a.displayName}</span>}
                      hint={!a.valid ? <span className="text-bad">À reconnecter : écarté tant que la connexion n'est pas refaite.</span> : a.dailyCap ? `Plafond du compte : ${a.dailyCap}/24 h` : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Délai de grâce (min)" hint="Entre la programmation et l'envoi. Tu es prévenu et peux annuler pendant ce temps.">
                <Input name="graceMin" type="number" min={LIMITS.graceMin[0]} max={LIMITS.graceMin[1]} defaultValue={config.graceMin} />
              </Field>
              <Field label="Plafond global (sur 24 h)" hint="Publications programmées par le pilote, tous comptes confondus.">
                <Input name="globalDailyCap" type="number" min={LIMITS.globalDailyCap[0]} max={LIMITS.globalDailyCap[1]} defaultValue={config.globalDailyCap} />
              </Field>
              <Field label="Plafond par compte (sur 24 h)" hint="Publications déjà faites comprises. Le plafond du compte s'applique aussi s'il est plus bas.">
                <Input name="perAccountCap" type="number" min={LIMITS.perAccountCap[0]} max={LIMITS.perAccountCap[1]} defaultValue={config.perAccountCap} />
              </Field>
              <Field label="Écart entre deux posts d'un compte (min)">
                <Input name="gapMin" type="number" min={LIMITS.gapMin[0]} max={LIMITS.gapMin[1]} defaultValue={config.gapMin} />
              </Field>
              <Field label="Décalage entre comptes (min)">
                <Input name="staggerMin" type="number" min={LIMITS.staggerMin[0]} max={LIMITS.staggerMin[1]} defaultValue={config.staggerMin} />
              </Field>
              <Field label="Âge max d'un clip (h)" hint="Un moment de live trop ancien n'est plus programmé.">
                <Input name="maxClipAgeH" type="number" min={LIMITS.maxClipAgeH[0]} max={LIMITS.maxClipAgeH[1]} defaultValue={config.maxClipAgeH} />
              </Field>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Plage horaire de publication (heure de ton téléphone)</p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted">de</span>
                <div className="w-24"><Select name="windowFrom" defaultValue={config.window.from} aria-label="Début de la plage">
                  {HOURS.map((h) => <option key={h} value={h}>{h} h</option>)}
                </Select></div>
                <span className="text-muted">à</span>
                <div className="w-24"><Select name="windowTo" defaultValue={config.window.to} aria-label="Fin de la plage">
                  {HOURS.map((h) => <option key={h} value={h}>{h} h</option>)}
                </Select></div>
                <span className="text-xs text-faint">(même heure deux fois = toute la journée)</span>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="3. Streamers autorisés" hint="Le pilote ne touche qu'aux clips de ces streamers. Les autres restent à valider à la main." />
          <div className="space-y-3 p-5">
            <Check name="allStreamers" checked={config.allStreamers} label="Tous mes streamers (y compris ceux ajoutés par le mode automatique et les imports)" hint="Déconseillé : tu ne sais pas toujours qui le mode automatique va suivre." />
            {streamers.length ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {streamers.map((s) => (
                  <Check
                    key={s.id}
                    name="streamers"
                    value={s.id}
                    checked={config.streamers.includes(s.id)}
                    label={s.displayName}
                    hint={`${s.platform === "OTHER" ? "Autre" : s.platform.charAt(0) + s.platform.slice(1).toLowerCase()}${s.autoFollowed ? " · suivi automatiquement" : ""}`}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">Aucun streamer suivi. <Link href="/app/streamers" className="text-brand hover:underline">Ajouter des streamers</Link></p>
            )}
          </div>
        </Card>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {enabled && !dry ? <span className="text-xs text-warn">Le pilote est en marche : les nouvelles règles s'appliquent dès le prochain passage.</span> : null}
          <SubmitButton variant="primary" pendingLabel="Enregistrement…">Enregistrer les règles</SubmitButton>
        </div>
      </ActionForm>

      {enabled && !dry ? null : (
        <p className="text-center text-xs text-faint">
          Arrêter le pilote ne supprime rien : tes règles et le <Link href="/app/autopilot/journal" className="underline">journal</Link> restent.
        </p>
      )}
    </div>
  );
}
