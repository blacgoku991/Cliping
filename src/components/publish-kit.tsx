import type { SocialPlatform } from "@prisma/client";
import { CalendarClock, Check, ChevronDown, MessageCircleQuestion, MessagesSquare, Pin, Type, Wand2 } from "lucide-react";
import Link from "next/link";
import { applyKitTitle, saveClipKit } from "@/app/actions/coach";
import { aiAvailable } from "@/lib/coach/ai";
import { LIMITS, charCount } from "@/lib/coach/limits";
import { MIN_GAP_HOURS, suggestSlot } from "@/lib/coach/timing";
import { TONES, parsePublishKit, type PlatformKit } from "@/lib/coach/types";
import { db } from "@/lib/db";
import { ActionForm, SubmitButton } from "./action-form";
import { SocialIcon } from "./brand";
import { LocalTime } from "./client";
import { AiNotice, SourceBadge } from "./coach/ai-notice";
import { CopyButton } from "./coach/copy-button";
import { Card, CardHeader, Select, cx } from "./ui";

const ORDER: SocialPlatform[] = ["TIKTOK", "YOUTUBE"];

/**
 * Carte « Kit de publication » de la page d'un clip : légende par plateforme, commentaires à épingler,
 * réponses types et créneau conseillé. Charge elle-même ses données pour rester autonome dans la page.
 */
export async function PublishKitCard({ clipId, userId, currentTitle, disabled }: { clipId: string; userId: string; currentTitle: string; disabled?: boolean }) {
  const [clip, busy] = await Promise.all([
    db.clip.findFirst({ where: { id: clipId, userId }, select: { publishKit: true } }),
    db.publication.findMany({
      where: {
        userId,
        status: { in: ["QUEUED", "UPLOADING", "PROCESSING", "PUBLISHED"] },
        scheduledAt: { gte: new Date(Date.now() - 86_400_000) },
      },
      select: { scheduledAt: true, publishedAt: true, account: { select: { platform: true } } },
    }),
  ]);
  if (!clip) return null;
  const kit = parsePublishKit(clip.publishKit);
  const ai = aiAvailable();
  const now = new Date();

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Wand2 className="size-4 text-brand" /> Kit de publication</span>}
        hint="Légende, commentaires à épingler, réponses types et créneau conseillé, pour chaque plateforme."
      />
      <div className="space-y-5 p-5">
        {!ai ? <AiNotice available={false} compact /> : null}

        {kit ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
              <SourceBadge source={kit.source} />
              {kit.generatedAt ? <span>préparé le <LocalTime iso={kit.generatedAt} /></span> : null}
            </div>
            {ORDER.filter((p) => kit.platforms[p]).map((p, i) => {
              const times = busy.filter((b) => b.account.platform === p).map((b) => b.publishedAt ?? b.scheduledAt);
              return <PlatformSection key={p} open={i === 0} clipId={clipId} platform={p} kit={kit.platforms[p]!} currentTitle={currentTitle} slot={suggestSlot(now, times)} />;
            })}
          </>
        ) : (
          <p className="text-sm leading-relaxed text-muted">
            Prépare en un clic ce qu&apos;il faut pour publier ce clip : la légende adaptée à chaque plateforme, des questions à épingler en commentaire, des réponses prêtes pour les commentaires fréquents.
          </p>
        )}

        <ActionForm action={saveClipKit} className="flex flex-wrap items-end gap-3" messageClassName="w-full">
          <input type="hidden" name="id" value={clipId} />
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Ton des réponses</span>
            <Select name="tone" defaultValue="chaleureux" className="h-9 w-40">
              {Object.entries(TONES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </label>
          <SubmitButton variant={kit ? "secondary" : "primary"} disabled={disabled} pendingLabel="Préparation…">
            <Wand2 className="size-4" /> {kit ? "Régénérer le kit" : "Préparer le kit"}
          </SubmitButton>
        </ActionForm>
        <p className="text-xs text-faint">
          Besoin de répondre à un commentaire précis ? <Link href="/app/coach/reponses" className="font-semibold text-brand hover:underline">Aide aux réponses</Link>
        </p>
      </div>
    </Card>
  );
}

