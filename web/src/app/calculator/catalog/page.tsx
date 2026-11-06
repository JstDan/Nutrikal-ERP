import { requireRole } from "@/lib/session";
import { fmt } from "@/lib/i18n";
import { loadCatalog } from "@/lib/calculator/db";
import { PageHeader } from "@/components/ui";
import { CalcTabs } from "@/components/calculator/calc-tabs";
import { CatalogView } from "@/components/calculator/catalog-view";

export default async function CalculatorCatalogPage() {
  const { user, locale, t } = await requireRole("admin", "sales");
  const products = await loadCatalog(user.id, { includeInactive: true, withoutComposition: true });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.calc.catalogTab.title} subtitle={fmt(t.calc.catalogTab.count, { n: products.filter((p) => p.active).length })} />
      <CalcTabs t={t.calc} active="catalog" />
      <CatalogView t={t.calc} locale={locale} products={products} isAdmin={user.role === "admin"} />
    </div>
  );
}
