import type { Dict } from "@/lib/i18n/en";
import { FilterLinks } from "./filter-links";

const TABS = [
  { key: "general", href: "/settings" },
  { key: "calculator", href: "/settings/calculator" },
  { key: "costs", href: "/settings/costs" },
  { key: "templates", href: "/settings/templates" },
  { key: "mail", href: "/settings/mail" },
  { key: "users", href: "/settings/users" },
  { key: "contract", href: "/settings/contract" },
  { key: "ai", href: "/settings/ai" },
  { key: "trash", href: "/settings/trash" },
  { key: "history", href: "/history" },
] as const;

/** The parts of Settings (Admin only); one drop-down on a phone. */
export function SettingsTabs({ t, active }: { t: Dict; active: (typeof TABS)[number]["key"] }) {
  return (
    <FilterLinks id="settings-part" label={t.adminSettings.title}
      items={TABS.map((x) => ({ href: x.href, label: t.adminSettings.tabs[x.key], current: active === x.key }))} />
  );
}
