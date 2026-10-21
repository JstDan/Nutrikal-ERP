import { requireRole } from "@/lib/session";
import { fmt } from "@/lib/i18n";
import { loadCatalog, loadLastCatalogSync, loadSettings } from "@/lib/calculator/db";
import { PageHeader } from "@/components/ui";
import { CalcTabs } from "@/components/calculator/calc-tabs";
import { CatalogView } from "@/components/calculator/catalog-view";

export default async function CalculatorCatalogPage() {
  const { user, locale, t } = await requireRole("admin", "sales");
  const [products, settings, lastSync] = await Promise.all([
    loadCatalog(user.id, { includeInactive: true }),
    loadSettings(user.id),
    loadLastCatalogSync(user.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.calc.catalogTab.title} subtitle={fmt(t.calc.catalogTab.count, { n: products.filter((p) => p.active).length })} />
      <CalcTabs t={t.calc} active="catalog" />
      <CatalogView
        t={t.calc}
        locale={locale}
        products={products}
        settings={settings}
        lastSync={lastSync}
        isAdmin={user.role === "admin"}
      />
    </div>
  );
}
