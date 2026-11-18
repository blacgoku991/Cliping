"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, LayoutDashboard, Radio, Send, Settings, Users } from "lucide-react";
import { cx } from "./ui";

const ITEMS: Array<{ href: string; label: string; short?: string; icon: typeof Send; exact?: boolean }> = [
  { href: "/app", label: "Accueil", icon: LayoutDashboard, exact: true },
  { href: "/app/clips", label: "Clips", icon: Clapperboard },
  { href: "/app/streamers", label: "Streamers", icon: Radio },
  { href: "/app/queue", label: "Publications", short: "Posts", icon: Send },
  { href: "/app/accounts", label: "Comptes", icon: Users },
  { href: "/app/settings", label: "Réglages", icon: Settings },
];

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

/** Navigation latérale (ordinateur). `badges` : compteurs affichés à côté d'une entrée. */
export function SideNav({ badges }: { badges: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Navigation principale">
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href, item.exact);
        const badge = badges[item.href];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
              active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2/60 hover:text-ink",
            )}
          >
            <item.icon className={cx("size-[18px]", active && "text-brand")} />
            <span className="flex-1">{item.label}</span>
            {badge ? (
              <span className="brand-gradient min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold leading-5 text-white">{badge}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Barre d'onglets en bas d'écran (téléphone). */
export function BottomNav({ badges }: { badges: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href, item.exact);
        const badge = badges[item.href];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx("relative flex flex-col items-center gap-1 px-1 py-2.5 text-[10px] font-medium", active ? "text-ink" : "text-faint")}
          >
            <item.icon className={cx("size-5", active && "text-brand")} />
            <span className="max-w-full truncate">{item.short ?? item.label}</span>
            {badge ? <span className="brand-gradient absolute right-[22%] top-1.5 size-2 rounded-full" aria-label={`${badge} en attente`} /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
