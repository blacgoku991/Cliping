"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, ListChecks, MessageSquareReply, UserRoundPen } from "lucide-react";
import { cx } from "../ui";

const TABS: Array<{ href: string; label: string; short?: string; icon: typeof Compass }> = [
  { href: "/app/coach", label: "Guide", icon: ListChecks },
  { href: "/app/coach/plateformes", label: "Plateformes", short: "Réseaux", icon: Compass },
  { href: "/app/coach/profil", label: "Bio et profil", short: "Profil", icon: UserRoundPen },
  { href: "/app/coach/reponses", label: "Répondre", icon: MessageSquareReply },
];

export function CoachTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections du coach" className="mb-6 flex gap-1 rounded-2xl border border-line bg-surface p-1">
      {TABS.map((t) => {
        const active = pathname === t.href;
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-2 py-2 text-sm font-semibold transition sm:px-3",
              active ? "bg-surface-2 text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            <Icon className={cx("hidden size-4 shrink-0 sm:block", active && "text-brand")} />
            <span className="truncate sm:hidden">{t.short ?? t.label}</span>
            <span className="hidden truncate sm:inline">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
