import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt, formatDate, formatNumber, formatPrice, formatQty } from "@/lib/i18n";
import { Card, Chip, Fact, PageHeader } from "@/components/ui";
import { moTone } from "@/lib/status";

type Mo = { id: string; code: string; status: string; product: string; product_bg: string | null; produced_on: string | null; planned_date: string | null };
type Cost = {
  is_actual: boolean; material_cost: string; estimated_lines: number; missing_prices: number;
  total_cost: string; packs: number; cost_per_pack: string | null;
};
type CostLine = { sku: string; name: string; name_bg: string | null; base_unit: string; lot_number: string | null; quantity: string; unit_cost: string | null; cost: string | null; estimated: boolean };

/** Admin only: the cost of one batch (materials by lot, per pack). */
export default async function BatchCostPage({ params }: PageProps<"/admin/costs/[id]">) {
  const { id } = await params;
  const { user, locale, t } = await requireRole("admin");
  const A = t.admin;
  const d = t.production.detail;
  const nm = (o: { name: string; name_bg: string | null }) => (locale === "bg" && o.name_bg ? o.name_bg : o.name);

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const mo = (await tx.query<Mo>(
      `select mo.id, mo.code, mo.status::text, f.name as product, f.name_bg as product_bg, mo.produced_on::text, mo.planned_date::text
         from manufacturing_orders mo
         join formula_versions v on v.id = mo.formula_version_id join formulas f on f.id = v.formula_id
        where mo.id = $1`, [id])).rows[0];
    if (!mo) return null;
    const cost = (await tx.query<Cost>("select * from mo_cost($1)", [id])).rows[0];
    const lines = (await tx.query<CostLine>(
      "select sku, name, name_bg, base_unit, lot_number, quantity::text, unit_cost::text, cost::text, estimated from mo_costs($1)", [id])).rows;
    return { mo, cost, lines };
  });
  if (!data) notFound();
  const { mo, cost, lines } = data;
  const grid = "md:grid-cols-[minmax(0,1.4fr)_120px_120px_120px_120px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/admin" className="text-ink-2">{A.title}</Link> / {mo.code}</>}
        title={`${mo.code} · ${locale === "bg" && mo.product_bg ? mo.product_bg : mo.product}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Chip tone={moTone(mo.status)}>{t.enums.moStatus[mo.status as "simulation"]}</Chip>
            <span>{formatDate(locale, mo.produced_on ?? mo.planned_date)}</span>
          </span>
        }
        actions={<Link href={`/production/${mo.id}`} className="btn btn-outline">{A.openMo}</Link>}
      />

      <Card title={d.cost} id="cost-h">
        <p className="m-0 text-sm text-ink-2">{cost.is_actual ? d.actualCost : d.plannedCost}</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Fact label={d.totalCost}><strong>{formatPrice(locale, cost.total_cost)}</strong></Fact>
          <Fact label={t.production.quantity}>{formatNumber(locale, cost.packs)}</Fact>
          <Fact label={d.perPack}><strong>{cost.cost_per_pack != null ? formatPrice(locale, cost.cost_per_pack, "EUR", 4) : "—"}</strong></Fact>
        </div>
        {cost.is_actual && cost.estimated_lines > 0 && <p className="m-0 text-sm text-amber-ink">{fmt(d.estimatedNote, { n: cost.estimated_lines })}</p>}
        {cost.missing_prices > 0 && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{fmt(d.missingPrices, { n: cost.missing_prices })}</p>}
        {lines.length > 0 && (
          <div>
            <div className={`row hide-sm border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`}>
              <span>{cost.is_actual ? d.costLines : t.production.materials}</span><span>{d.lot}</span><span>{t.purchasing.quantity}</span><span>{d.unitCost}</span><span className="text-right">{d.totalCost}</span>
            </div>
            {lines.map((c, i) => (
              <div key={i} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-2.5 text-sm last:border-0 ${grid}`}>
                <span className="min-w-0 break-words">{nm(c)}<span className="block text-xs text-ink-2 md:hidden">{c.lot_number ? `${c.lot_number} · ` : ""}{formatQty(locale, c.quantity, c.base_unit)}</span></span>
                <span className="hide-sm">{c.lot_number ?? "—"}</span>
                <span className="hide-sm">{formatQty(locale, c.quantity, c.base_unit)}</span>
                <span className={`hide-sm ${c.estimated ? "text-amber-ink" : ""}`}>{c.unit_cost != null ? formatPrice(locale, c.unit_cost, "EUR", 4) : "—"}</span>
                <span className="text-right font-semibold">{c.cost != null ? formatPrice(locale, c.cost) : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
