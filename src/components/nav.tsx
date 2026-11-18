"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bot, ChartColumn, Clapperboard, Ellipsis, Film, Layers, LayoutDashboard, Lightbulb, Radio, Send, Settings, Users } from "lucide-react";
import { cx } from "./ui";

type Item = { href: string; label: string; short?: string; icon: typeof Send; exact?: boolean };

const ITEMS: Item[] = [
  { href: "/app", label: "Accueil", icon: LayoutDashboard, exact: true },
  { href: "/app/clips", label: "Clips", icon: Clapperboard },
  { href: "/app/review", label: "Mode validation", short: "Valider", icon: Layers },
  { href: "/app/queue", label: "Publications", short: "Posts", icon: Send },
  { href: "/app/autopilot", label: "Pilote auto", short: "Pilote", icon: Bot },
  { href: "/app/streamers", label: "Streamers", icon: Radio },
  { href: "/app/compilations", label: "Compilations", short: "Best-of", icon: Film },
  { href: "/app/accounts", label: "Comptes", icon: Users },
  { href: "/app/stats", label: "Performances", short: "Stats", icon: ChartColumn },
  { href: "/app/coach", label: "Conseils", icon: Lightbulb },
  { href: "/app/settings", label: "Réglages", icon: Settings },
];

/** Sur téléphone : 4 entrées principales, le reste derrière « Plus ». */
const PRIMARY = ITEMS.slice(0, 4);
const MORE = ITEMS.slice(4);

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

/** Navigation latérale (ordinateur). `badges` : compteurs affichés à côté d'une entrée. */
export function SideNav({ badges }: { badges: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Navigation principale">
      {ITEMS.map((item, i) => {
        const active = isActive(pathname, item.href, item.exact);
        const badge = badges[item.href];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
              i === 4 && "mt-3",
              active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2/60 hover:text-ink",
            )}
          >
            {active ? <span aria-hidden className="brand-gradient absolute inset-y-2 left-0 w-[3px] rounded-full" /> : null}
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
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const moreActive = MORE.some((m) => isActive(pathname, m.href, m.exact));
  const moreBadge = MORE.reduce((n, m) => n + (badges[m.href] ?? 0), 0);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("a")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const tab = "relative flex flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium";
  return (
    <>
      {open ? <button type="button" aria-label="Fermer le menu" className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] lg:hidden" onClick={() => setOpen(false)} /> : null}
      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {open ? (
          <div ref={panelRef} id="nav-plus" className="rise-in absolute inset-x-3 bottom-full mb-2 grid grid-cols-2 gap-1.5 rounded-2xl border border-line bg-surface p-2 shadow-2xl">
            {MORE.map((item) => {
              const active = isActive(pathname, item.href, item.exact);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx("flex items-center gap-2.5 rounded-xl px-3 py-3 text-sm font-medium", active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2/60")}
                >
                  <item.icon className={cx("size-[18px]", active && "text-brand")} />
                  {item.label}
                  {badges[item.href] ? <span className="brand-gradient ml-auto size-2 rounded-full" /> : null}
                </Link>
              );
            })}
          </div>
        ) : null}
        <div className="grid grid-cols-5">
          {PRIMARY.map((item) => {
            const active = isActive(pathname, item.href, item.exact);
            const badge = badges[item.href];
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cx(tab, active ? "text-ink" : "text-faint")}>
                <item.icon className={cx("size-5", active && "text-brand")} />
                <span className="max-w-full truncate">{item.short ?? item.label}</span>
                {badge ? (
                  <span className="brand-gradient absolute left-1/2 top-1 ml-1.5 min-w-4 rounded-full px-1 text-center text-[10px] font-bold leading-4 text-white" aria-label={`${badge} en attente`}>
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="nav-plus"
            onClick={() => setOpen((o) => !o)}
            className={cx(tab, open || moreActive ? "text-ink" : "text-faint")}
          >
            <Ellipsis className={cx("size-5", moreActive && "text-brand")} />
            <span>Plus</span>
            {moreBadge ? <span className="brand-gradient absolute right-[26%] top-1.5 size-2 rounded-full" aria-label={`${moreBadge} en attente`} /> : null}
          </button>
        </div>
      </nav>
    </>
  );
}
