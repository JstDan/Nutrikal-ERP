"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/** One choice of a filter: a link, maybe with a count. */
export type FilterLink = { href: string; label: string; count?: number; current: boolean };

/**
 * The filters of a list (all, active, …): round buttons on a computer, one drop-down on a phone, so the list starts
 * high on the screen instead of under two or three rows of buttons (owner, Nov 2026: fewer buttons on the phone).
 */
export function FilterLinks({ label, items, id, className = "" }: { label: string; items: FilterLink[]; id: string; className?: string }) {
  const router = useRouter();
  const text = (i: FilterLink) => (i.count === undefined ? i.label : `${i.label} ${i.count}`);
  const current = items.find((i) => i.current) ?? items[0];
  return (
    <>
      <nav aria-label={label} className={`hidden flex-wrap gap-1 sm:flex ${className}`}>
        {items.map((i) => (
          <Link key={i.href} href={i.href} aria-current={i.current ? "page" : undefined}
            className={`flex min-h-10 items-center gap-1 rounded-full border px-3.5 text-[13px] no-underline ${i.current ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-white text-ink"}`}>
            {i.label}{i.count !== undefined && <span className="tabular-nums">{i.count}</span>}
          </Link>
        ))}
      </nav>
      <div className={`flex min-w-0 flex-[1_1_160px] sm:hidden ${className}`}>
        <label htmlFor={id} className="sr-only">{label}</label>
        <select id={id} className="input min-w-0" value={current?.href} onChange={(e) => router.push(e.target.value)}>
          {items.map((i) => <option key={i.href} value={i.href}>{text(i)}</option>)}
        </select>
      </div>
    </>
  );
}
