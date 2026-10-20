import { requireRole } from "@/lib/session";
import { loadCrmClients, loadMaterials, loadOffer, loadSettings } from "@/lib/calculator/db";
import { CalculatorApp } from "@/components/calculator/calculator-app";
import { CalcTabs } from "@/components/calculator/calc-tabs";

export default async function CalculatorPage({ searchParams }: PageProps<"/calculator">) {
  const { user, locale, t } = await requireRole("admin", "sales");
  const sp = await searchParams;
  const openId = typeof sp.open === "string" ? sp.open : typeof sp.copy === "string" ? sp.copy : null;

  const [materials, settings, clients, offer] = await Promise.all([
    loadMaterials(user.id),
    loadSettings(user.id),
    loadCrmClients(user.id),
    openId ? loadOffer(user.id, openId) : null,
  ]);

  return (
    <CalculatorApp
      t={t.calc}
      locale={locale}
      materials={materials}
      settings={settings}
      clients={clients}
      initial={offer ? { mode: typeof sp.open === "string" ? "open" : "copy", offer } : null}
      tabs={<CalcTabs t={t.calc} active="calculator" />}
    />
  );
}
