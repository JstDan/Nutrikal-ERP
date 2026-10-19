import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { createFormula } from "@/app/actions";

const FORMATS = ["capsule", "tablet", "softgel", "powder", "sachet", "stick_pack", "liquid", "gummy", "bar", "other"] as const;
const SERVING_UNITS = ["pcs", "g", "ml"] as const;

export default async function NewFormulaPage({ searchParams }: PageProps<"/formulas/new">) {
  const { user, locale, t } = await requireRole("admin", "sales");
  const sp = await searchParams;
  const f = t.formulas.form;

  const { projects, shells } = await withUser(user.id, async (tx) => ({
    projects: (await tx.query<{ id: string; code: string; name: string; client: string }>(
      `select p.id, p.code, p.name, c.legal_name as client from projects p join clients c on c.id = p.client_id
        where p.status not in ('completed', 'lost') order by p.code desc`)).rows,
    shells: (await tx.query<{ id: string; sku: string; name: string; name_bg: string | null }>(
      "select id, sku, name, name_bg from items where is_active and type = 'packaging' order by name")).rows,
  }));
  const preselected = typeof sp.project === "string" && projects.some((p) => p.id === sp.project) ? sp.project : "";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={f.title} crumb={<Link href="/formulas" className="text-ink-2">{t.formulas.title}</Link>} />
      <Card>
        <ActionForm action={createFormula} submitLabel={f.submit} resetOnSuccess={false}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="field"><span>{f.name} *</span><input name="name" required className="input" /></label>
            <label className="field"><span>{f.nameBg}</span><input name="name_bg" className="input" lang="bg" /></label>
            <label className="field"><span>{f.format} *</span>
              <select name="product_format" required className="input" defaultValue="capsule">
                {FORMATS.map((x) => <option key={x} value={x}>{t.enums.productFormat[x]}</option>)}
              </select>
            </label>
            <label className="field"><span>{f.project}</span>
              <select name="project_id" className="input" defaultValue={preselected}>
                <option value="">{f.noProject}</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name} · {p.client}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
              <label className="field"><span>{f.servingSize} *</span>
                <input name="serving_size" type="number" min="0.001" step="any" required defaultValue={2} className="input" aria-describedby="serving-hint" />
              </label>
              <label className="field"><span>{f.servingUnit}</span>
                <select name="serving_unit" className="input" defaultValue="pcs">
                  {SERVING_UNITS.map((u) => <option key={u} value={u}>{t.enums.servingUnit[u]}</option>)}
                </select>
              </label>
              <small id="serving-hint" className="col-span-2 text-xs text-ink-2">{f.servingHint}</small>
            </div>
            <label className="field"><span>{f.servingsPerPack}</span><input name="servings_per_pack" type="number" min={1} step={1} className="input" /></label>
            <label className="field"><span>{f.shell}</span>
              <select name="shell_item_id" className="input" defaultValue="">
                <option value="">{f.noShell}</option>
                {shells.map((s) => <option key={s.id} value={s.id}>{locale === "bg" && s.name_bg ? s.name_bg : s.name} · {s.sku}</option>)}
              </select>
            </label>
            <label className="field md:col-span-2"><span>{f.description}</span><textarea name="description" className="input" /></label>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
