"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Bookmark, Camera, Clapperboard, Heart, Home, Inbox, MessageCircle, MoreHorizontal, MoreVertical, Music2, Pause, Play, Plus,
  Repeat2, Search, Send, Share2, ShieldCheck, ThumbsDown, ThumbsUp, User, Users, Volume2, VolumeX,
} from "lucide-react";
import { TikTokIcon, YouTubeIcon } from "./brand";
import { cx } from "./ui";

/** Données minimales d'un clip pour l'aperçu. */
export interface PhoneClip {
  id: string;
  title: string;
  hashtags: string[];
  /** Nom du streamer (crédit) */
  author: string;
  hasFinal: boolean;
  /** Horodatage du dernier montage, pour contourner le cache du navigateur */
  version: number;
}

export type PreviewPlatform = "tiktok" | "shorts" | "reels";

export const PREVIEW_PLATFORMS: Array<{ id: PreviewPlatform; label: string }> = [
  { id: "tiktok", label: "TikTok" },
  { id: "shorts", label: "Shorts" },
  { id: "reels", label: "Reels" },
];

/**
 * Zones masquées par l'interface de chaque plateforme, en % d'une vidéo 1080×1920.
 * Valeurs approximatives tirées des guides publiés par les plateformes (elles varient selon le téléphone).
 */
const SAFE: Record<PreviewPlatform, { top: number; bottom: number; left: number; right: number }> = {
  tiktok: { top: 7, bottom: 22, left: 5, right: 13 },
  shorts: { top: 8, bottom: 24, left: 5, right: 15 },
  reels: { top: 12, bottom: 30, left: 6, right: 14 },
};

// ───────────── Préférences partagées entre tous les aperçus (plateforme, zones sûres) ─────────────

const PREF_EVENT = "cliping:phone-pref";
function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : la préférence ne vaut que pour cette page */
  }
  window.dispatchEvent(new CustomEvent(PREF_EVENT, { detail: { key, value } }));
}
function usePref<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    setValue(readPref(key, allowed, fallback));
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; value: string }>).detail;
      if (d.key === key && (allowed as readonly string[]).includes(d.value)) setValue(d.value as T);
    };
    window.addEventListener(PREF_EVENT, on);
    return () => window.removeEventListener(PREF_EVENT, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [value, (v: T) => writePref(key, v)];
}

const PLATFORM_IDS = ["tiktok", "shorts", "reels"] as const;
const ON_OFF = ["on", "off"] as const;

