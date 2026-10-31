import { requireRole } from "@/lib/session";
import { loadSettings } from "@/lib/calculator/db";
import { PageHeader } from "@/components/ui";
import { SettingsTabs } from "@/components/settings-tabs";
import { CalculatorSettings } from "@/components/calculator/calculator-settings";

/** Calculator settings: company details on documents, fixed costs, markup, services, price-list links. */
export default async function CalculatorSettingsPage() {
  const { user, locale, t } = await requireRole("admin");
  const settings = await loadSettings(user.id);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.adminSettings.title} subtitle={t.adminSettings.subtitle} />
      <SettingsTabs t={t} active="calculator" />
      <CalculatorSettings t={t.calc} locale={locale} settings={settings} />
    </div>
  );
}
