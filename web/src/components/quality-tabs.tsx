import Link from "next/link";
import type { Dict } from "@/lib/i18n/en";

const TABS = [
  { key: "quality", href: "/quality" },
  { key: "traceability", href: "/traceability" },
  { key: "losses", href: "/quality/losses" },
] as const;

/** Quality, traceability and losses are one place in the menu. Sales sees traceability alone, without tabs. */
export function QualityTabs({ t, active, show }: { t: Dict; active: (typeof TABS)[number]["key"]; show: boolean }) {
  if (!show) return null;
  return (
    <nav aria-label={t.nav.qualityTrace} className="flex flex-wrap gap-1 print:hidden">
      {TABS.map((x) => (
        <Link key={x.key} href={x.href} aria-current={active === x.key ? "page" : undefined}
          className={`flex min-h-11 items-center rounded-full border px-3.5 text-[13px] no-underline ${active === x.key ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-white text-ink"}`}>
          {x.key === "losses" ? t.losses.nav : t.nav[x.key]}
        </Link>
      ))}
    </nav>
  );
}
