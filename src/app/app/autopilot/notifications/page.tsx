import type { Metadata } from "next";
import { randomBytes } from "node:crypto";
import { Bell, MessageSquare, Smartphone, Trash2 } from "lucide-react";
import { addDiscordChannel, addNtfyChannel, removeChannel, saveNotifyPrefs, testChannel, toggleChannel } from "@/app/actions/notify";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PushSubscribe, TimeZoneField } from "@/components/automation";
import { LocalTime } from "@/components/client";
import { Badge, Button, Card, CardHeader, Field, Input, Notice, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { ago } from "@/lib/format";
import { NOTIFY_TYPES, parsePrefs, TYPE_LABELS } from "@/lib/notify-plan";
import { getVapid } from "@/lib/notify/send";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Notifications" };

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const KIND_LABEL: Record<string, string> = { WEBPUSH: "App", NTFY: "ntfy", DISCORD: "Discord" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const [settings, channels, history] = await Promise.all([
    db.notifySettings.findUnique({ where: { userId: user.id } }),
    db.notifyChannel.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 25 }),
  ]);
  const prefs = parsePrefs(settings?.prefs);
  let publicKey = "";
  let vapidError = "";
  try {
    publicKey = (await getVapid()).publicKey;
  } catch (err) {
    vapidError = err instanceof Error ? err.message : String(err);
  }
  const suggestedTopic = `cliping-${randomBytes(9).toString("base64url").replace(/[^A-Za-z0-9]/g, "x").toLowerCase()}`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Où te prévenir" hint="Ajoute un ou plusieurs canaux. Chaque alerte part sur tous les canaux actifs." />
        <div className="space-y-6 p-5">
          <section>
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Smartphone className="size-4 text-brand" /> Notifications de l'app (recommandé sur iPhone)</h3>
            <p className="mb-3 text-sm text-muted">Gratuites, sans appli à installer en plus : les alertes arrivent comme celles de n'importe quelle app. Active-les sur chaque appareil (téléphone, ordinateur).</p>
            {vapidError ? <Notice tone="bad">Notifications de l'app indisponibles sur ce serveur : {vapidError}</Notice> : <PushSubscribe publicKey={publicKey} />}
          </section>

          <section className="border-t border-line pt-5">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Bell className="size-4 text-brand" /> ntfy (appli gratuite, iPhone et Android)</h3>
            <p className="mb-3 text-sm text-muted">
              Installe l'appli <span className="font-semibold">ntfy</span> depuis l'App Store, touche <span className="font-semibold">+</span> et abonne-toi au sujet ci-dessous (serveur ntfy.sh). Garde ce nom secret : quiconque le connaît peut lire tes alertes.
            </p>
            <ActionForm action={addNtfyChannel} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" resetOnOk>
              <Field label="Sujet ntfy (ou lien https://ntfy.sh/…)">
                <Input name="topic" defaultValue={suggestedTopic} autoComplete="off" spellCheck={false} />
              </Field>
              <SubmitButton pendingLabel="Ajout…">Ajouter ntfy</SubmitButton>
              <details className="text-xs text-muted sm:col-span-2">
                <summary className="cursor-pointer">Sujet protégé par un jeton d'accès</summary>
                <div className="mt-2 max-w-sm"><Input name="token" placeholder="tk_…" autoComplete="off" /></div>
              </details>
            </ActionForm>
          </section>

          <section className="border-t border-line pt-5">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><MessageSquare className="size-4 text-brand" /> Discord</h3>
            <p className="mb-3 text-sm text-muted">Un message dans un salon de ton serveur. Discord → Paramètres du salon → Intégrations → Webhooks → Copier l'URL.</p>
            <ActionForm action={addDiscordChannel} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" resetOnOk>
              <Field label="URL du webhook">
                <Input name="url" placeholder="https://discord.com/api/webhooks/…" autoComplete="off" spellCheck={false} />
              </Field>
              <SubmitButton pendingLabel="Ajout…">Ajouter Discord</SubmitButton>
            </ActionForm>
          </section>
        </div>
      </Card>

      <Card>
        <CardHeader title="Canaux enregistrés" />
        {channels.length === 0 ? (
          <p className="p-5 text-sm text-muted">Aucun canal pour l'instant : aucune alerte ne peut partir.</p>
        ) : (
          <ul className="divide-y divide-line">
            {channels.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <Badge tone="brand" className="py-0">{KIND_LABEL[c.kind] ?? c.kind}</Badge>
                    <span className="truncate">{c.label}</span>
                    {!c.enabled ? <Badge className="py-0">en pause</Badge> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-faint">
                    {c.lastOkAt ? `dernier envoi réussi ${ago(c.lastOkAt)}` : "jamais testé"}
                    {c.lastError ? <span className="block text-bad">{c.lastError}</span> : null}
                  </p>
                </div>
                <div className="flex flex-wrap items-start gap-1.5">
                  <ActionForm action={testChannel} className="flex flex-col items-start gap-1.5" messageClassName="max-w-xs text-xs">
                    <input type="hidden" name="id" value={c.id} />
                    <SubmitButton size="sm" pendingLabel="Envoi…">Tester</SubmitButton>
                  </ActionForm>
                  <form action={toggleChannel}>
                    <input type="hidden" name="id" value={c.id} />
                    <Button type="submit" size="sm" variant="ghost">{c.enabled ? "Mettre en pause" : "Réactiver"}</Button>
                  </form>
                  <form action={removeChannel}>
                    <input type="hidden" name="id" value={c.id} />
                    <Button type="submit" size="sm" variant="ghost" aria-label={`Supprimer ${c.label}`}><Trash2 className="size-3.5" /></Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ActionForm action={saveNotifyPrefs} className="space-y-6">
        <TimeZoneField />
        <Card>
          <CardHeader title="Quand te prévenir" hint="Pendant un live agité, les alertes sont regroupées : la première part tout de suite, les suivantes partent ensemble." />
          <div className="space-y-5 p-5">
            <div className="grid gap-2 sm:grid-cols-2">
              {NOTIFY_TYPES.map((t) => (
                <label key={t} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-bg px-3 py-2.5 text-sm">
                  <input type="checkbox" name={`type_${t}`} defaultChecked={prefs.types[t]} className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]" />
                  <span>
                    {TYPE_LABELS[t].label}
                    <span className="mt-0.5 block text-xs leading-relaxed text-faint">{TYPE_LABELS[t].hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Regrouper pendant (minutes)" hint="0 = chaque alerte part seule.">
                <Input name="groupMin" type="number" min={0} max={180} defaultValue={prefs.groupMin} />
              </Field>
              <Field label="Heure du résumé quotidien">
                <Select name="digestHour" defaultValue={prefs.digestHour}>
                  {HOURS.map((h) => <option key={h} value={h}>{h} h</option>)}
                </Select>
              </Field>
            </div>
            <div>
              <label className="mb-2 flex cursor-pointer items-center gap-2.5 text-sm font-medium">
                <input type="checkbox" name="quietOn" defaultChecked={!!prefs.quiet} className="size-4 accent-[var(--color-brand)]" />
                Heures de silence
              </label>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted">de</span>
                <div className="w-24"><Select name="quietFrom" defaultValue={prefs.quiet?.from ?? 1} aria-label="Début du silence">
                  {HOURS.map((h) => <option key={h} value={h}>{h} h</option>)}
                </Select></div>
                <span className="text-muted">à</span>
                <div className="w-24"><Select name="quietTo" defaultValue={prefs.quiet?.to ?? 8} aria-label="Fin du silence">
                  {HOURS.map((h) => <option key={h} value={h}>{h} h</option>)}
                </Select></div>
              </div>
              <p className="mt-1.5 text-xs text-faint">Rien ne sonne pendant ces heures ; ce qui s'est passé t'est envoyé en un seul message à la fin.</p>
            </div>
          </div>
        </Card>
        <div className="flex justify-end">
          <SubmitButton variant="primary" pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
        </div>
      </ActionForm>

      <Card>
        <CardHeader title="Dernières alertes" />
        {history.length === 0 ? (
          <p className="p-5 text-sm text-muted">Aucune alerte pour l'instant.</p>
        ) : (
          <ul className="divide-y divide-line">
            {history.map((n) => (
              <li key={n.id} className="flex items-start gap-3 px-4 py-2.5 text-sm sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{n.title}</p>
                  <p className="line-clamp-2 text-xs text-muted">{n.body}</p>
                </div>
                <div className="shrink-0 text-right text-xs text-faint">
                  <LocalTime iso={n.createdAt.toISOString()} />
                  <span className="block">{n.status === "SENT" ? "envoyée" : n.status === "PENDING" ? "en attente" : "non envoyée"}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
