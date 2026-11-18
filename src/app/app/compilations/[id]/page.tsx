import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, Film, ListOrdered, Plus, Trash2 } from "lucide-react";
import { addMoments, deleteCompilation } from "@/app/actions/compilations";
import { AutoRefresh, ConfirmButton, LocalTime } from "@/components/client";
import { ClipPicker } from "@/components/compilation/clip-picker";
import { CompilationEditor } from "@/components/compilation/compilation-editor";
import { CompilationPublish } from "@/components/compilation/compilation-publish";
import { COMPILATION_STATUS } from "@/components/compilation/status";
import { Badge, Card, CardHeader, LinkButton, Notice, PageHeader, type Tone } from "@/components/ui";
import { ACTIVE_PUB } from "@/lib/batch";
import { chapterTime, chaptersValid, cleanLabel, fullDescription, MAX_MOMENTS, montageSignature, type Chapter } from "@/lib/compilation";
import { compilationCredits } from "@/lib/compilation-credits";
import { ELIGIBLE } from "@/lib/compilation-proposals";
import { db } from "@/lib/db";
import { ago, clock } from "@/lib/format";
import { PLATFORMS } from "@/lib/platforms";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Compilation" };

const PUB_STATUS: Record<string, { label: string; tone: Tone }> = {
  QUEUED: { label: "Programmé", tone: "violet" },
  UPLOADING: { label: "Envoi en cours", tone: "warn" },
  PROCESSING: { label: "Traitement par YouTube", tone: "warn" },
  PUBLISHED: { label: "Publié", tone: "ok" },
  FAILED: { label: "Échec", tone: "bad" },
  CANCELED: { label: "Annulé", tone: "neutral" },
};

interface Montage {
  duration?: number;
  intro?: number;
  signature?: string;
  renderMs?: number;
  moments?: Array<{ at: number; number: number; label: string }>;
}

