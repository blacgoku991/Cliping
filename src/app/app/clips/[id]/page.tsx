import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Download, ExternalLink, Loader2, MessageSquare, RotateCcw, Sparkles, Trash2, Volume2, X, Zap } from "lucide-react";
import { deleteClip, retryClip, setClipStatus } from "@/app/actions/clips";
import { SocialIcon, SourceIcon } from "@/components/brand";
import { AutoRefresh, ConfirmButton, LocalTime } from "@/components/client";
import { clipStatus } from "@/components/clip-card";
import { ClipEditor } from "@/components/clip-editor";
import { PublishPanel } from "@/components/publish-panel";
import { Badge, Button, Card, CardHeader, Notice, ScoreBadge, buttonClass, type Tone } from "@/components/ui";
import { db } from "@/lib/db";
import { ago, clock } from "@/lib/format";
import { PLATFORMS } from "@/lib/platforms";
import { requireUser } from "@/lib/session";
import { effectiveEdit, montageSummary, parseSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Clip" };

const PUB_STATUS: Record<string, { label: string; tone: Tone }> = {
  QUEUED: { label: "Programmé", tone: "violet" },
  UPLOADING: { label: "Envoi…", tone: "warn" },
  PROCESSING: { label: "Traitement…", tone: "warn" },
  PUBLISHED: { label: "Publié", tone: "ok" },
  FAILED: { label: "Échec", tone: "bad" },
  CANCELED: { label: "Annulé", tone: "neutral" },
};

function Signal({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  const level = Math.min(100, Math.round((value / 6) * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted">{icon}{label}</span>
        <span className="tabular-nums text-faint">×{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="brand-gradient h-full rounded-full" style={{ width: `${level}%` }} /></div>
    </div>
  );
}

function hookAnglesOf(signals: unknown): string[] {
  const a = (signals as { hookAngles?: unknown } | null)?.hookAngles;
  return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
}

export default async function ClipPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const clip = await db.clip.findFirst({
    where: { id, userId: user.id },
    include: {
      streamer: true,
      recording: { select: { author: true, title: true, category: true, source: true, sourceUrl: true } },
      publications: { include: { account: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!clip) notFound();

  const [accounts, rendering] = await Promise.all([
    db.socialAccount.findMany({ where: { userId: user.id }, orderBy: [{ platform: "asc" }, { createdAt: "asc" }] }),
    db.job.count({ where: { type: "clip.render", status: { in: ["PENDING", "RUNNING"] }, payload: { path: ["clipId"], equals: id } } }),
  ]);

  const status = clipStatus(clip);
  const signals = (clip.signals ?? {}) as { audio?: number; chat?: number | null; scene?: number | null; ai?: number | null; reason?: string };
  const busy = clip.status === "PROCESSING" || rendering > 0;
  const version = clip.renderedAt?.getTime() ?? 0;
  const author = clip.streamer?.displayName ?? clip.recording?.author ?? "Import";
  const active = new Map(
    clip.publications.filter((p) => ["QUEUED", "UPLOADING", "PROCESSING", "PUBLISHED"].includes(p.status)).map((p) => [p.accountId, PUB_STATUS[p.status]!.label]),
  );

  return (
    <>
      {busy || clip.publications.some((p) => ["QUEUED", "UPLOADING", "PROCESSING"].includes(p.status)) ? <AutoRefresh seconds={4} /> : null}
      <Link href="/app/clips" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Tous les clips
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* Colonne vidéo */}
        <div className="space-y-4 lg:sticky lg:top-8 lg:self-start">
          <div className="relative mx-auto aspect-[9/16] w-full max-w-[340px] overflow-hidden rounded-2xl border border-line bg-black">
            {clip.hasFinal ? (
              <video
                key={version}
                controls
                playsInline
                preload="metadata"
                poster={`/api/media/${clip.id}/thumb.jpg?v=${version}`}
                src={`/api/media/${clip.id}/final.mp4?v=${version}`}
                className="size-full"
              />
            ) : (
              <div className="grid size-full place-items-center px-6 text-center text-sm text-muted">
                {clip.status === "FAILED" ? "Le montage a échoué." : <span className="flex flex-col items-center gap-3"><Loader2 className="size-7 animate-spin" />Montage en cours…</span>}
              </div>
            )}
            {busy && clip.hasFinal ? (
              <div className="absolute inset-x-3 top-3 flex items-center gap-2 rounded-xl bg-black/80 px-3 py-2 text-xs font-medium backdrop-blur">
                <Loader2 className="size-3.5 animate-spin" /> Remontage en cours…
              </div>
            ) : null}
          </div>

          <div className="mx-auto flex max-w-[340px] flex-wrap gap-2">
            {clip.hasFinal ? (
              <a href={`/api/media/${clip.id}/final.mp4?download=1`} className={buttonClass({ variant: "secondary" }, "flex-1")}>
                <Download className="size-4" /> Télécharger
              </a>
            ) : null}
            {clip.status === "READY" || clip.status === "REJECTED" ? (
              <form action={setClipStatus} className="flex-1">
                <input type="hidden" name="id" value={clip.id} />
                <input type="hidden" name="status" value="APPROVED" />
                <Button type="submit" className="w-full"><Check className="size-4 text-ok" /> Approuver</Button>
              </form>
            ) : null}
            {clip.status === "READY" || clip.status === "APPROVED" ? (
              <form action={setClipStatus} className="flex-1">
                <input type="hidden" name="id" value={clip.id} />
                <input type="hidden" name="status" value="REJECTED" />
                <Button type="submit" className="w-full"><X className="size-4 text-muted" /> Écarter</Button>
              </form>
            ) : null}
            <form action={deleteClip}>
              <input type="hidden" name="id" value={clip.id} />
              <ConfirmButton variant="ghost" message="Supprimer définitivement ce clip et ses fichiers ?" aria-label="Supprimer le clip" title="Supprimer">
                <Trash2 className="size-4" />
              </ConfirmButton>
            </form>
          </div>
        </div>

        {/* Colonne édition */}
        <div className="min-w-0 space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={status.tone}>{status.label}</Badge>
              {clip.status !== "PROCESSING" ? <ScoreBadge score={clip.score} /> : null}
              <span className="flex items-center gap-1.5 text-sm text-muted">
                {clip.streamer ? <SourceIcon platform={clip.streamer.platform} className="size-4" /> : null}
                {author}
              </span>
              <span className="text-sm text-faint">· capté {ago(clip.createdAt)} · à {clock(clip.originSec + clip.peakSec)} du {clip.recording?.source === "VOD" ? "replay" : "live"}</span>
            </div>
            <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight">{clip.title || "Clip en préparation"}</h1>
            {clip.recording?.title ? <p className="mt-1 truncate text-sm text-muted">{[clip.recording.category, clip.recording.title].filter(Boolean).join(" · ")}</p> : null}
          </div>

          {clip.status === "FAILED" ? (
            <Notice tone="bad">
              <p className="font-medium">Le montage de ce clip a échoué.</p>
              {clip.error ? <p className="mt-1 break-words text-xs opacity-90">{clip.error}</p> : null}
              <form action={retryClip} className="mt-3">
                <input type="hidden" name="id" value={clip.id} />
                <Button type="submit" size="sm"><RotateCcw className="size-3.5" /> Réessayer</Button>
              </form>
            </Notice>
          ) : clip.error ? (
            <Notice tone="warn">{clip.error}</Notice>
          ) : null}

          <Card>
            <CardHeader title="Pourquoi ce moment" hint="À quel point chaque signal sortait de l'ordinaire pour ce stream." />
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <Signal icon={<Volume2 className="size-3.5" />} label="Volume / voix" value={signals.audio} />
              <Signal icon={<MessageSquare className="size-3.5" />} label="Réaction du chat" value={signals.chat} />
              <Signal icon={<Zap className="size-3.5" />} label="Action à l'écran" value={signals.scene} />
            </div>
            {signals.reason ? (
              <p className="flex gap-2 border-t border-line px-5 py-4 text-sm leading-relaxed text-muted">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" />
                <span>{signals.reason}{typeof signals.ai === "number" ? <span className="text-faint"> — note de l&apos;IA : {signals.ai}/100</span> : null}</span>
              </p>
            ) : null}
          </Card>

          {clip.status !== "PROCESSING" ? (
            <Card>
              <CardHeader title="Retoucher" hint="Modifier l'accroche, la découpe, la mise en page ou les sous-titres relance le montage (une dizaine de secondes)." />
              <div className="p-5">
                <ClipEditor
                  key={`${clip.id}-${version}-${clip.title}`}
                  clip={{
                    id: clip.id,
                    title: clip.title,
                    hook: clip.hook,
                    description: clip.description,
                    hashtags: clip.hashtags,
                    captions: clip.captions,
                    template: clip.template,
                    startSec: clip.startSec,
                    endSec: clip.endSec,
                    sourceDur: clip.sourceDur,
                    peakSec: clip.peakSec,
                    titleOptions: clip.titleOptions,
                    hookOptions: clip.hookOptions,
                    hookAngles: hookAnglesOf(clip.signals),
                    edit: effectiveEdit(parseSettings(user.settings), clip.edit),
                    montage: montageSummary(clip.montage),
                  }}
                  hasFacecam={!!clip.streamer?.facecam}
                  hasTranscript={Array.isArray(clip.transcript) && clip.transcript.length > 0}
                />
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Publier" hint="Choisis les comptes, puis envoie tout de suite ou programme pour plus tard." />
            <div className="p-5">
              <PublishPanel
                clipId={clip.id}
                disabled={busy || !clip.hasFinal}
                accounts={accounts.map((a) => ({ id: a.id, platform: a.platform, displayName: a.displayName, handle: a.handle, valid: a.valid, already: active.get(a.id) ?? null }))}
                platforms={Object.values(PLATFORMS).map((p) => ({ id: p.id, label: p.label, defaultPrivacy: p.defaultPrivacy, options: p.privacyOptions }))}
              />
            </div>
            {clip.publications.length > 0 ? (
              <ul className="divide-y divide-line border-t border-line">
                {clip.publications.map((p) => {
                  const s = PUB_STATUS[p.status] ?? { label: p.status, tone: "neutral" as Tone };
                  return (
                    <li key={p.id} className="px-5 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <SocialIcon platform={p.account.platform} className="size-4 shrink-0" />
                        <span className="font-medium">{p.account.displayName}</span>
                        <Badge tone={s.tone}>{s.label}</Badge>
                        <span className="text-xs text-faint">
                          {p.status === "QUEUED" ? <>pour le <LocalTime iso={p.scheduledAt.toISOString()} /></> : p.publishedAt ? <LocalTime iso={p.publishedAt.toISOString()} /> : null}
                        </span>
                        {p.externalUrl ? (
                          <a href={p.externalUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                            Voir <ExternalLink className="size-3" />
                          </a>
                        ) : null}
                      </div>
                      {p.error ? <p className="mt-1.5 break-words text-xs text-bad">{p.error}</p> : null}
                      {p.note ? <p className="mt-1.5 text-xs text-muted">{p.note}</p> : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
