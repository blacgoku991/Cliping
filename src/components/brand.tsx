import { cx } from "./ui";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-display text-2xl tracking-wide", className)}>
      <span className="brand-gradient grid size-8 place-items-center rounded-lg text-white" aria-hidden>
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
          <path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5Z" />
          <rect x="3" y="5" width="2.5" height="14" rx="1.25" />
        </svg>
      </span>
      CLIPING
    </span>
  );
}

type IconProps = { className?: string };

export function TwitchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M4.3 2 2.5 6.6v14.2h5V23h2.8l2.6-2.2h4L22 15.6V2H4.3Zm15.8 12.7-3.1 3.1h-4.9l-2.6 2.2v-2.2H5.4V3.9h14.7v10.8ZM17 7.6v5.3h-1.9V7.6H17Zm-5 0v5.3h-1.9V7.6H12Z" />
    </svg>
  );
}

export function YouTubeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.2 3.6-6.2 3.6Z" />
    </svg>
  );
}

export function TikTokIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M16.6 2h-3.3v13.4a2.8 2.8 0 1 1-2.8-2.8c.3 0 .6 0 .8.1V9.3a6.1 6.1 0 1 0 5.3 6.1V8.6a7.6 7.6 0 0 0 4.4 1.4V6.7A4.4 4.4 0 0 1 16.6 2Z" />
    </svg>
  );
}

export function KickIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M3 3h6v4h2V5h2V3h6v6h-2v2h-2v2h2v2h2v6h-6v-2h-2v-2H9v4H3V3Z" />
    </svg>
  );
}

export function SourceIcon({ platform, className }: { platform: string; className?: string }) {
  if (platform === "TWITCH") return <TwitchIcon className={cx("text-[#a970ff]", className)} />;
  if (platform === "KICK") return <KickIcon className={cx("text-[#53fc18]", className)} />;
  if (platform === "YOUTUBE") return <YouTubeIcon className={cx("text-[#ff3333]", className)} />;
  return <span className={cx("inline-block rounded bg-muted", className)} />;
}

export function SocialIcon({ platform, className }: { platform: string; className?: string }) {
  if (platform === "YOUTUBE") return <YouTubeIcon className={cx("text-[#ff3333]", className)} />;
  return <TikTokIcon className={cx("text-ink", className)} />;
}
