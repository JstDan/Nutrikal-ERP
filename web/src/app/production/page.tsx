import Link from "next/link";
import { FilterLinks } from "@/components/filter-links";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { formatDate, formatNumber } from "@/lib/i18n";
import { Card, Chip, Empty, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { moTone } from "@/lib/status";
import { createSimulation } from "@/app/actions";

type Row = {
  id: string; code: string; status: string; quantity: number; planned_date: string | null; product: string; product_bg: string | null;
  project_code: string | null; covered: boolean | null;
};
const TABS = ["open", "simulation", "scheduled", "released", "in_production", "completed", "cancelled"] as const;

export default async function ProductionPage({ searchParams }: PageProps<"/production">) {
  const { user, locale, t } = await requireStaff();
  const sp = await searchParams;
  const tab = typeof sp.status === "string" && (TABS as readonly string[]).includes(sp.status) ? sp.status : "open";
  const P = t.production;

  const { rows, versions, projects } = await withUser(user.id, async (tx) => ({
    rows: (await tx.query<Row>(
      `select mo.id, mo.code, mo.status, mo.quantity, mo.planned_date::text, f.name as product, f.name_bg as product_bg,
              p.code as project_code,
              case when mo.status in ('simulation', 'scheduled', 'released')
                   then (select bool_and(r.reserved >= r.required) from mo_material_requirements(mo.id) r) end as covered
         from manufacturing_orders mo
         join formula_versions v on v.id = mo.formula_version_id join formulas f on f.id = v.formula_id
         left join projects p on p.id = mo.project_id
        where ($1 = 'open' and mo.status not in ('completed', 'cancelled')) or mo.status::text = $1
        order by mo.planned_date nulls last, mo.code`, [tab])).rows,
    versions: (await tx.query<{ id: string; code: string; name: string; name_bg: string | null; version: number; client: string | null }>(
      `select v.id, f.code, f.name, f.name_bg, v.version, c.legal_name as client
         from formula_versions v join formulas f on f.id = v.formula_id left join clients c on c.id = f.client_id
        where v.status = 'approved' and f.is_active and f.servings_per_pack is not null
        order by c.legal_name nulls last, f.code`)).rows,
    projects: (await tx.query<{ id: string; code: string; name: string }>(
      "select id, code, name from projects where status not in ('completed', 'lost') order by code desc")).rows,
  }));
  const grid = "md:grid-cols-[110px_minmax(0,1.4fr)_110px_170px] xl:grid-cols-[110px_minmax(0,1.4fr)_110px_100px_120px_170px_170px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={P.title} subtitle={P.subtitle} actions={<a href="#new-sim" className="btn btn-primary">{P.newTitle}</a>} />
      <FilterLinks id="mo-status" label={P.status} items={TABS.map((s) => ({ href: s === "open" ? "/production" : `/production?status=${s}`, label: s === "open" ? P.allOpen : t.enums.moStatus[s], current: tab === s }))} />

      <section aria-label={P.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`}>
          <span>{P.code}</span><span>{P.product}</span><span>{P.planned}</span>
          <span className="hidden xl:block">{P.quantity}</span><span className="hidden xl:block">{P.project}</span>
          <span className="hidden xl:block">{P.materials}</span><span>{P.status}</span>
        </div>
        {rows.length === 0 && <div className="py-4"><Empty>{P.empty}</Empty></div>}
        {rows.map((m) => (
          <div key={m.id} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3.5 text-sm last:border-0 ${grid}`}>
            <div className="min-w-0 md:contents">
              <Link href={`/production/${m.id}`} className="font-semibold text-ink">{m.code}</Link>
              <span className="block min-w-0 break-words md:inline">{locale === "bg" && m.product_bg ? m.product_bg : m.product}</span>
            </div>
            <span className="hide-sm">{formatDate(locale, m.planned_date)}</span>
            <span className="hidden xl:block">{formatNumber(locale, m.quantity)}</span>
            <span className="hidden xl:block">{m.project_code ?? "—"}</span>
            <span className="hidden xl:block">
              {m.covered == null ? "—" : <Chip tone={m.covered ? "green" : "red"}>{m.covered ? P.ready : P.short}</Chip>}
            </span>
            <Chip tone={moTone(m.status)}>{t.enums.moStatus[m.status as "simulation"]}</Chip>
          </div>
        ))}
      </section>

      <Card title={P.newTitle} id="new-sim">
        <p className="m-0 text-sm text-ink-2">{P.newNote}</p>
        <ActionForm action={createSimulation} submitLabel={P.submit} resetOnSuccess={false}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="field md:col-span-2"><span>{P.formula} *</span>
              <select name="formula_version_id" required className="input" defaultValue="">
                <option value="" disabled>{P.chooseFormula}</option>
                {[...new Set(versions.map((v) => v.client))].map((client) => (
                  <optgroup key={client ?? "stock"} label={client ?? t.formulas.stock}>
                    {versions.filter((v) => v.client === client).map((v) => (
                      <option key={v.id} value={v.id}>{v.code} v{v.version} · {locale === "bg" && v.name_bg ? v.name_bg : v.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="field"><span>{P.quantity} *</span><input name="quantity" type="number" min={1} step={1} required className="input" /></label>
            <label className="field"><span>{t.production.detail.planDate}</span><input name="planned_date" type="date" className="input" /></label>
            <label className="field md:col-span-2"><span>{P.project}</span>
              <select name="project_id" className="input" defaultValue="">
                <option value="">{P.noProject}</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
              </select>
            </label>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
