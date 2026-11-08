"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SideNav, type NavGroup } from "./side-nav";

/** The main sections on a phone: a bar at the foot, always in reach of the thumb (below 1024px). */
export type TabItem = { href: string; label: string; badge?: number };

const ICON: Record<string, string> = {
  "/": "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  "/factory": "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  "/clients": "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6",
  "/orders": "M6 2h9l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM14 2v6h6M8 13h8M8 17h6",
  "/factory/orders": "M6 2h9l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM14 2v6h6M8 13h8M8 17h6",
  "/my-tasks": "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  "/factory/calendar": "M4 5h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 10h18M8 3v4M16 3v4",
  "/factory/stock": "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
};
const MORE = "M4 6h16M4 12h16M4 18h16";

function Icon({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function Badge({ n }: { n?: number }) {
  if (!n) return null;
  return <span className="absolute -top-1 left-[calc(50%+6px)] min-w-[18px] rounded-full bg-green px-1 text-center text-[11px] leading-[18px] font-semibold text-ink tabular-nums">{n > 99 ? "99+" : n}</span>;
}

export function MobileTabBar({ tabs, groups, moreLabel, closeLabel, navLabel }: {
  tabs: TabItem[]; groups: NavGroup[]; moreLabel: string; closeLabel: string; navLabel: string;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);

  const home = (h: string) => h === "/" || h === "/factory";
  const on = (h: string) => (home(h) ? path === h : path === h || path.startsWith(h + "/"));
  // The longest tab that matches wins ("/factory/orders" over "/factory")
  const current = tabs.filter((t) => on(t.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const inTabs = new Set(tabs.map((t) => t.href));
  // What waits in the sections behind More shows on the More button
  const moreBadge = groups.flatMap((g) => g.items).filter((i) => i.href && !inTabs.has(i.href)).reduce((s, i) => s + (i.badge ?? 0), 0);
  const cell = "relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-1 pt-1.5 pb-1 text-center text-[11px] leading-tight no-underline";

  return (
    <>
      {open && (
        <div id="more-menu" role="dialog" aria-label={moreLabel}
          className="fixed inset-x-0 top-0 bottom-[var(--tabbar)] z-[41] overflow-y-auto bg-side px-4 pt-[max(20px,env(safe-area-inset-top))] pb-6 text-side-strong lg:hidden print:hidden">
          <div className="mb-4 flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold tracking-[2px] text-side-muted uppercase">{moreLabel}</span>
            <button type="button" onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-2 rounded-sm border border-[#4a5160] px-3 text-xs font-semibold text-side-strong">
              <span aria-hidden="true">✕</span>{closeLabel}
            </button>
          </div>
          {/* Two sections a row, so the whole menu fits a phone screen without scrolling */}
          <div className="[&_nav]:gap-5 [&_nav>div]:grid [&_nav>div]:grid-cols-2 [&_nav>div]:gap-1 [&_nav>div>div]:col-span-2 [&_nav_a]:bg-white/5">
            <SideNav groups={groups} label={navLabel} />
          </div>
        </div>
      )}
      <nav id="tab-bar" aria-label={navLabel}
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[#3a404b] bg-side pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden">
        {tabs.slice(0, 4).map((t) => {
          const active = !open && current === t.href;
          return (
            <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}
              className={`${cell} ${active ? "font-semibold text-white" : "text-side-muted"}`}>
              <span className={`relative grid h-7 w-12 place-items-center rounded-full ${active ? "bg-ink-3 text-green" : ""}`}>
                <Icon d={ICON[t.href] ?? MORE} />
              </span>
              <Badge n={t.badge} />
              <span className="w-full break-words">{t.label}</span>
            </Link>
          );
        })}
        <button type="button" aria-expanded={open} aria-controls="more-menu" onClick={() => setOpen((o) => !o)}
          className={`${cell} border-0 bg-transparent ${open || !current ? "font-semibold text-white" : "text-side-muted"}`}>
          <span className={`relative grid h-7 w-12 place-items-center rounded-full ${open || !current ? "bg-ink-3 text-green" : ""}`}>
            <Icon d={open ? "M6 6l12 12M18 6L6 18" : MORE} />
          </span>
          <Badge n={moreBadge} />
          <span className="w-full break-words">{open ? closeLabel : moreLabel}</span>
        </button>
      </nav>
    </>
  );
}
