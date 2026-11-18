import Link from "next/link";
import { Clapperboard, Loader2, TriangleAlert } from "lucide-react";
import { ago, clock } from "@/lib/format";
import { SourceIcon } from "./brand";
import { Badge, ScoreBadge, cx, type Tone } from "./ui";

export interface ClipCardData {
  id: string;
  status: string;
  title: string;
  score: number;
  startSec: number;
  endSec: number;
  hasFinal: boolean;
  renderedAt: Date | null;
  createdAt: Date;
  streamer: { displayName: string; platform: string } | null;
  recording: { author: string | null } | null;
  publications: Array<{ status: string }>;
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  READY: { label: "À valider", tone: "violet" },
  APPROVED: { label: "Approuvé", tone: "ok" },
  REJECTED: { label: "Écarté", tone: "neutral" },
  FAILED: { label: "Échec", tone: "bad" },
  PROCESSING: { label: "Montage…", tone: "warn" },
};

export function clipStatus(clip: { status: string; publications: Array<{ status: string }> }): { label: string; tone: Tone } {
  if (clip.publications.some((p) => p.status === "PUBLISHED")) return { label: "Publié", tone: "brand" };
  if (clip.publications.some((p) => ["QUEUED", "UPLOADING", "PROCESSING"].includes(p.status))) return { label: "Programmé", tone: "ok" };
  return STATUS[clip.status] ?? { label: clip.status, tone: "neutral" };
}

export function ClipCard({ clip }: { clip: ClipCardData }) {
  const status = clipStatus(clip);
  const author = clip.streamer?.displayName ?? clip.recording?.author ?? "Import";
  return (
    <Link
      href={`/app/clips/${clip.id}`}
      className="group block overflow-hidden rounded-2xl border border-line bg-surface transition hover:-translate-y-0.5 hover:border-line-strong"
    >
      <div className="relative aspect-[9/16] bg-surface-2">
        {clip.hasFinal ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/media/${clip.id}/thumb.jpg?v=${clip.renderedAt?.getTime() ?? 0}`}
            alt=""
            loading="lazy"
            className="size-full object-cover transition group-hover:scale-[1.02]"
          />
        ) : (
          <div className="grid size-full place-items-center text-faint">
            {clip.status === "FAILED" ? <TriangleAlert className="size-7" /> : clip.status === "PROCESSING" ? <Loader2 className="size-7 animate-spin" /> : <Clapperboard className="size-7" />}
          </div>
        )}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
          <Badge tone={status.tone} className="bg-bg/85 backdrop-blur">{status.label}</Badge>
          {clip.status !== "PROCESSING" ? <ScoreBadge score={clip.score} className="bg-bg/85 backdrop-blur" /> : null}
        </div>
        <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">
          {clock(clip.endSec - clip.startSec)}
        </span>
      </div>
      <div className="p-3">
        <p className={cx("line-clamp-2 min-h-10 text-sm font-semibold leading-5", !clip.title && "text-faint")}>
          {clip.title || "Titre en cours de génération…"}
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          {clip.streamer ? <SourceIcon platform={clip.streamer.platform} className="size-3.5 shrink-0" /> : null}
          <span className="truncate">{author}</span>
          <span className="shrink-0 text-faint">· {ago(clip.createdAt)}</span>
        </p>
      </div>
    </Link>
  );
}
