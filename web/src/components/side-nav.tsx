"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href?: string; label: string; soon?: string };
export type NavGroup = { title?: string; items: NavItem[] };

export function SideNav({ groups, label }: { groups: NavGroup[]; label: string }) {
  const path = usePathname();
  // "/" and "/partner" are home pages: active only on themselves, not on their sub-pages
  const isActive = (href: string) => (href === "/" || href === "/partner" ? path === href : path === href || path.startsWith(href + "/"));

  return (
    <nav aria-label={label} className="flex flex-col gap-6">
      {groups.map((g, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          {g.title && <div className="px-2 pb-2 text-[11px] font-semibold tracking-[2px] uppercase text-side-muted">{g.title}</div>}
          {g.items.map((it) =>
            it.href ? (
              <Link
                key={it.label}
                href={it.href}
                aria-current={isActive(it.href) ? "page" : undefined}
                className={
                  isActive(it.href)
                    ? "flex min-h-11 items-center gap-2.5 rounded bg-ink-3 px-2 text-sm font-semibold text-side-strong no-underline"
                    : "flex min-h-11 items-center gap-2.5 rounded px-2 text-sm text-side-text no-underline hover:bg-ink-3"
                }
              >
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${isActive(it.href) ? "bg-green" : "bg-transparent"}`} />
                {it.label}
              </Link>
            ) : (
              <span key={it.label} className="flex min-h-11 items-center gap-2.5 px-2 text-sm text-side-muted">
                <span aria-hidden="true" className="h-2 w-2" />
                {it.label}
                <span className="ml-auto rounded-sm border border-[#4a5160] px-1.5 py-0.5 text-[10px] font-semibold tracking-[1px] uppercase">{it.soon}</span>
              </span>
            ),
          )}
        </div>
      ))}
    </nav>
  );
}
