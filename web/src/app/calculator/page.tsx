import { requireRole } from "@/lib/session";
import { loadCatalog, loadCrmClients, loadMaterials, loadOffer, loadSettings } from "@/lib/calculator/db";
import { CalculatorApp } from "@/components/calculator/calculator-app";
import { CalcTabs } from "@/components/calculator/calc-tabs";

export default async function CalculatorPage({ searchParams }: PageProps<"/calculator">) {
  const { user, locale, t } = await requireRole("admin", "sales");
  const sp = await searchParams;
  const openId = typeof sp.open === "string" ? sp.open : typeof sp.copy === "string" ? sp.copy : typeof sp.next === "string" ? sp.next : null;

  const [materials, catalog, settings, clients, offer] = await Promise.all([
    loadMaterials(user.id),
    loadCatalog(user.id),
    loadSettings(user.id),
    loadCrmClients(user.id),
    openId ? loadOffer(user.id, openId) : null,
  ]);

  return (
    <CalculatorApp
      t={t.calc}
      locale={locale}
      materials={materials}
      catalog={catalog}
      settings={settings}
      clients={clients}
      initial={offer ? { mode: typeof sp.open === "string" ? "open" : typeof sp.copy === "string" ? "copy" : "next", offer } : null}
      tabs={<CalcTabs t={t.calc} active="calculator" />}
    />
  );
}
