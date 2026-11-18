import type { Metadata } from "next";
import { Download, Eye, Radio, Settings2, Sparkles, Trash2 } from "lucide-react";
import { createFromProposal } from "@/app/actions/compilations";
import { addStreamer, deleteRecording, deleteStreamer, importVod, keepStreamer, toggleStreamer, updateStreamer } from "@/app/actions/streamers";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SourceIcon } from "@/components/brand";
import { AutoRefresh, ConfirmButton } from "@/components/client";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, LiveBadge, PageHeader, Select, type Tone } from "@/components/ui";
import { db } from "@/lib/db";
import { compactViewers, streamKey } from "@/lib/discovery";
import { ago, duration } from "@/lib/format";
import { allowedHostsLabel } from "@/lib/hosts";
import { requireUser } from "@/lib/session";
import { SOURCE_PLATFORMS } from "@/lib/sources";
import { LiveNow } from "./live-now";

export const metadata: Metadata = { title: "Streamers" };

const REC_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "En attente", tone: "neutral" },
  PROCESSING: { label: "En cours", tone: "warn" },
  DONE: { label: "Terminé", tone: "ok" },
  FAILED: { label: "Échec", tone: "bad" },
};

export default async function StreamersPage() {
  const user = await requireUser();
  const [streamers, imports] = await Promise.all([
    db.streamer.findMany({
      where: { userId: user.id },
      orderBy: [{ isLive: "desc" }, { createdAt: "asc" }],
      include: { _count: { select: { clips: true } }, recordings: { where: { status: "RECORDING" }, take: 1, select: { durationSec: true } } },
    }),
    db.recording.findMany({
      where: { userId: user.id, source: "VOD" },
      orderBy: { startedAt: "desc" },
      take: 8,
      include: { _count: { select: { clips: true } } },
    }),
  ]);
  const importing = imports.some((r) => r.status === "PENDING" || r.status === "PROCESSING");
  const followed = new Map(streamers.map((s) => [streamKey(s), { auto: s.autoFollowed }]));

  return (
    <>
      <AutoRefresh seconds={importing ? 4 : 15} />
      <PageHeader
        title="Streamers"
        subtitle="Les chaînes que le bot surveille. Dès qu'un live démarre sur le bon jeu, il est capté et découpé en clips."
      />

      <Card className="mb-6">
        <CardHeader title="Ajouter une chaîne" hint="Colle le lien de la chaîne Twitch, Kick, YouTube ou TikTok (ou juste le pseudo)." />
        <ActionForm action={addStreamer} resetOnOk className="grid gap-3 p-5 sm:grid-cols-[1fr_140px] lg:grid-cols-[1.3fr_140px_1fr_auto]" messageClassName="sm:col-span-2 lg:col-span-4">
          <Input name="channel" placeholder="twitch.tv/pseudo" required aria-label="Lien ou pseudo de la chaîne" autoComplete="off" />
          <Select name="platform" aria-label="Plateforme (si tu donnes juste un pseudo)" defaultValue="TWITCH">
            {SOURCE_PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
          <Input name="gameFilter" defaultValue="Grand Theft Auto VI" placeholder="Jeu (vide = tous les lives)" aria-label="Filtre de jeu" className="sm:col-span-2 lg:col-span-1" />
          <SubmitButton variant="primary" pendingLabel="Ajout…" className="sm:col-span-2 lg:col-span-1">Ajouter</SubmitButton>
        </ActionForm>
        <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-faint">
          Le filtre de jeu correspond à la catégorie affichée sur Twitch ou Kick (« GTA 6 », « GTA VI » et « Grand Theft Auto VI » sont équivalents ; plusieurs jeux possibles, séparés par des virgules). Sur YouTube et TikTok Live (qui n&apos;affichent pas de catégorie), il est cherché dans le titre du live. Si une chaîne est en live sans être captée, sa carte t&apos;indique la catégorie exacte à recopier.
        </p>
      </Card>

      <LiveNow userId={user.id} followed={followed} />

      {streamers.length === 0 ? (
        <Card>
          <EmptyState icon={<Radio className="size-6" />} title="Aucune chaîne surveillée">
            Ajoute les streamers dont tu veux clipper les lives. Le bot vérifie toutes les minutes s&apos;ils sont en direct.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-3">
          {streamers.map((s) => {
            const facecam = s.facecam as { x: number; y: number; w: number; h: number } | null;
            const recording = s.recordings[0];
            return (
              <Card key={s.id} className={s.enabled ? "" : "opacity-60"}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2"><SourceIcon platform={s.platform} className="size-5" /></div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <a href={s.url.replace(/\/live$/, "")} target="_blank" rel="noreferrer" className="truncate font-semibold hover:underline">{s.displayName}</a>
                        {s.isLive ? <LiveBadge /> : null}
                        {recording ? <Badge tone="brand">Capture · {duration(recording.durationSec)}</Badge> : null}
                        {s.autoFollowed ? (
                          <Badge tone="violet" title="Ajoutée par le mode automatique : retirée quand elle sort du classement">
                            <Sparkles className="size-3" /> Auto{s.autoViewers !== null ? <> · <Eye className="size-3" /> {compactViewers(s.autoViewers)}</> : null}
                          </Badge>
                        ) : null}
                        {!s.enabled ? <Badge>{s.autoFollowed ? "Sortie du classement" : "En pause"}</Badge> : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {s.isLive
                          ? [s.liveCategory, s.liveTitle].filter(Boolean).join(" · ") || "En direct"
                          : s.lastCheckedAt
                            ? `Hors ligne · vérifié ${ago(s.lastCheckedAt)}${s.lastLiveAt ? ` · dernier live ${ago(s.lastLiveAt)}` : ""}`
                            : "Première vérification dans moins d'une minute"}
                      </p>
                      {s.isLive && !recording && s.gameFilter && s.enabled ? (
                        <p className="mt-0.5 text-xs text-warn">
                          En live{s.liveCategory ? ` sur « ${s.liveCategory} »` : ""}, ce qui ne correspond pas au filtre « {s.gameFilter} » : pas de capture.
                        </p>
                      ) : null}
                      {s.lastError ? <p className="mt-0.5 break-words text-xs text-bad">{s.lastError}</p> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-faint">
                    <span className="tabular-nums">{s._count.clips} clip{s._count.clips > 1 ? "s" : ""}</span>
                    {s.autoFollowed ? (
                      <form action={keepStreamer}>
                        <input type="hidden" name="id" value={s.id} />
                        <Button type="submit" size="sm" title="La suivre à la main : le mode automatique ne la retirera plus">Garder</Button>
                      </form>
                    ) : (
                      <form action={toggleStreamer}>
                        <input type="hidden" name="id" value={s.id} />
                        <Button type="submit" size="sm">{s.enabled ? "Mettre en pause" : "Réactiver"}</Button>
                      </form>
                    )}
                    <form action={deleteStreamer}>
                      <input type="hidden" name="id" value={s.id} />
                      <ConfirmButton size="sm" variant="ghost" message={s.autoFollowed ? `Retirer ${s.displayName} ? Le mode automatique ne la reprendra plus. Les clips déjà créés sont conservés.` : `Retirer ${s.displayName} ? Les clips déjà créés sont conservés.`} aria-label={`Retirer ${s.displayName}`}>
                        <Trash2 className="size-3.5" />
                      </ConfirmButton>
                    </form>
                  </div>
                </div>
                <details className="group border-t border-line">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-2.5 text-xs font-medium text-muted hover:text-ink">
                    <Settings2 className="size-3.5" /> Réglages de la chaîne
                    <span className="text-faint">· jeu : {s.gameFilter || "tous"} · qualité : {s.quality}{facecam ? " · facecam définie" : ""}</span>
                  </summary>
                  <ActionForm action={updateStreamer} className="grid gap-4 px-5 pb-5 pt-2 md:grid-cols-2" messageClassName="md:col-span-2">
                    <input type="hidden" name="id" value={s.id} />
                    <Field label="Jeux à capter" hint="Catégorie du live, plusieurs séparées par des virgules. Vide = tous les lives.">
                      <Input name="gameFilter" defaultValue={s.gameFilter} placeholder="Grand Theft Auto VI" />
                    </Field>
                    <Field label="Qualité de capture" hint="« best » prend la meilleure disponible. « 720p60,best » économise du disque et du processeur.">
                      <Input name="quality" defaultValue={s.quality} placeholder="best" />
                    </Field>
                    <fieldset className="rounded-xl border border-line bg-bg p-4 md:col-span-2">
                      <legend className="px-1.5 text-sm font-medium">Zone de la facecam</legend>
                      <label className="mb-3 flex items-center gap-2 text-sm">
                        <input type="checkbox" name="facecamOn" defaultChecked={!!facecam} className="size-4 accent-[var(--color-brand)]" />
                        Ce streamer a une webcam à l&apos;écran (active la mise en page « Facecam + gameplay »)
                      </label>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {([["fx", "Bord gauche", facecam?.x ?? 0.75], ["fy", "Bord haut", facecam?.y ?? 0.02], ["fw", "Largeur", facecam?.w ?? 0.23], ["fh", "Hauteur", facecam?.h ?? 0.3]] as const).map(([name, label, value]) => (
                          <label key={name} className="block text-xs text-muted">
                            {label} (%)
                            <Input name={name} type="number" min={0} max={100} step={0.5} defaultValue={Math.round(value * 1000) / 10} className="mt-1" />
                          </label>
                        ))}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-faint">
                        En pourcentage de l&apos;image du stream. Exemple pour une webcam en haut à droite : gauche 75, haut 2, largeur 23, hauteur 30.
                      </p>
                    </fieldset>
                    <div className="md:col-span-2"><SubmitButton pendingLabel="Enregistrement…">Enregistrer les réglages</SubmitButton></div>
                  </ActionForm>
                </details>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="mt-10">
        <CardHeader
          title="Importer une vidéo"
          hint={`Colle le lien d'un clip, d'un Short, d'une vidéo TikTok ou d'un replay (${allowedHostsLabel()}). Une vidéo courte (2 min 30 ou moins) devient directement un clip vertical ; un replay est analysé pour en extraire les meilleurs moments.`}
        />
        <ActionForm action={importVod} resetOnOk className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]" messageClassName="sm:col-span-2 lg:col-span-5">
          <Input name="url" type="url" placeholder="https://clips.twitch.tv/… ou youtube.com/shorts/…" required aria-label="Lien du clip ou du replay" className="sm:col-span-2 lg:col-span-1" />
          <Input name="start" placeholder="Début (1:23:45)" aria-label="Début de la plage, facultatif" />
          <Input name="end" placeholder="Fin (2:00:00)" aria-label="Fin de la plage, facultatif" />
          <Input name="maxClips" type="number" min={1} max={50} placeholder="Nb de clips max" aria-label="Nombre maximum de clips, facultatif" />
          <SubmitButton variant="primary" pendingLabel="Lancement…"><Download className="size-4" /> Importer</SubmitButton>
        </ActionForm>
        {imports.length > 0 ? (
          <ul className="divide-y divide-line border-t border-line">
            {imports.map((r) => {
              const st = REC_STATUS[r.status] ?? { label: r.status, tone: "neutral" as Tone };
              const running = r.status === "PENDING" || r.status === "PROCESSING";
              return (
                <li key={r.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <Badge tone={st.tone}>{st.label}{running ? ` · ${Math.round(r.progress * 100)} %` : ""}</Badge>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.title || r.sourceUrl}</span>
                    <span className="text-xs text-faint">
                      {r.status === "DONE" && (r.options as { kind?: string } | null)?.kind === "clip"
                        ? `Clip importé tel quel · ${duration(r.durationSec)} · `
                        : r.status === "DONE" ? `${duration(r.durationSec)} analysées · ${r._count.clips} clip${r._count.clips > 1 ? "s" : ""} · ` : ""}{ago(r.startedAt)}
                    </span>
                    {r.status === "DONE" && r._count.clips >= 3 && (r.options as { kind?: string } | null)?.kind !== "clip" ? (
                      <form action={createFromProposal}>
                        <input type="hidden" name="kind" value="recording" />
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton size="sm" pendingLabel="Préparation…" title="Compilation horizontale des meilleurs moments pour YouTube">
                          <Sparkles className="size-3.5" /> Faire le best-of
                        </SubmitButton>
                      </form>
                    ) : null}
                    {!running ? (
                      <form action={deleteRecording}>
                        <input type="hidden" name="id" value={r.id} />
                        <button type="submit" className="rounded-lg p-1.5 text-faint hover:bg-surface-2 hover:text-ink" aria-label="Retirer de la liste" title="Retirer de la liste"><Trash2 className="size-3.5" /></button>
                      </form>
                    ) : null}
                  </div>
                  {running ? (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="brand-gradient h-full rounded-full transition-all" style={{ width: `${Math.max(3, r.progress * 100)}%` }} /></div>
                  ) : null}
                  {r.error ? <p className={`mt-1.5 break-words text-xs ${r.status === "FAILED" ? "text-bad" : "text-warn"}`}>{r.error}</p> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </Card>
    </>
  );
}
