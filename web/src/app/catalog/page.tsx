import Link from "next/link";
import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { Chip, Empty, Fold, PageHeader } from "@/components/ui";
import { formatMoney, formatNumber, fmt } from "@/lib/i18n";
import { createCatalogProduct } from "@/app/catalog-actions";

type Row = {
  id: string; code: string; name: string; name_bg: string | null; product_format: string; is_published: boolean;
  category: string | null; category_bg: string | null; from_price: string | null; problem: string | null;
};
type Recipe = { id: string; code: string; name: string; name_bg: string | null };

/** The stock formulas: what is on catalog.nutrikal.com and what is still a draft. */
export default async function CatalogPage() {
  const { user, locale, t } = await requireRole("admin", "sales");
  const C = t.catalog;
  const canEdit = user.role === "admin" && !user.readOnly;

  const rows = await q<Row>(user.id,
    `select p.id, p.code, p.name, p.name_bg, f.product_format, p.is_published, c.name as category, c.name_bg as category_bg,
            (select min(t.unit_price)::text from catalog_price_tiers t where t.product_id = p.id) as from_price,
            catalog_publish_problem(p.id) as problem
       from catalog_products p
       join formulas f on f.id = p.formula_id
       left join catalog_categories c on c.id = p.category_id
      order by p.sort_order, p.code desc`);
  const recipes = canEdit
    ? await q<Recipe>(user.id,
        `select f.id, f.code, f.name, f.name_bg from formulas f
          where f.is_active and not exists (select 1 from catalog_products p where p.formula_id = f.id)
          order by f.code desc`)
    : [];
  const [waiting] = await q<{ n: number }>(user.id, "select count(*)::int as n from catalog_enquiries where status = 'new'");
  const local = (name: string, bg: string | null) => (locale === "bg" && bg ? bg : name);
  const grid = "md:grid-cols-[110px_minmax(0,1.6fr)_minmax(0,1fr)_120px_120px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={C.title} subtitle={C.subtitle} actions={
        <>
          <Link href="/catalog/enquiries" className="btn btn-primary">{waiting.n > 0 ? fmt(C.enquiriesNew, { n: waiting.n }) : C.enquiries}</Link>
          <a href="/public-catalog" target="_blank" rel="noopener" className="btn btn-outline">{C.openPublic}</a>
        </>
      } />

      {canEdit && recipes.length > 0 && (
        <Fold title={C.fromRecipe}>
          <form action={createCatalogProduct} className="flex min-w-0 flex-wrap items-center gap-3">
            <label htmlFor="catalog-recipe" className="sr-only">{C.recipe}</label>
            <select id="catalog-recipe" name="formula_id" required defaultValue="" className="input min-w-0 flex-1">
              <option value="" disabled>{C.pickRecipe}</option>
              {recipes.map((r) => <option key={r.id} value={r.id}>{r.code} · {local(r.name, r.name_bg)}</option>)}
            </select>
            <button type="submit" className="btn btn-primary">{C.create}</button>
          </form>
        </Fold>
      )}

      <section aria-label={C.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`}>
          <span>{C.code}</span><span>{C.name}</span><span>{C.category}</span><span>{C.fromPrice}</span><span>{C.status}</span>
        </div>
        {rows.length === 0 && <div className="py-4"><Empty>{C.empty}</Empty></div>}
        {rows.map((p) => (
          <div key={p.id} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3.5 text-sm last:border-0 ${grid}`}>
            <div className="min-w-0 md:contents">
              <Link href={`/catalog/${p.id}`} className="font-semibold text-ink">{p.code}</Link>
              <span className="block min-w-0 break-words md:inline">
                {local(p.name, p.name_bg)}
                <span className="block text-xs text-ink-2">{t.enums.productFormat[p.product_format as "capsule"]}</span>
              </span>
            </div>
            <span className="hide-sm min-w-0 break-words">{p.category ? local(p.category, p.category_bg) : "—"}</span>
            <span className="hide-sm">{p.from_price ? formatMoney(locale, p.from_price, "EUR", 2) : "—"}</span>
            <span><Chip tone={p.is_published ? (p.problem ? "amber" : "green") : "neutral"}>{p.is_published ? (p.problem ? C.hidden : C.published) : C.draft}</Chip></span>
          </div>
        ))}
      </section>
      <p className="m-0 text-sm text-ink-2">{fmt(C.minimumNote, { n: formatNumber(locale, 500) })}</p>
    </div>
  );
}
