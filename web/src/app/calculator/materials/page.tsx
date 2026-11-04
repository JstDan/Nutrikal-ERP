import { requireRole } from "@/lib/session";
import { fmt } from "@/lib/i18n";
import { loadMaterials } from "@/lib/calculator/db";
import { PageHeader } from "@/components/ui";
import { CalcTabs } from "@/components/calculator/calc-tabs";
import { MaterialsView } from "@/components/calculator/materials-view";

export default async function CalculatorMaterialsPage() {
  const { user, locale, t } = await requireRole("admin", "sales");
  const materials = await loadMaterials(user.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.calc.materials.title}
        subtitle={fmt(t.calc.materials.count, { n: materials.filter((m) => m.active).length })}
      />
      <CalcTabs t={t.calc} active="materials" />
      <MaterialsView
        t={t.calc}
        locale={locale}
        materials={materials}
        isAdmin={user.role === "admin"}
      />
    </div>
  );
}
