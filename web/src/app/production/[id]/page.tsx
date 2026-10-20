import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { fmt, formatDate, formatNumber, formatPrice, formatQty } from "@/lib/i18n";
import { Card, Chip, Empty, Fact, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { moTone } from "@/lib/status";
import { SearchSelect } from "@/components/search-select";
import {
  addMoPackaging, cancelMo, orderMoMaterial, releaseMo, removeMoPackaging, requestPurchases, reserveMo, revertMo, saveMo,
  scheduleMo, startProduction,
} from "@/app/actions";

type Mo = {
  id: string; code: string; status: string; quantity: number; planned_date: string | null; notes: string | null;
  project_id: string | null; project_code: string | null; formula_id: string; formula_code: string; version: number;
  product: string; product_bg: string | null; product_format: string; order_id: string | null; order_code: string | null;
  batch_number: string | null; produced_quantity: number | null; produced_on: string | null; finished_lot: string | null;
  status_reason: string | null;
};
type Req = {
  item_id: string; sku: string; name: string; name_bg: string | null; kind: string; base_unit: string;
  required: string; reserved: string; available: string; at_production: string; requested: string; ordered: string;
};
type Usage = {
  item_id: string; sku: string; name: string; name_bg: string | null; base_unit: string; reserved: string; used: string;
  diff: string; diff_pct: string | null; over_limit: boolean; reason: string | null; diff_value: string | null;
};
type Source = {
  item_id: string; source: string; delivery_id: string | null; delivery_code: string | null; lot_number: string | null;
  supplier: string | null; quantity: string; unit_price: string | null; currency: string; on_date: string | null; status: string;
};
type Opt = { id: string; name: string };
type Pack = { id: string; sku: string; name: string; name_bg: string | null; qty_per_pack: string };
type Cost = {
  is_actual: boolean; material_cost: string; estimated_lines: number; missing_prices: number; partner_cost: string;
  total_cost: string; packs: number; cost_per_pack: string | null;
};
type CostLine = { sku: string; name: string; name_bg: string | null; base_unit: string; lot_number: string | null; quantity: string; unit_cost: string | null; cost: string | null; estimated: boolean };
type Invoice = { id: string; invoice_number: string; invoice_date: string; amount: string; currency: string };

export default async function ProductionOrderPage({ params }: PageProps<"/production/[id]">) {
  const { id } = await params;
  const { user, locale, t } = await requireStaff();
  const P = t.production;
  const d = P.detail;
  const canPlan = user.role === "admin";
  const nm = (o: { name: string; name_bg: string | null }) => (locale === "bg" && o.name_bg ? o.name_bg : o.name);

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const mo = (await tx.query<Mo>(
      `select mo.id, mo.code, mo.status, mo.quantity, mo.planned_date::text, mo.notes, mo.project_id, p.code as project_code,
              f.id as formula_id, f.code as formula_code, v.version, f.name as product, f.name_bg as product_bg, f.product_format,
              lo.order_id, so.code as order_code, mo.batch_number, mo.produced_quantity, mo.produced_on::text, fl.lot_number as finished_lot,
              mo.status_reason
         from manufacturing_orders mo
         join formula_versions v on v.id = mo.formula_version_id join formulas f on f.id = v.formula_id
         left join projects p on p.id = mo.project_id
         left join sales_order_line_overview lo on lo.id = mo.sales_order_line_id
         left join sales_order_overview so on so.id = lo.order_id
         left join lots fl on fl.id = mo.finished_lot_id
        where mo.id = $1`, [id])).rows[0];
    if (!mo) return null;
    const reqs = (await tx.query<Req>(
      `select item_id, sku, name, name_bg, kind, base_unit, required::text, reserved::text, available::text, at_production::text, requested::text,
              ordered::text
         from mo_material_requirements($1)`, [id])).rows;
    const packaging = (await tx.query<Pack>(
      `select mp.id, i.sku, i.name, i.name_bg, mp.qty_per_pack::text from mo_packaging mp join items i on i.id = mp.item_id
        where mp.mo_id = $1 order by i.name`, [id])).rows;
    const packOptions = mo.status === "simulation"
      ? (await tx.query<{ id: string; sku: string; name: string; name_bg: string | null }>(
          "select id, sku, name, name_bg from items where is_active and type = 'packaging' order by name")).rows
      : [];
    const projects = mo.status === "simulation"
      ? (await tx.query<{ id: string; code: string; name: string }>(
          "select id, code, name from projects where status not in ('completed', 'lost') order by code desc")).rows
      : [];
    const invoices = canPlan
      ? (await tx.query<Invoice>(
          "select id, invoice_number, invoice_date::text, amount::text, currency from production_invoices where mo_id = $1 order by invoice_date", [id])).rows
      : [];
    const canSeeCosts = (await tx.query<{ ok: boolean }>("select can_see_purchase_prices() as ok")).rows[0]?.ok ?? false;
    const cost = canSeeCosts ? (await tx.query<Cost>("select * from mo_cost($1)", [id])).rows[0] : undefined;
    const costLines = canSeeCosts && mo.status === "completed"
      ? (await tx.query<CostLine>(
          "select sku, name, name_bg, base_unit, lot_number, quantity::text, unit_cost::text, cost::text, estimated from mo_costs($1)", [id])).rows
      : [];
    const usage = canPlan && mo.status === "completed"
      ? (await tx.query<Usage>(
          `select item_id, sku, name, name_bg, base_unit, reserved::text, used::text, diff::text, diff_pct::text, over_limit, reason,
                  diff_value::text from mo_usage_report($1)`, [id])).rows
      : [];
    const sources = canPlan && mo.status !== "cancelled"
      ? (await tx.query<Source>(
          `select item_id, source, delivery_id, delivery_code, lot_number, supplier, quantity::text, unit_price::text, currency,
                  on_date::text, status from mo_material_sources($1)`, [id])).rows
      : [];
    const tolerance = (await tx.query<{ pct: string }>("select production_variance_pct::text as pct from company_settings limit 1")).rows[0]?.pct ?? "5";
    const orderForm = canPlan && !["completed", "cancelled"].includes(mo.status)
      ? {
          suppliers: (await tx.query<Opt>("select id, name from suppliers where is_active order by name")).rows,
          locations: (await tx.query<Opt & { code: string }>(
            "select id, code, name from locations where is_active and type <> 'virtual' order by (code = 'PF-QUAR') desc, is_partner_visible desc, name")).rows,
        }
      : undefined;
    return { mo, reqs, packaging, packOptions, projects, invoices, cost, costLines, usage, sources, tolerance, orderForm };
  });
  if (!data) notFound();
  const { mo, reqs, packaging, packOptions, projects, invoices, cost, costLines, usage, sources, tolerance, orderForm } = data;

  const open = ["simulation", "scheduled", "released"].includes(mo.status);
  const missingAny = reqs.some((r) => Number(r.reserved) < Number(r.required));
  const reqGrid = "md:grid-cols-[minmax(0,1.4fr)_105px_105px_105px_150px] xl:grid-cols-[minmax(0,1.4fr)_repeat(6,minmax(0,1fr))_140px]";
  const notAtProduction = reqs.filter((r) => Number(r.at_production) < Number(r.required)).length;
  const qtyOf = (itemId: string, n: string | null) => {
    const r = reqs.find((x) => x.item_id === itemId);
    return r ? formatQty(locale, n, r.base_unit) : formatNumber(locale, n, 3);
  };
  const hidden = (x: string) => <input type="hidden" name="mo_id" value={x} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/production" className="text-ink-2">{P.title}</Link> / {mo.code}</>}
        title={`${mo.code} · ${locale === "bg" && mo.product_bg ? mo.product_bg : mo.product}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Chip tone={moTone(mo.status)}>{t.enums.moStatus[mo.status as "simulation"]}</Chip>
            <span>{formatNumber(locale, mo.quantity)} {t.common.units}{mo.planned_date ? ` · ${formatDate(locale, mo.planned_date)}` : ""}</span>
          </span>
        }
        actions={canPlan && (mo.status === "released" || mo.status === "in_production") && (
          <Link href={`/production/${mo.id}/pick-list`} className="btn btn-outline">{t.pickList.open}</Link>
        )}
      />

      <div className="grid grid-cols-1 items-start gap-4">
        <Card title={d.materials} id="materials-h">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Fact label={t.formulas.title}><Link href={`/formulas/${mo.formula_id}?v=${mo.version}`} className="text-ink">{fmt(t.offers.detail.formulaVersion, { code: mo.formula_code, n: mo.version })}</Link></Fact>
            <Fact label={P.project}>{mo.project_code ?? "—"}</Fact>
            <Fact label={d.fromOrder}>{mo.order_id ? <Link href={`/orders/${mo.order_id}`} className="text-ink">{mo.order_code}</Link> : "—"}</Fact>
            <Fact label={t.formulas.format}>{t.enums.productFormat[mo.product_format as "capsule"]}</Fact>
          </div>
          <p className="m-0 text-[13px] text-ink-2">{d.materialsNote}</p>
          <div>
            <div className={`row hide-sm border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${reqGrid}`}>
              <span>{d.item}</span><span>{d.required}</span><span>{d.reserved}</span>
              <span className="hidden xl:block">{d.available}</span><span className="hidden xl:block">{d.requested}</span>
              <span className="hidden xl:block">{d.ordered}</span>
              <span>{d.atProduction}</span><span><span className="sr-only">{P.status}</span></span>
            </div>
            {reqs.map((r) => {
              const missing = Number(r.required) - Number(r.reserved);
              return (
                <div key={r.item_id} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 ${reqGrid}`}>
                  <div className="min-w-0">
                    <div className="font-semibold break-words">{nm(r)}</div>
                    <div className="text-xs text-ink-2">{r.sku} · {t.offers.detail.kinds[r.kind as "ingredient"]}</div>
                  </div>
                  <span className="hide-sm">{formatQty(locale, r.required, r.base_unit)}</span>
                  <span className="hide-sm">{formatQty(locale, r.reserved, r.base_unit)}</span>
                  <span className="hidden xl:block">{formatQty(locale, r.available, r.base_unit)}</span>
                  <span className="hidden xl:block">{formatQty(locale, r.requested, r.base_unit)}</span>
                  <span className="hidden xl:block">{formatQty(locale, r.ordered, r.base_unit)}</span>
                  <span className="hide-sm">{formatQty(locale, r.at_production, r.base_unit)}</span>
                  {mo.status === "completed" || mo.status === "cancelled" ? <span /> : missing > 0
                    ? <Chip tone="red">{fmt(d.missing, { qty: formatQty(locale, missing, r.base_unit) })}</Chip>
                    : <Chip tone="green">{d.covered}</Chip>}
                </div>
              );
            })}
          </div>
          {(mo.status === "scheduled" || mo.status === "released") && notAtProduction > 0 && (
            <p role="status" className="m-0 text-sm font-semibold text-amber-ink">{fmt(d.notAtProduction, { n: notAtProduction })}</p>
          )}
          {open && (
            <div className="flex flex-wrap gap-3">
              {missingAny && (
                <ActionForm action={reserveMo} submitLabel={d.reserve} resetOnSuccess={false}>{hidden(mo.id)}</ActionForm>
              )}
              {missingAny && (
                <ActionForm action={requestPurchases} submitLabel={d.requestPurchase} resetOnSuccess={false}>{hidden(mo.id)}</ActionForm>
              )}
            </div>
          )}
        </Card>

        {canPlan && (mo.status === "released" || mo.status === "in_production") && (
          <Card title={d.status} id="status-h">
            <p className="m-0 text-[13px] text-ink-2">{d.statusNote}</p>
            {mo.status_reason && <p className="m-0 text-sm text-amber-ink">{fmt(d.movedBack, { reason: mo.status_reason })}</p>}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-3">
                {mo.status === "released" && (
                  <ActionForm action={startProduction} submitLabel={d.startOnBehalf} resetOnSuccess={false}>{hidden(mo.id)}</ActionForm>
                )}
                {mo.status === "in_production" && (
                  <Link href={`/factory/orders/${mo.id}#report-h`} className="btn btn-primary w-fit">{d.reportOnBehalf}</Link>
                )}
              </div>
              <ActionForm action={revertMo} submitLabel={d.revertSubmit}>
                {hidden(mo.id)}
                <label className="field"><span>{d.revertReason} *</span><input name="reason" required className="input" /></label>
              </ActionForm>
            </div>
          </Card>
        )}

        {usage.length > 0 && (
          <Card title={d.usage} id="usage-h">
            <p className="m-0 text-[13px] text-ink-2">{fmt(d.usageNote, { pct: formatNumber(locale, tolerance) })}</p>
            <div>
              <div className="row hide-sm border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2 md:grid-cols-[minmax(0,1.2fr)_100px_100px_130px_100px] xl:grid-cols-[minmax(0,1.2fr)_105px_105px_140px_minmax(0,1fr)_110px]">
                <span>{d.item}</span><span>{d.reserved}</span><span>{t.factory.order.usedTotal}</span><span>{d.diff}</span>
                <span className="hidden xl:block">{d.reason}</span><span className="text-right">{d.diffValue}</span>
              </div>
              {usage.map((u) => (
                <div key={u.item_id} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 md:grid-cols-[minmax(0,1.2fr)_100px_100px_130px_100px] xl:grid-cols-[minmax(0,1.2fr)_105px_105px_140px_minmax(0,1fr)_110px]">
                  <div className="min-w-0">
                    <div className="font-semibold break-words">{nm(u)}</div>
                    <div className="text-xs text-ink-2">{u.sku}</div>
                    {u.reason && <div className="text-xs break-words text-ink-2 xl:hidden">{u.reason}</div>}
                  </div>
                  <span className="hide-sm">{formatQty(locale, u.reserved, u.base_unit)}</span>
                  <span className="hide-sm">{formatQty(locale, u.used, u.base_unit)}</span>
                  <span>
                    <Chip tone={u.over_limit ? "red" : "neutral"}>
                      {Number(u.diff) > 0 ? "+" : ""}{formatQty(locale, u.diff, u.base_unit)}{u.diff_pct != null ? ` · ${Number(u.diff_pct) > 0 ? "+" : ""}${formatNumber(locale, u.diff_pct, 1)} %` : ""}
                    </Chip>
                  </span>
                  <span className="hidden min-w-0 break-words xl:block">{u.reason ?? "—"}</span>
                  <span className="hide-sm text-right font-semibold">{u.diff_value != null ? formatPrice(locale, u.diff_value) : "—"}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {(orderForm || sources.length > 0) && (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {sources.length > 0 ? (
              <Card title={d.sources} id="sources-h">
                {sources.map((x, i) => (
                  <div key={i} className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-b border-mist pb-2 text-sm last:border-0">
                    <span className="min-w-0 flex-[1_1_200px] break-words">
                      <span className="font-semibold">{nm(reqs.find((r) => r.item_id === x.item_id) ?? { name: x.item_id, name_bg: null })}</span>
                      <span className="block text-xs text-ink-2">
                        {x.source === "delivery"
                          ? <Link href={`/deliveries?open=${x.delivery_id}`} className="text-ink-2">{fmt(t.factory.order.delivery, { code: x.delivery_code ?? "" })}</Link>
                          : fmt(t.factory.order.stockLot, { lot: x.lot_number ?? "" })}
                        {x.supplier ? ` · ${x.supplier}` : ""} · {formatDate(locale, x.on_date)}
                      </span>
                    </span>
                    <span className="text-right">
                      {qtyOf(x.item_id, x.quantity)}
                      <span className="block text-xs text-ink-2">{x.unit_price != null ? formatPrice(locale, x.unit_price, x.currency, 4) : "—"}</span>
                    </span>
                  </div>
                ))}
              </Card>
            ) : <div className="hidden lg:block" />}
            {orderForm && (
              <Card title={d.orderMaterial} id="order-h">
                <p className="m-0 text-[13px] text-ink-2">{d.orderMaterialNote}</p>
                <ActionForm action={orderMoMaterial} submitLabel={d.orderSubmit}>
                  {hidden(mo.id)}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="field sm:col-span-2"><span>{d.material} *</span>
                      <SearchSelect name="item_id" required placeholder={t.common.typeToSearch} noResults={t.common.noResults}
                        options={reqs.map((r) => {
                          const short = Number(r.required) - Number(r.reserved) - Number(r.ordered);
                          return { value: r.item_id, label: `${nm(r)} · ${r.sku}`, keywords: `${r.name} ${r.name_bg ?? ""}`,
                                   hint: short > 0 ? fmt(d.missing, { qty: formatQty(locale, short, r.base_unit) }) : undefined };
                        })} />
                    </label>
                    <label className="field"><span>{t.deliveries.quantity} *</span><input name="quantity" type="number" min="0.0001" step="any" required className="input" /></label>
                    <label className="field"><span>{d.supplier}</span>
                      <SearchSelect name="supplier_id" emptyLabel="—" placeholder={t.common.typeToSearch} noResults={t.common.noResults} options={orderForm.suppliers.map((s) => ({ value: s.id, label: s.name }))} />
                    </label>
                    <label className="field"><span>{d.unitPrice}</span><input name="unit_price" type="number" min="0" step="any" className="input" /></label>
                    <label className="field"><span>{d.expectedOn}</span><input name="expected_on" type="date" className="input" /></label>
                    <label className="field sm:col-span-2"><span>{d.arrivesAt} *</span>
                      <select name="location_id" required className="input">
                        {orderForm.locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}
                      </select>
                    </label>
                  </div>
                </ActionForm>
              </Card>
            )}
          </div>
        )}

        {cost && mo.status !== "cancelled" && (
          <Card title={d.cost} id="cost-h">
            <p className="m-0 text-sm text-ink-2">{cost.is_actual ? d.actualCost : d.plannedCost}</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
              <Fact label={d.materialsCost}>{formatPrice(locale, cost.material_cost)}</Fact>
              <Fact label={d.partnerCost}>{formatPrice(locale, cost.partner_cost)}</Fact>
              <Fact label={d.totalCost}><strong>{formatPrice(locale, cost.total_cost)}</strong></Fact>
              <Fact label={P.quantity}>{formatNumber(locale, cost.packs)}</Fact>
              <Fact label={d.perPack}><strong>{cost.cost_per_pack != null ? formatPrice(locale, cost.cost_per_pack, "EUR", 4) : "—"}</strong></Fact>
            </div>
            {cost.is_actual && cost.estimated_lines > 0 && <p className="m-0 text-sm text-amber-ink">{fmt(d.estimatedNote, { n: cost.estimated_lines })}</p>}
            {cost.missing_prices > 0 && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{fmt(d.missingPrices, { n: cost.missing_prices })}</p>}
            {costLines.length > 0 && (
              <div>
                <div className="row hide-sm border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2 md:grid-cols-[minmax(0,1.4fr)_120px_120px_120px_120px]">
                  <span>{d.costLines}</span><span>{d.lot}</span><span>{t.purchasing.quantity}</span><span>{d.unitCost}</span><span className="text-right">{d.totalCost}</span>
                </div>
                {costLines.map((c, i) => (
                  <div key={i} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-2.5 text-sm last:border-0 md:grid-cols-[minmax(0,1.4fr)_120px_120px_120px_120px]">
                    <span className="min-w-0 break-words">{nm(c)}<span className="block text-xs text-ink-2 md:hidden">{c.lot_number} · {formatQty(locale, c.quantity, c.base_unit)}</span></span>
                    <span className="hide-sm">{c.lot_number}</span>
                    <span className="hide-sm">{formatQty(locale, c.quantity, c.base_unit)}</span>
                    <span className={`hide-sm ${c.estimated ? "text-amber-ink" : ""}`}>{c.unit_cost != null ? formatPrice(locale, c.unit_cost, "EUR", 4) : "—"}</span>
                    <span className="text-right font-semibold">{c.cost != null ? formatPrice(locale, c.cost) : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            {open && (
              <Card title={d.plan} id="plan-h">
                {!canPlan && <p className="m-0 text-sm text-ink-2">{d.salesOnly}</p>}
                {canPlan && (mo.status === "simulation" || mo.status === "scheduled") && (
                  <ActionForm action={scheduleMo} submitLabel={d.schedule} resetOnSuccess={false}>
                    {hidden(mo.id)}
                    <p className="m-0 text-[13px] text-ink-2">{d.scheduleNote}</p>
                    <label className="field"><span>{d.planDate} *</span>
                      <input name="planned_date" type="date" required defaultValue={mo.planned_date ?? ""} className="input" />
                    </label>
                  </ActionForm>
                )}
                {canPlan && mo.status === "scheduled" && (
                  <ActionForm action={releaseMo} submitLabel={d.release} resetOnSuccess={false}>
                    {hidden(mo.id)}
                    <p className="m-0 text-[13px] text-ink-2">{d.releaseNote}</p>
                  </ActionForm>
                )}
                {canPlan && (
                  <ActionForm action={cancelMo} submitLabel={d.cancel} resetOnSuccess={false}>
                    {hidden(mo.id)}
                    <p className="m-0 text-[13px] text-ink-2">{d.cancelNote}</p>
                  </ActionForm>
                )}
              </Card>
            )}

            {mo.status === "simulation" && (
              <Card title={d.settings} id="settings-h">
                <ActionForm action={saveMo} submitLabel={t.common.save} resetOnSuccess={false}>
                  {hidden(mo.id)}
                  <label className="field"><span>{P.quantity} *</span><input name="quantity" type="number" min={1} step={1} required defaultValue={mo.quantity} className="input" /></label>
                  <label className="field"><span>{P.project}</span>
                    <select name="project_id" className="input" defaultValue={mo.project_id ?? ""}>
                      <option value="">{P.noProject}</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>{t.orders.detail.notes}</span><textarea name="notes" defaultValue={mo.notes ?? ""} className="input" /></label>
                </ActionForm>
              </Card>
            )}

            {mo.batch_number && (
              <Card title={d.batch} id="batch-h">
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <Fact label={d.batchNumber}>{mo.batch_number}</Fact>
                  <Fact label={d.produced}>{formatNumber(locale, mo.produced_quantity ?? 0)} {t.common.units}</Fact>
                  <Fact label={d.producedOn}>{formatDate(locale, mo.produced_on)}</Fact>
                  <Fact label={d.finishedLot}><Link href="/qc" className="text-ink">{mo.finished_lot}</Link></Fact>
                </div>
              </Card>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Card title={d.packaging} id="packaging-h">
              {packaging.length === 0 && <Empty>{d.noPackaging}</Empty>}
              {packaging.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-mist pb-3 text-sm last:border-0">
                  <span className="min-w-0 flex-[1_1_200px] break-words"><span className="font-semibold">{nm(p)}</span> <span className="text-ink-2">· {p.sku}</span></span>
                  <span>{formatNumber(locale, p.qty_per_pack, 3)} {t.common.units}</span>
                  {mo.status === "simulation" && (
                    <form action={removeMoPackaging}>
                      <input type="hidden" name="packaging_id" value={p.id} />
                      {hidden(mo.id)}
                      <button type="submit" className="btn btn-outline" aria-label={`${d.remove}: ${nm(p)}`}>{d.remove}</button>
                    </form>
                  )}
                </div>
              ))}
              {mo.status === "simulation" && (
                <ActionForm action={addMoPackaging} submitLabel={d.addPackaging}>
                  {hidden(mo.id)}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    <label className="field"><span>{d.item} *</span>
                      <SearchSelect name="item_id" required placeholder={t.common.typeToSearch} noResults={t.common.noResults}
                        options={packOptions.map((p) => ({ value: p.id, label: `${nm(p)} · ${p.sku}`, keywords: `${p.name} ${p.name_bg ?? ""}` }))} />
                    </label>
                    <label className="field"><span>{d.qtyPerPack}</span><input name="qty_per_pack" type="number" min="0.0001" step="any" defaultValue={1} className="input" /></label>
                  </div>
                </ActionForm>
              )}
            </Card>

            {canPlan && (
              <Card title={d.invoices} id="invoices-h">
                {invoices.length === 0 && <Empty>{d.noInvoices}</Empty>}
                {invoices.map((i) => (
                  <div key={i.id} className="flex flex-wrap justify-between gap-2 text-sm">
                    <span>{i.invoice_number} · {formatDate(locale, i.invoice_date)}</span>
                    <span className="font-semibold">{formatPrice(locale, i.amount, i.currency)}</span>
                  </div>
                ))}
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
