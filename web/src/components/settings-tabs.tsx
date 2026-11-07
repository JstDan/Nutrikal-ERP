import Link from "next/link";
import type { Dict } from "@/lib/i18n/en";

const TABS = [
  { key: "general", href: "/settings" },
  { key: "calculator", href: "/settings/calculator" },
  { key: "costs", href: "/settings/costs" },
  { key: "templates", href: "/settings/templates" },
  { key: "mail", href: "/settings/mail" },
  { key: "users", href: "/settings/users" },
  { key: "trash", href: "/settings/trash" },
  { key: "history", href: "/history" },
] as const;

/** The parts of Settings (Admin only). */
export function SettingsTabs({ t, active }: { t: Dict; active: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label={t.adminSettings.title} className="flex flex-wrap gap-1">
      {TABS.map((x) => (
        <Link
          key={x.key}
          href={x.href}
          aria-current={active === x.key ? "page" : undefined}
          className={`flex min-h-11 items-center rounded-full border px-3.5 text-[13px] no-underline ${active === x.key ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-white text-ink"}`}
        >
          {t.adminSettings.tabs[x.key]}
        </Link>
      ))}
    </nav>
  );
}