/** Une seule vidéo joue à la fois dans toute l'application. */
const PLAY_EVENT = "cliping:play";
export function claimPlayback(el: HTMLVideoElement): void {
  window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: el }));
}
export function useExclusivePlayback(ref: React.RefObject<HTMLVideoElement | null>): void {
  useEffect(() => {
    const on = (e: Event) => {
      const other = (e as CustomEvent<HTMLVideoElement>).detail;
      if (ref.current && other !== ref.current && !ref.current.paused) ref.current.pause();
    };
    window.addEventListener(PLAY_EVENT, on);
    return () => window.removeEventListener(PLAY_EVENT, on);
  }, [ref]);
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

// ───────────── Composant ─────────────

const SIZES = { sm: "max-w-[230px]", md: "max-w-[300px]", lg: "max-w-[340px]", fill: "" };

export function PhonePreview({
  clip,
  autoPlay = true,
  size = "md",
  toolbar = true,
  handle = "ton_compte",
  className,
  empty,
  loop = true,
  onEnded,
  overlayBadge,
}: {
  clip: PhoneClip | null;
  autoPlay?: boolean;
  size?: keyof typeof SIZES;
  /** Barre de réglages sous le téléphone (plateforme, zones sûres, son) */
  toolbar?: boolean;
  /** Pseudo affiché dans l'interface simulée */
  handle?: string;
  className?: string;
  /** Contenu de l'écran quand il n'y a pas de clip */
  empty?: ReactNode;
  loop?: boolean;
  onEnded?: () => void;
  /** Pastille posée en haut de l'écran (ex. « En montage… ») */
  overlayBadge?: ReactNode;
}) {
  const [platform, setPlatform] = usePref<PreviewPlatform>("cliping.preview.platform", PLATFORM_IDS, "tiktok");
  const [safe, setSafe] = usePref("cliping.preview.safe", ON_OFF, "off");
  const reduced = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const labelId = useId();
  useExclusivePlayback(videoRef);

  const src = clip?.hasFinal ? `/api/media/${clip.id}/final.mp4?v=${clip.version}` : null;
  const poster = clip?.hasFinal ? `/api/media/${clip.id}/thumb.jpg?v=${clip.version}` : undefined;
  const wantsAuto = autoPlay && !reduced;

  // Lecture seulement quand le téléphone est à l'écran.
  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting && entry.intersectionRatio > 0.35), { threshold: [0, 0.35, 0.7] });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    if (wantsAuto && visible) {
      v.muted = muted;
      claimPlayback(v);
      v.play().catch(() => setPlaying(false));
    } else if (!visible && !v.paused) {
      v.pause();
    }
    // `muted` volontairement absent : couper le son ne doit pas relancer la lecture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, wantsAuto, visible]);

  useEffect(() => {
    setProgress(0);
    setLoading(!!src);
  }, [src]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      claimPlayback(v);
      void v.play().catch(() => {});
    } else v.pause();
  }, []);

  const toggleSound = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const next = !v.muted;
    v.muted = next;
    setMuted(next);
    if (!next && v.paused) {
      claimPlayback(v);
      void v.play().catch(() => {});
    }
  }, []);

  const caption = clip ? [clip.title, ...clip.hashtags.slice(0, 6).map((t) => `#${t}`)].filter(Boolean).join(" ") : "";
  const zone = SAFE[platform];

  return (
    <div className={cx("mx-auto", size !== "fill" && "w-full", SIZES[size], className)}>
      <figure className="relative" aria-labelledby={labelId}>
        <figcaption id={labelId} className="sr-only">
          Aperçu du clip {clip?.title ? `« ${clip.title} »` : ""} tel qu&apos;il apparaîtra sur {PREVIEW_PLATFORMS.find((p) => p.id === platform)?.label}
        </figcaption>
        {/* Halo de marque derrière le téléphone */}
        <div aria-hidden className="phone-glow pointer-events-none absolute -inset-6 -z-10 rounded-[4rem] opacity-70 blur-2xl" />
        {/* Coque */}
        <div className="phone-shell relative rounded-[2.6rem] p-[9px]">
          <span aria-hidden className="absolute -left-[3px] top-[18%] h-10 w-[3px] rounded-l bg-[#2b2838]" />
          <span aria-hidden className="absolute -left-[3px] top-[27%] h-14 w-[3px] rounded-l bg-[#2b2838]" />
          <span aria-hidden className="absolute -right-[3px] top-[22%] h-16 w-[3px] rounded-r bg-[#2b2838]" />
          <div
            ref={screenRef}
            className="relative aspect-[9/16] overflow-hidden rounded-[2rem] bg-black [container-type:inline-size]"
          >
            {src ? (
              <video
                ref={videoRef}
                key={src}
                src={src}
                poster={poster}
                muted={muted}
                loop={loop}
                playsInline
                preload={wantsAuto ? "auto" : "metadata"}
                className="absolute inset-0 size-full object-cover"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onCanPlay={() => setLoading(false)}
                onWaiting={() => setLoading(true)}
                onPlaying={() => setLoading(false)}
                onEnded={() => onEnded?.()}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  if (v.duration) setProgress(v.currentTime / v.duration);
                }}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted" style={{ background: "radial-gradient(80% 60% at 50% 35%, rgb(255 77 141 / 0.2), transparent 70%), radial-gradient(60% 40% at 60% 80%, rgb(139 92 246 / 0.16), transparent 70%), #0b0a10" }}>
                {empty ?? (
                  <span className="flex flex-col items-center gap-3">
                    <Clapperboard className="size-8 text-faint" />
                    Aucun clip à afficher
                  </span>
                )}
              </div>
            )}

            {/* Zone de clic : son au premier clic, puis pause/lecture */}
            {src ? (
              <button
                type="button"
                className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-offset-[-4px]"
                aria-label={muted ? "Activer le son" : playing ? "Mettre en pause" : "Lire"}
                onClick={() => (muted ? toggleSound() : togglePlay())}
              />
            ) : null}

            {src ? <PlatformOverlay platform={platform} caption={caption} handle={handle} author={clip?.author ?? ""} spinning={playing && !reduced} /> : null}

            {/* Barre de progression façon appli */}
            {src ? (
              <div aria-hidden className={cx("pointer-events-none absolute inset-x-0 z-20 h-[2px] bg-white/20", platform === "reels" ? "bottom-[8.5%]" : "bottom-[8%]")}>
                <div className="h-full bg-white/90" style={{ width: `${progress * 100}%` }} />
              </div>
            ) : null}

            {src && safe === "on" ? <SafeZones zone={zone} /> : null}

            {/* État de lecture */}
            {src && (!playing || muted) ? (
              <div aria-hidden className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
                {!playing && !loading ? (
                  <span className="grid size-14 place-items-center rounded-full bg-black/45 backdrop-blur-sm"><Play className="ml-0.5 size-6 fill-white text-white" /></span>
                ) : null}
              </div>
            ) : null}
            {src && muted && playing ? (
              <span aria-hidden className="pointer-events-none absolute left-[3cqw] top-[12%] z-20 grid size-[8cqw] min-h-6 min-w-6 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                <VolumeX className="size-[4.4cqw] min-h-3.5 min-w-3.5" />
              </span>
            ) : null}
            {src && loading && wantsAuto ? (
              <span aria-hidden className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
                <span className="size-8 animate-spin rounded-full border-2 border-white/25 border-t-white motion-reduce:animate-none" />
              </span>
            ) : null}
            {overlayBadge ? <div className="absolute inset-x-3 top-9 z-30">{overlayBadge}</div> : null}

            {/* Barre d'état du téléphone */}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-[7cqw] pt-[2.4cqw] text-[max(9px,3.6cqw)] font-semibold text-white">
              <span>21:37</span>
              <span className="absolute left-1/2 top-[1.8cqw] h-[6.5cqw] w-[26cqw] -translate-x-1/2 rounded-full bg-black" />
              <span className="flex items-center gap-1">
                <span className="flex items-end gap-px">{[3, 5, 7, 9].map((h) => <span key={h} className="w-[2px] rounded-sm bg-white" style={{ height: h }} />)}</span>
                <span className="ml-1 inline-block h-[9px] w-[18px] rounded-[3px] border border-white/80 p-px"><span className="block h-full w-3/4 rounded-[1px] bg-white" /></span>
              </span>
            </div>
          </div>
        </div>
      </figure>

      {toolbar ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
          <div role="radiogroup" aria-label="Interface de la plateforme" className="flex rounded-xl border border-line bg-surface p-1">
            {PREVIEW_PLATFORMS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={platform === p.id}
                onClick={() => setPlatform(p.id)}
                className={cx(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                  platform === p.id ? "bg-surface-2 text-ink shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                <PlatformMark id={p.id} className="size-3.5" />
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={safe === "on"}
            onClick={() => setSafe(safe === "on" ? "off" : "on")}
            title="Montre les parties de la vidéo cachées par l'interface de la plateforme"
            className={cx(
              "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition",
              safe === "on" ? "border-warn/40 bg-warn/10 text-warn" : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            <ShieldCheck className="size-3.5" /> Zones sûres
          </button>
          {src ? (
            <>
              <button type="button" onClick={toggleSound} aria-label={muted ? "Activer le son" : "Couper le son"} aria-pressed={!muted} className="grid size-9 place-items-center rounded-xl border border-line bg-surface text-muted transition hover:text-ink">
                {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </button>
              <button type="button" onClick={togglePlay} aria-label={playing ? "Mettre en pause" : "Lire"} className="grid size-9 place-items-center rounded-xl border border-line bg-surface text-muted transition hover:text-ink">
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {toolbar && safe === "on" && src ? (
        <p className="mt-2 text-center text-[11px] leading-snug text-faint">
          Hachuré : caché par l&apos;interface. Garde l&apos;accroche et les sous-titres dans le cadre. Zones approximatives, elles varient selon les téléphones.
        </p>
      ) : null}
    </div>
  );
}

export function PlatformMark({ id, className }: { id: PreviewPlatform; className?: string }) {
  if (id === "tiktok") return <TikTokIcon className={className} />;
  if (id === "shorts") return <YouTubeIcon className={cx("text-[#ff3333]", className)} />;
  return <Camera className={className} />;
}

function SafeZones({ zone }: { zone: { top: number; bottom: number; left: number; right: number } }) {
  const hatch = "safe-hatch absolute";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[25]">
      <div className={hatch} style={{ left: 0, right: 0, top: 0, height: `${zone.top}%` }} />
      <div className={hatch} style={{ left: 0, right: 0, bottom: 0, height: `${zone.bottom}%` }} />
      <div className={hatch} style={{ left: 0, width: `${zone.left}%`, top: `${zone.top}%`, bottom: `${zone.bottom}%` }} />
      <div className={hatch} style={{ right: 0, width: `${zone.right}%`, top: `${zone.top}%`, bottom: `${zone.bottom}%` }} />
      <div
        className="absolute rounded-md border-2 border-dashed border-ok/90"
        style={{ left: `${zone.left}%`, right: `${zone.right}%`, top: `${zone.top}%`, bottom: `${zone.bottom}%` }}
      >
        <span className="absolute left-1 top-1 rounded bg-ok px-1.5 py-0.5 text-[max(8px,2.8cqw)] font-bold uppercase tracking-wide text-black">Zone sûre</span>
      </div>
    </div>
  );
}

// ───────────── Interfaces simulées ─────────────

function RailButton({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="flex flex-col items-center gap-[0.6cqw]">
      {icon}
      <span className="text-[max(7px,2.6cqw)] font-semibold leading-none">{label}</span>
    </span>
  );
}

const ICON = "size-[8.5cqw] drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]";

function PlatformOverlay({ platform, caption, handle, author, spinning }: { platform: PreviewPlatform; caption: string; handle: string; author: string; spinning: boolean }) {
  const shadow = "[text-shadow:0_1px_2px_rgb(0_0_0/0.7)]";
  if (platform === "tiktok") {
    return (
      <div aria-hidden className={cx("pointer-events-none absolute inset-0 z-[15] text-white", shadow)}>
        <div className="absolute inset-x-0 top-[6.5%] flex items-center justify-center gap-[4cqw] text-[max(9px,3.8cqw)] font-semibold">
          <span className="text-white/60">Suivis</span>
          <span className="border-b-2 border-white pb-[0.5cqw]">Pour toi</span>
          <Search className="absolute right-[4cqw] size-[5.5cqw]" />
        </div>
        <div className="absolute bottom-[11%] right-[2.5cqw] flex flex-col items-center gap-[3.6cqw]">
          <span className="relative mb-[1cqw] grid size-[11cqw] place-items-center rounded-full border-2 border-white bg-gradient-to-br from-brand to-brand-2 text-[4cqw] font-bold">
            {handle.slice(0, 1).toUpperCase()}
            <span className="absolute -bottom-[2cqw] grid size-[4.6cqw] place-items-center rounded-full bg-[#fe2c55]"><Plus className="size-[3.4cqw]" strokeWidth={3} /></span>
          </span>
          <RailButton icon={<Heart className={cx(ICON, "fill-white")} />} label="J'aime" />
          <RailButton icon={<MessageCircle className={cx(ICON, "fill-white")} />} label="Comm." />
          <RailButton icon={<Bookmark className={cx(ICON, "fill-white")} />} label="Favoris" />
          <RailButton icon={<Share2 className={ICON} />} label="Partager" />
          <span className={cx("mt-[1cqw] grid size-[9cqw] place-items-center rounded-full border-[2.2cqw] border-[#222] bg-gradient-to-br from-brand to-violet", spinning && "phone-disc")} />
        </div>
        <div className="absolute bottom-[10.5%] left-[3.5cqw] right-[18cqw] space-y-[1.2cqw]">
          <p className="text-[max(9px,3.9cqw)] font-bold">@{handle}</p>
          <p className="line-clamp-2 text-[max(8px,3.4cqw)] leading-snug">{caption}</p>
          <p className="flex items-center gap-[1.5cqw] truncate text-[max(8px,3.2cqw)]"><Music2 className="size-[3.6cqw] shrink-0" /> son original · {author}</p>
        </div>
        <BottomBar
          items={[
            { icon: <Home className="size-[5.6cqw]" />, label: "Accueil", active: true },
            { icon: <Users className="size-[5.6cqw]" />, label: "Amis" },
            { icon: <span className="grid h-[6.4cqw] w-[10cqw] place-items-center rounded-[1.6cqw] bg-white text-black shadow-[-1.2cqw_0_0_#25f4ee,1.2cqw_0_0_#fe2c55]"><Plus className="size-[4.4cqw]" strokeWidth={3} /></span> },
            { icon: <Inbox className="size-[5.6cqw]" />, label: "Boîte" },
            { icon: <User className="size-[5.6cqw]" />, label: "Profil" },
          ]}
        />
      </div>
    );
  }
  if (platform === "shorts") {
    return (
      <div aria-hidden className={cx("pointer-events-none absolute inset-0 z-[15] text-white", shadow)}>
        <div className="absolute right-[4cqw] top-[7%] flex items-center gap-[4cqw]">
          <Search className="size-[5.6cqw]" />
          <MoreVertical className="size-[5.6cqw]" />
        </div>
        <div className="absolute bottom-[11%] right-[2.5cqw] flex flex-col items-center gap-[3.6cqw]">
          <RailButton icon={<ThumbsUp className={cx(ICON, "fill-white")} />} label="J'aime" />
          <RailButton icon={<ThumbsDown className={cx(ICON, "fill-white")} />} label="Je n'aime pas" />
          <RailButton icon={<MessageCircle className={cx(ICON, "fill-white")} />} label="Comm." />
          <RailButton icon={<Share2 className={ICON} />} label="Partager" />
          <RailButton icon={<Repeat2 className={ICON} />} label="Remixer" />
          <span className="mt-[1cqw] size-[8.5cqw] rounded-[1.8cqw] border-2 border-white bg-gradient-to-br from-brand to-brand-2" />
        </div>
        <div className="absolute bottom-[10.5%] left-[3.5cqw] right-[18cqw] space-y-[1.6cqw]">
          <p className="line-clamp-2 text-[max(8px,3.6cqw)] font-medium leading-snug">{caption}</p>
          <p className="flex items-center gap-[2cqw] text-[max(9px,3.6cqw)] font-semibold">
            <span className="grid size-[7cqw] place-items-center rounded-full bg-gradient-to-br from-brand to-brand-2 text-[3.2cqw]">{handle.slice(0, 1).toUpperCase()}</span>
            @{handle}
            <span className="rounded-full bg-white px-[2.4cqw] py-[0.8cqw] text-[max(8px,3cqw)] font-bold text-black [text-shadow:none]">S&apos;abonner</span>
          </p>
          <p className="flex items-center gap-[1.5cqw] truncate text-[max(8px,3.2cqw)]"><Music2 className="size-[3.6cqw] shrink-0" /> Son original · {author}</p>
        </div>
        <BottomBar
          items={[
            { icon: <Home className="size-[5.6cqw]" />, label: "Accueil" },
            { icon: <YouTubeIcon className="size-[5.6cqw]" />, label: "Shorts", active: true },
            { icon: <span className="grid size-[8cqw] place-items-center rounded-full border border-white/70"><Plus className="size-[5cqw]" /></span> },
            { icon: <Clapperboard className="size-[5.6cqw]" />, label: "Abonnements" },
            { icon: <User className="size-[5.6cqw]" />, label: "Vous" },
          ]}
        />
      </div>
    );
  }
  return (
    <div aria-hidden className={cx("pointer-events-none absolute inset-0 z-[15] text-white", shadow)}>
      <div className="absolute inset-x-[4cqw] top-[6.5%] flex items-center justify-between">
        <span className="text-[max(11px,5cqw)] font-bold">Reels</span>
        <Camera className="size-[6cqw]" />
      </div>
      <div className="absolute bottom-[11%] right-[2.5cqw] flex flex-col items-center gap-[3.6cqw]">
        <RailButton icon={<Heart className={ICON} />} label="J'aime" />
        <RailButton icon={<MessageCircle className={cx(ICON, "-scale-x-100")} />} label="Comm." />
        <RailButton icon={<Send className={ICON} />} label="Envoyer" />
        <MoreHorizontal className={ICON} />
        <span className="mt-[1cqw] size-[7.5cqw] rounded-[1.6cqw] border-2 border-white bg-gradient-to-br from-violet to-brand" />
      </div>
      <div className="absolute bottom-[11%] left-[3.5cqw] right-[18cqw] space-y-[1.6cqw]">
        <p className="flex items-center gap-[2cqw] text-[max(9px,3.6cqw)] font-semibold">
          <span className="grid size-[7cqw] place-items-center rounded-full bg-gradient-to-br from-violet to-brand text-[3.2cqw]">{handle.slice(0, 1).toUpperCase()}</span>
          {handle}
          <span className="rounded-[1.6cqw] border border-white/80 px-[2cqw] py-[0.5cqw] text-[max(8px,3cqw)]">Suivre</span>
        </p>
        <p className="line-clamp-2 text-[max(8px,3.4cqw)] leading-snug">{caption}</p>
        <p className="flex items-center gap-[1.5cqw] truncate text-[max(8px,3.2cqw)]"><Music2 className="size-[3.6cqw] shrink-0" /> {author} · Audio original</p>
      </div>
      <BottomBar
        items={[
          { icon: <Home className="size-[5.6cqw]" /> },
          { icon: <Search className="size-[5.6cqw]" /> },
          { icon: <span className="grid size-[6.4cqw] place-items-center rounded-[1.8cqw] border-2 border-white"><Plus className="size-[4cqw]" strokeWidth={3} /></span> },
          { icon: <Clapperboard className="size-[5.6cqw]" />, active: true },
          { icon: <span className="size-[6cqw] rounded-full border-2 border-white bg-gradient-to-br from-brand to-brand-2" /> },
        ]}
      />
    </div>
  );
}

function BottomBar({ items }: { items: Array<{ icon: ReactNode; label?: string; active?: boolean }> }) {
  return (
    <div className="absolute inset-x-0 bottom-0 flex h-[8%] items-start justify-around bg-black/85 px-[2cqw] pt-[1.6cqw] [text-shadow:none]">
      {items.map((item, i) => (
        <span key={i} className={cx("flex flex-col items-center gap-[0.6cqw] text-[max(7px,2.5cqw)] font-medium", item.active ? "text-white" : "text-white/65")}>
          {item.icon}
          {item.label ? <span className="leading-none">{item.label}</span> : null}
        </span>
      ))}
    </div>
  );
}