export default async function CompilationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const comp = await db.compilation.findFirst({
    where: { id, userId: user.id },
    include: {
      items: {
        orderBy: { position: "asc" },
        include: { clip: { include: { streamer: { select: { displayName: true } }, recording: { select: { author: true } } } } },
      },
      publications: { include: { account: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!comp) notFound();

  const inComp = new Set(comp.items.map((i) => i.clipId));
  const [accounts, credits, extra] = await Promise.all([
    db.socialAccount.findMany({ where: { userId: user.id, platform: "YOUTUBE" }, orderBy: { createdAt: "asc" } }),
    compilationCredits(id),
    db.clip.findMany({
      where: { userId: user.id, ...ELIGIBLE, id: { notIn: [...inComp] } },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take: 60,
      include: { streamer: { select: { displayName: true } }, recording: { select: { author: true } } },
    }),
  ]);

  const montage = (comp.montage ?? {}) as Montage;
  const total = montage.duration ?? 0;
  const chapters = Array.isArray(comp.chapters) ? (comp.chapters as unknown as Chapter[]) : [];
  const signature = montageSignature({
    items: comp.items.map((i) => ({ clipId: i.clipId, label: i.label, start: i.clip.startSec, end: i.clip.endSec })),
    countdown: comp.countdown,
    captions: comp.captions,
    intro: comp.intro,
    title: comp.title,
  });
  const stale = comp.hasFinal && montage.signature !== signature;
  const rendering = comp.status === "RENDERING";
  const activePub = comp.publications.some((p) => ["QUEUED", "UPLOADING", "PROCESSING"].includes(p.status));
  const s = COMPILATION_STATUS[comp.status] ?? COMPILATION_STATUS.DRAFT!;
  const v = comp.renderedAt?.getTime() ?? 0;
  const blocker = rendering
    ? "Le montage est en cours."
    : !comp.hasFinal
      ? "Monte la vidéo avant de la publier."
      : stale
        ? "Tu as modifié la compilation depuis le dernier montage : remonte-la avant de publier."
        : null;
  const description = fullDescription({ text: comp.description, chapters: chaptersValid(chapters, total) ? chapters : [], total, credits, tags: comp.tags });
  const alreadyOn = new Map(
    comp.publications.filter((p) => (ACTIVE_PUB as readonly string[]).includes(p.status)).map((p) => [p.accountId, PUB_STATUS[p.status]!.label]),
  );

  return (
    <>
      {rendering || activePub || comp.metaPending ? <AutoRefresh seconds={4} /> : null}
      <PageHeader
        title={comp.title || "Nouvelle compilation"}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={s.tone}>{s.label}</Badge>
            <span>{comp.items.length} moments{total ? ` · ${clock(total)}` : ""} · créée {ago(comp.createdAt)}</span>
          </span>
        }
        action={<LinkButton href="/app/compilations" variant="ghost" size="sm"><ArrowLeft className="size-3.5" /> Compilations</LinkButton>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Card className="overflow-hidden">
            <div className="relative aspect-video bg-black">
              {comp.hasFinal && !rendering ? (
                <video key={v} src={`/api/compilations/${id}/final.mp4?v=${v}`} poster={comp.hasThumb ? `/api/compilations/${id}/thumb.jpg?v=${v}` : undefined} controls preload="metadata" className="size-full" />
              ) : (
                <div className="absolute inset-0 grid place-items-center p-6 text-center">
                  <div className="w-full max-w-sm">
                    <Film className="mx-auto mb-3 size-8 text-faint" aria-hidden />
                    {rendering ? (
                      <>
                        <p className="font-semibold">Montage en cours… {Math.round(comp.progress * 100)} %</p>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(comp.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Avancement du montage">
                          <div className="h-full brand-gradient transition-all" style={{ width: `${Math.max(3, Math.round(comp.progress * 100))}%` }} />
                        </div>
                        <p className="mt-2 text-sm text-muted">{comp.metaPending ? "Préparation du titre et de la description…" : "Tu peux quitter la page, le montage continue."}</p>
                      </>
                    ) : (
                      <p className="text-sm text-muted">Pas encore de vidéo. Range les moments ci-dessous puis clique sur « Enregistrer et monter ».</p>
                    )}
                  </div>
                </div>
              )}
            </div>
            {comp.hasFinal ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-sm text-muted">
                <span>Monté {comp.renderedAt ? ago(comp.renderedAt) : ""}{montage.renderMs ? ` en ${Math.round(montage.renderMs / 1000)} s` : ""}</span>
                <a href={`/api/compilations/${id}/final.mp4?download`} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 text-xs font-semibold text-ink hover:border-line-strong">
                  <Download className="size-3.5" /> Télécharger
                </a>
              </div>
            ) : null}
          </Card>

          {comp.status === "FAILED" && comp.error ? <Notice tone="bad">{comp.error}</Notice> : null}
          {stale && !rendering ? <Notice tone="warn">La liste a changé depuis le dernier montage : la vidéo et les chapitres ci-dessous correspondent à l'ancienne version. Clique sur « Enregistrer et monter ».</Notice> : null}

          <Card>
            <CardHeader title="Moments et habillage" hint="Tout ce que tu changes ici est pris en compte au prochain montage." />
            <div className="p-4 sm:p-5">
              <CompilationEditor
                // Remonté seulement quand le contenu change hors de l'éditeur (titre proposé par l'IA, fin de montage,
                // moments ajoutés) ; pas après un simple enregistrement, pour garder le message de confirmation.
                key={`${comp.metaPending}|${montage.signature ?? ""}|${[...inComp].sort().join(",")}`}
                id={id}
                busy={rendering}
                moments={comp.items.map((i) => ({
                  clipId: i.clipId,
                  label: i.label,
                  title: cleanLabel(i.clip.title),
                  streamer: i.clip.streamer?.displayName ?? i.clip.recording?.author ?? "",
                  duration: i.clip.endSec - i.clip.startSec,
                  score: i.clip.score,
                  thumb: i.clip.hasFinal ? `/api/media/${i.clipId}/thumb.jpg?v=${i.clip.renderedAt?.getTime() ?? 0}` : null,
                }))}
                values={{
                  title: comp.title,
                  description: comp.description,
                  tags: comp.tags.join(", "),
                  thumbText: comp.thumbText,
                  countdown: comp.countdown,
                  captions: comp.captions,
                  intro: comp.intro,
                }}
              />
            </div>
          </Card>

          {extra.length && comp.items.length < MAX_MOMENTS ? (
            <details className="group rounded-2xl border border-line bg-surface">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 font-semibold">
                <Plus className="size-4 text-brand" /> Ajouter des moments
                <span className="text-sm font-normal text-muted">({extra.length} clips disponibles)</span>
              </summary>
              <div className="border-t border-line p-4 sm:p-5">
                <ClipPicker
                  action={addMoments}
                  hidden={{ id }}
                  submitLabel="Ajouter à la fin"
                  max={MAX_MOMENTS - comp.items.length}
                  clips={extra.map((c) => ({
                    id: c.id,
                    title: c.title,
                    streamer: c.streamer?.displayName ?? c.recording?.author ?? "",
                    score: c.score,
                    duration: c.endSec - c.startSec,
                    thumb: c.hasFinal ? `/api/media/${c.id}/thumb.jpg?v=${c.renderedAt?.getTime() ?? 0}` : null,
                    when: ago(c.createdAt),
                  }))}
                />
              </div>
            </details>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Publier sur YouTube" hint="Vidéo classique, horizontale, avec chapitres et miniature." />
            <div className="p-4 sm:p-5">
              <CompilationPublish
                id={id}
                blocker={blocker}
                privacyOptions={PLATFORMS.YOUTUBE.privacyOptions}
                accounts={accounts.map((a) => ({ id: a.id, displayName: a.displayName, valid: a.valid, already: alreadyOn.get(a.id) ?? null }))}
              />
            </div>
          </Card>

          {comp.publications.length ? (
            <Card>
              <CardHeader title="Envois" />
              <ul className="divide-y divide-line">
                {comp.publications.map((p) => {
                  const st = PUB_STATUS[p.status] ?? { label: p.status, tone: "neutral" as Tone };
                  return (
                    <li key={p.id} className="space-y-1 px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        <span className="truncate font-medium">{p.account.displayName}</span>
                        {p.externalUrl ? (
                          <a href={p.externalUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">Voir <ExternalLink className="size-3" /></a>
                        ) : null}
                      </div>
                      <p className="text-xs text-faint">
                        {p.status === "PUBLISHED" && p.publishedAt ? <LocalTime iso={p.publishedAt.toISOString()} /> : <>prévu le <LocalTime iso={p.scheduledAt.toISOString()} /></>}
                      </p>
                      {p.error ? <p className="break-words text-xs text-bad">{p.error}</p> : null}
                      {p.note ? <p className="text-xs text-muted">{p.note}</p> : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          {comp.hasThumb ? (
            <Card className="overflow-hidden">
              <CardHeader title="Miniature" hint="1280 × 720, image du moment le plus fort. Change le texte dans « Texte de la miniature »." />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/compilations/${id}/thumb.jpg?v=${v}`} alt="Miniature de la compilation" className="aspect-video w-full object-cover" />
            </Card>
          ) : null}

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><ListOrdered className="size-4 text-brand" /> Chapitres</span>} hint="Ajoutés à la description : YouTube les affiche sur la barre de lecture." />
            <div className="p-4 sm:p-5">
              {chapters.length ? (
                <ol className="space-y-1 text-sm">
                  {chapters.map((c) => (
                    <li key={c.at} className="flex gap-3">
                      <span className="w-14 shrink-0 font-mono tabular-nums text-brand">{chapterTime(c.at, total >= 3600)}</span>
                      <span className="min-w-0">{c.title}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted">{comp.hasFinal ? "Pas de chapitres : YouTube en exige au moins 3 de 10 secondes ou plus." : "Calculés au montage."}</p>
              )}
            </div>
          </Card>

          {comp.hasFinal ? (
            <details className="rounded-2xl border border-line bg-surface">
              <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">Description envoyée à YouTube</summary>
              <pre className="whitespace-pre-wrap break-words border-t border-line px-5 py-4 font-sans text-sm leading-relaxed text-muted">{description}</pre>
            </details>
          ) : null}

          <form action={deleteCompilation}>
            <input type="hidden" name="id" value={id} />
            <ConfirmButton variant="danger" size="sm" className="w-full" message="Supprimer cette compilation ? Les clips d'origine sont conservés.">
              <Trash2 className="size-3.5" /> Supprimer la compilation
            </ConfirmButton>
          </form>
        </aside>
      </div>
    </>
  );
}
