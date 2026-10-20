import Link from "next/link";
import type { Dict } from "@/lib/i18n/en";

const TABS = [
  { key: "calculator", href: "/calculator" },
  { key: "offers", href: "/calculator/offers" },
  { key: "materials", href: "/calculator/materials" },
] as const;

/** Sub-navigation between the calculator, saved offers and the raw material price list. */
export function CalcTabs({ t, active }: { t: Dict["calc"]; active: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label={t.tabs.label} className="flex flex-wrap gap-1">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={`flex min-h-11 items-center rounded-full border px-4 text-[13px] no-underline ${
            active === tab.key ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-white text-ink"
          }`}
        >
          {t.tabs[tab.key]}
        </Link>
      ))}
    </nav>
  );
}
