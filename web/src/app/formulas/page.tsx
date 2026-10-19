import Link from "next/link";
import { q } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { formulaTone } from "@/lib/status";

type Row = {
  id: string; code: string; name: string; name_bg: string | null; product_format: string;
  client: string | null; client_id: string | null; project_code: string | null; version: number; status: string;
};

export default async function FormulasPage({ searchParams }: PageProps<"/formulas">) {
  const { user, locale, t } = await requireStaff();
  const sp = await searchParams;
  const term = typeof sp.q === "string" ? sp.q.trim() : "";
  const canCreate = user.role === "admin" || user.role === "sales";

  // Per formula: the draft if there is one, else the approved version, else the latest
  const rows = await q<Row>(
    user.id,
    `select f.id, f.code, f.name, f.name_bg, f.product_format, c.legal_name as client, c.id as client_id,
            p.code as project_code, v.version, v.status
       from formulas f
       left join clients c on c.id = f.client_id
       left join projects p on p.id = f.project_id
       cross join lateral (
         select version, status from formula_versions
          where formula_id = f.id
          order by status = 'draft' desc, status = 'approved' desc, version desc limit 1) v
      where f.is_active
        and ($1 = '' or f.name ilike '%' || $1 || '%' or f.name_bg ilike '%' || $1 || '%' or f.code ilike '%' || $1 || '%')
      order by f.code desc`,
    [term],
  );

  const grid = "md:grid-cols-[110px_minmax(0,1.6fr)_minmax(0,1fr)_150px] lg:grid-cols-[110px_minmax(0,1.6fr)_minmax(0,1fr)_120px_70px_150px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.formulas.title}
        subtitle={t.formulas.subtitle}
        actions={canCreate && <Link href="/formulas/new" className="btn btn-primary">{t.formulas.new}</Link>}
      />

      <form method="get" role="search" className="flex min-w-0 justify-end">
        <label htmlFor="formula-q" className="sr-only">{t.topbar.search}</label>
        <input id="formula-q" name="q" type="search" defaultValue={term} placeholder={t.formulas.searchPlaceholder} className="input max-w-[360px]" />
      </form>

      <section aria-label={t.formulas.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`}>
          <span>{t.formulas.code}</span><span>{t.formulas.name}</span><span>{t.formulas.client}</span>
          <span className="hide-md">{t.formulas.format}</span><span className="hide-md">{t.formulas.version}</span>
          <span>{t.formulas.status}</span>
        </div>
        {rows.length === 0 && <div className="py-4"><Empty>{t.formulas.empty}</Empty></div>}
        {rows.map((f) => (
          <div key={f.id} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3.5 text-sm last:border-0 ${grid}`}>
            <div className="min-w-0 md:contents">
              <Link href={`/formulas/${f.id}`} className="font-semibold text-ink">{f.code}</Link>
              <span className="block min-w-0 break-words md:inline">{locale === "bg" && f.name_bg ? f.name_bg : f.name}</span>
            </div>
            <span className="hide-sm min-w-0 break-words">
              {f.client_id ? <Link href={`/clients/${f.client_id}`} className="text-ink">{f.client}{f.project_code ? ` · ${f.project_code}` : ""}</Link> : <span className="text-ink-2">{t.formulas.stock}</span>}
            </span>
            <span className="hide-md">{t.enums.productFormat[f.product_format as "capsule"]}</span>
            <span className="hide-md">v{f.version}</span>
            <Chip tone={formulaTone(f.status)}>{t.enums.formulaStatus[f.status as "draft"]}</Chip>
          </div>
        ))}
      </section>
    </div>
  );
}