function PlatformSection({ open, clipId, platform, kit, currentTitle, slot }: { open: boolean; clipId: string; platform: SocialPlatform; kit: PlatformKit; currentTitle: string; slot: Date }) {
  const l = LIMITS[platform];
  const tags = kit.hashtags.map((t) => "#" + t).join(" ");
  const full = [kit.caption, tags].filter(Boolean).join("\n\n");
  const applied = kit.title.trim() === currentTitle.trim();
  return (
    <details open={open} className="group rounded-2xl border border-line bg-bg">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold group-open:border-b group-open:border-line [&::-webkit-details-marker]:hidden">
        <SocialIcon platform={platform} className="size-4" /> {l.label}
        <ChevronDown className="ml-auto size-4 text-faint transition group-open:rotate-180" />
      </summary>
      <div className="divide-y divide-line">
        <Block icon={<Type className="size-3.5" />} title="Titre" meta={`${charCount(kit.title)}/${l.title.max}`}>
          <p className="text-sm font-medium leading-snug">{kit.title}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <CopyButton text={kit.title} />
            {applied ? (
              <span className="inline-flex h-8 items-center gap-1.5 px-1 text-xs font-medium text-ok"><Check className="size-3.5" /> Titre actuel du clip</span>
            ) : (
              <ActionForm action={applyKitTitle} className="contents" messageClassName="w-full text-xs">
                <input type="hidden" name="id" value={clipId} />
                <input type="hidden" name="platform" value={platform} />
                <SubmitButton size="sm" pendingLabel="…">Utiliser ce titre</SubmitButton>
              </ActionForm>
            )}
          </div>
        </Block>

        <Block icon={<MessagesSquare className="size-3.5" />} title={platform === "YOUTUBE" ? "Description et hashtags" : "Légende et hashtags"}>
          <p className="whitespace-pre-line break-words text-sm leading-relaxed text-muted">{full}</p>
          <CopyButton text={full} className="mt-2.5" />
        </Block>

        <Block
          icon={<Pin className="size-3.5" />}
          title="À épingler en commentaire"
          meta={platform === "YOUTUBE" ? "un seul épinglé possible" : undefined}
        >
          <ul className="space-y-2">
            {kit.pinnedComments.map((c) => (
              <li key={c} className="flex items-start gap-2">
                <p className="min-w-0 flex-1 break-words text-sm leading-relaxed">{c}</p>
                <CopyButton text={c} compact label="Copier le commentaire" />
              </li>
            ))}
          </ul>
        </Block>

        <Block icon={<MessageCircleQuestion className="size-3.5" />} title="Réponses aux commentaires fréquents">
          <ul className="space-y-3">
            {kit.replies.map((r) => (
              <li key={r.comment} className="flex items-start gap-2">
                <div className="min-w-0 flex-1 text-sm leading-relaxed">
                  <p className="text-xs text-faint">« {r.comment} »</p>
                  <p className="mt-0.5 break-words">{r.reply}</p>
                </div>
                <CopyButton text={r.reply} compact label="Copier la réponse" />
              </li>
            ))}
          </ul>
        </Block>

        <Block icon={<CalendarClock className="size-3.5" />} title="Créneau conseillé">
          <p className="text-sm leading-relaxed">
            <strong className={cx("font-semibold")}><LocalTime iso={slot.toISOString()} /></strong>
            <span className="text-muted"> — le premier créneau qui laisse au moins {MIN_GAP_HOURS} h avec tes autres publications {l.label}.</span>
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-faint">
            Cliping ne connaît pas les heures où ton public est connecté : regarde-les dans{" "}
            {platform === "TIKTOK" ? "les statistiques TikTok (onglet Abonnés)" : "YouTube Studio (Audience → Quand vos spectateurs sont sur YouTube)"} et ajuste.
            Programme la publication dans la carte « Publier ».
          </p>
        </Block>
      </div>
    </details>
  );
}

function Block({ icon, title, meta, children }: { icon: React.ReactNode; title: string; meta?: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3.5">
      <p className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
        <span className="flex items-center gap-1.5">{icon}{title}</span>
        {meta ? <span className="font-normal normal-case tracking-normal">{meta}</span> : null}
      </p>
      {children}
    </div>
  );
}
