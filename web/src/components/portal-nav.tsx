"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The menu of the customer panel: the page you are on stands out. */
export function PortalNav({ label, links, unread }: { label: string; links: { href: string; text: string }[]; unread: number }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="mx-auto flex w-full max-w-[1100px] flex-wrap gap-1 px-4 pb-2">
      {links.map((l) => {
        const here = l.href === "/portal" ? path === "/portal" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={here ? "page" : undefined} className={`p-tab ${here ? "p-tab-here" : ""}`}>
            {l.text}
            {l.href === "/portal/support" && unread > 0 && <span className="p-count">{unread}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
