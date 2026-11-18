"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Check, Clapperboard, Layers, Loader2, TriangleAlert, Undo2, X } from "lucide-react";
import { reviewClip, type ReviewDecision } from "@/app/actions/review";
import { SourceIcon } from "./brand";
import { claimPlayback, useExclusivePlayback } from "./phone-preview";
import { Badge, ScoreBadge, cx, type Tone } from "./ui";

export interface ClipTileData {
  id: string;
  status: string;
  title: string;
  score: number;
  durationLabel: string;
  agoLabel: string;
  hasFinal: boolean;
  version: number;
  author: string;
  platform: string | null;
  statusLabel: string;
  statusTone: Tone;
}

/**
 * Carte de clip pour la liste : aperçu vidéo muet au survol (souris uniquement),
 * et approbation / mise à l'écart sans ouvrir le clip.
 */
export function ClipTile({ clip }: { clip: ClipTileData }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovering, setHovering] = useState(false);
  const [status, setStatus] = useState(clip.status);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useExclusivePlayback(videoRef);

  const enter = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !clip.hasFinal) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Petit délai : survoler la grille en passant ne charge pas toutes les vidéos.
    timer.current = setTimeout(() => setHovering(true), 250);
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    setHovering(false);
  };

  const act = (s: ReviewDecision) => {
    const prev = status;
    setStatus(s);
    setError(null);
    startTransition(async () => {
      const res = await reviewClip(clip.id, s);
      if (res.error) {
        setStatus(prev);
        setError(res.error);
      }
    });
  };

  const decided = status !== clip.status;
  const label = decided ? (status === "APPROVED" ? "Approuvé" : status === "REJECTED" ? "Écarté" : "À valider") : clip.statusLabel;
  const tone: Tone = decided ? (status === "APPROVED" ? "ok" : status === "REJECTED" ? "neutral" : "violet") : clip.statusTone;
  const canDecide = status === "READY" || status === "APPROVED" || status === "REJECTED";

  return (
    <div
      className={cx("group relative overflow-hidden rounded-2xl border border-line bg-surface transition hover:-translate-y-0.5 hover:border-line-strong", status === "REJECTED" && decided && "opacity-60")}
      onPointerEnter={enter}
      onPointerLeave={leave}
    >
      <Link href={`/app/clips/${clip.id}`} className="block" aria-label={clip.title || "Clip sans titre"}>
        <div className="relative aspect-[9/16] bg-surface-2">
          {clip.hasFinal ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/media/${clip.id}/thumb.jpg?v=${clip.version}`} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center text-faint">
              {clip.status === "FAILED" ? <TriangleAlert className="size-7" /> : clip.status === "PROCESSING" ? <Loader2 className="size-7 animate-spin" /> : <Clapperboard className="size-7" />}
            </div>
          )}
          {hovering ? (
            <video
              ref={videoRef}
              src={`/api/media/${clip.id}/final.mp4?v=${clip.version}`}
              muted
              loop
              playsInline
              autoPlay
              preload="auto"
              onPlay={(e) => claimPlayback(e.currentTarget)}
              className="rise-in absolute inset-0 size-full object-cover"
            />
          ) : null}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
            <Badge tone={tone} className="bg-bg/85 backdrop-blur">{label}</Badge>
            {clip.status !== "PROCESSING" ? <ScoreBadge score={clip.score} className="bg-bg/85 backdrop-blur" /> : null}
          </div>
          <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">{clip.durationLabel}</span>
        </div>
        <div className="p-3">
          <p className={cx("line-clamp-2 min-h-10 text-sm font-semibold leading-5", !clip.title && "text-faint")}>{clip.title || "Titre en cours de génération…"}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            {clip.platform ? <SourceIcon platform={clip.platform} className="size-3.5 shrink-0" /> : null}
            <span className="truncate">{clip.author}</span>
            <span className="shrink-0 text-faint">· {clip.agoLabel}</span>
          </p>
        </div>
      </Link>

      {canDecide ? (
        <div className="absolute left-2 right-2 top-[42%] flex justify-center gap-2 transition sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100">
          {decided ? (
            <button type="button" disabled={pending} onClick={() => act(clip.status as ReviewDecision)} className="flex h-9 items-center gap-1.5 rounded-full bg-black/75 px-3 text-xs font-semibold text-white backdrop-blur transition hover:bg-black/90" aria-label="Annuler">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />} Annuler
            </button>
          ) : (
            <>
              {status !== "REJECTED" ? (
                <button type="button" disabled={pending} onClick={() => act("REJECTED")} title="Écarter" aria-label={`Écarter « ${clip.title || "ce clip"} »`} className="grid size-10 place-items-center rounded-full bg-black/75 text-white backdrop-blur transition hover:scale-105 hover:bg-bad">
                  <X className="size-5" />
                </button>
              ) : null}
              {status === "READY" ? (
                <Link href={`/app/review?start=${clip.id}`} title="Trier à partir de ce clip" aria-label="Ouvrir le mode validation à partir de ce clip" className="grid size-10 place-items-center rounded-full bg-black/75 text-white backdrop-blur transition hover:scale-105 hover:bg-violet">
                  <Layers className="size-4" />
                </Link>
              ) : null}
              {status !== "APPROVED" ? (
                <button type="button" disabled={pending} onClick={() => act("APPROVED")} title="Approuver" aria-label={`Approuver « ${clip.title || "ce clip"} »`} className="grid size-10 place-items-center rounded-full bg-black/75 text-white backdrop-blur transition hover:scale-105 hover:bg-ok hover:text-black">
                  <Check className="size-5" />
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {error ? <p role="alert" className="px-3 pb-3 text-xs text-bad">{error}</p> : null}
    </div>
  );
}
