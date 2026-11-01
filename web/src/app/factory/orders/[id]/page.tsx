import { ReasonField } from "@/components/reason-field";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt, formatDate, formatNumber, formatPrice, formatQty } from "@/lib/i18n";
import { Card, Chip, Empty, Fact, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { moTone } from "@/lib/status";
import { addProductionInvoice, completeProduction, startProduction } from "@/app/actions";

type Mo = {
  id: string; code: string; project_code: string; product: string; product_bg: string | null; product_format: string;
  serving_size: string; serving_unit: "pcs" | "g" | "ml"; servings_per_pack: number; quantity: number; planned_date: string | null;
  status: string; batch_number: string | null; produced_quantity: number | null; produced_on: string | null;
};
type Req = { item_id: string; sku: string; name: string; name_bg: string | null; base_unit: string; required: string; reserved: string; at_production: string };
type Lot = { lot_id: string; location_id: string; item_id: string; lot_number: string; location: string; quantity: string; expires_on: string | null };
type Source = {
  item_id: string; source: string; delivery_code: string | null; lot_number: string | null; supplier: string | null;
  quantity: string; unit_price: string | null; currency: string; on_date: string | null;
};
type Usage = { item_id: string; sku: string; name: string; name_bg: string | null; base_unit: string; reserved: string; used: string; diff: string; diff_pct: string | null; over_limit: boolean; reason: string | null };
type Invoice = { id: string; invoice_number: string; invoice_date: string; amount: string; currency: string };

/** A production order as the production facility sees it: by project code, no client, no sales prices. */
export default async function FactoryOrderPage({ params }: PageProps<"/factory/orders/[id]">) {
  const { id } = await params;
  const { user, locale, t } = await requireRole("production", "admin");
  const O = t.factory.order;
  const nm = (o: { name: string; name_bg: string | null }) => (locale === "bg" && o.name_bg ? o.name_bg : o.name);

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const mo = (await tx.query<Mo>(
      `select id, code, project_code, product, product_bg, product_format, serving_size::text, serving_unit, servings_per_pack, quantity,
              planned_date::text, status, batch_number, produced_quantity, produced_on::text
         from production_manufacturing_orders where id = $1`, [id])).rows[0];
    if (!mo) return null;
    const reqs = (await tx.query<Req>(
      `select item_id, sku, name, name_bg, base_unit, required::text, reserved::text, at_production::text
         from mo_material_requirements($1)`, [id])).rows;
    // Usable lots at the production locations, first expiry first
    const lots = mo.status === "in_production"
      ? (await tx.query<Lot>(
          `select b.lot_id, b.location_id, b.item_id, b.lot_number, l.code as location, b.quantity::text, b.expires_on::text
             from stock_balances b join locations l on l.id = b.location_id
            where b.quantity > 0 and b.qc_status = 'released' and not b.is_expired and l.is_partner_visible
              and b.item_id = any($1::uuid[])
            order by b.expires_on nulls last, b.lot_number`, [reqs.map((r) => r.item_id)])).rows
      : [];
    const sources = (await tx.query<Source>(
      `select item_id, source, delivery_code, lot_number, supplier, quantity::text, unit_price::text, currency, on_date::text
         from mo_material_sources($1)`, [id])).rows;
    const usage = mo.status === "completed"
      ? (await tx.query<Usage>(
          `select item_id, sku, name, name_bg, base_unit, reserved::text, used::text, diff::text, diff_pct::text, over_limit, reason
             from mo_usage_report($1)`, [id])).rows
      : [];
    const invoices = (await tx.query<Invoice>(
      "select id, invoice_number, invoice_date::text, amount::text, currency from production_invoices where mo_id = $1 order by invoice_date", [id])).rows;
    const pct = (await tx.query<{ pct: string }>("select variance_pct::text as pct from production_settings()")).rows[0]?.pct ?? "5";
    return { mo, reqs, lots, sources, usage, invoices, pct };
  });
  if (!data) notFound();
  const { mo, reqs, lots, sources, usage, invoices, pct } = data;

  // Suggested use: the reserved quantity, from the first-expiring lots
  let row = 0;
  const plan = reqs.map((r) => {
    let left = Number(r.reserved);
    return {
      req: r,
      lots: lots.filter((l) => l.item_id === r.item_id).map((l) => {
        const use = Math.max(0, Math.min(left, Number(l.quantity)));
        left -= use;
        return { lot: l, use: Math.round(use * 10000) / 10000, n: row++ };
      }),
    };
  });
  const unitLabel = (u: string) => (u === "pcs" ? t.common.units : u);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/factory/orders" className="text-ink-2">{t.factory.orders.title}</Link> / {mo.code}</>}
        title={`${mo.code} · ${locale === "bg" && mo.product_bg ? mo.product_bg : mo.product}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Chip tone={moTone(mo.status)}>{t.enums.moStatus[mo.status as "released"]}</Chip>
            <span>{mo.project_code} · {formatNumber(locale, mo.quantity)} {t.common.units}{mo.planned_date ? ` · ${formatDate(locale, mo.planned_date)}` : ""}</span>
          </span>
        }
        actions={mo.status !== "completed" && <Link href={`/production/${mo.id}/pick-list`} className="btn btn-outline">{O.pickList}</Link>}
      />

      {mo.status === "released" && (
        <Card>
          <ActionForm action={startProduction} submitLabel={O.start} resetOnSuccess={false}>
            <input type="hidden" name="mo_id" value={mo.id} />
            <p className="m-0 text-sm text-ink-2">{O.startNote}</p>
          </ActionForm>
        </Card>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={O.materials} id="mat-h">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              <Fact label={t.formulas.format}>{t.enums.productFormat[mo.product_format as "capsule"]}</Fact>
              <Fact label={t.formulas.detail.serving}>{formatNumber(locale, mo.serving_size, 3)} {t.enums.servingUnit[mo.serving_unit]}</Fact>
              <Fact label={t.formulas.detail.servingsPerPack}>{mo.servings_per_pack}</Fact>
            </div>
            <div>
              <div className="row hide-sm border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2 md:grid-cols-[minmax(0,1.4fr)_120px_120px_120px]">
                <span>{t.production.detail.item}</span><span>{O.needed}</span><span>{O.reserved}</span><span>{O.atFacility}</span>
              </div>
              {reqs.map((r) => (
                <div key={r.item_id} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 md:grid-cols-[minmax(0,1.4fr)_120px_120px_120px]">
                  <div className="min-w-0"><div className="font-semibold break-words">{nm(r)}</div><div className="text-xs text-ink-2">{r.sku}</div></div>
                  <span className="font-semibold">{formatQty(locale, r.required, r.base_unit)}</span>
                  <span className="hide-sm">{formatQty(locale, r.reserved, r.base_unit)}</span>
                  <span className="hide-sm">
                    {mo.status === "completed"
                      ? formatQty(locale, r.at_production, r.base_unit)
                      : <Chip tone={Number(r.at_production) >= Number(r.required) ? "green" : "red"}>{formatQty(locale, r.at_production, r.base_unit)}</Chip>}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {mo.status === "in_production" && (
            <Card title={O.report} id="report-h">
              <p className="m-0 text-sm text-ink-2">{fmt(O.reportNote, { pct: formatNumber(locale, pct) })}</p>
              <ActionForm action={completeProduction} submitLabel={O.submit} resetOnSuccess={false}>
                <input type="hidden" name="mo_id" value={mo.id} />
                {plan.map(({ req, lots: rows }) => (
                  <fieldset key={req.item_id} className="m-0 flex flex-col gap-3 rounded border border-line p-3">
                    <legend className="px-1 text-sm font-bold break-words">{nm(req)}</legend>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                      <span><span className="text-ink-2">{O.needed}: </span>{formatQty(locale, req.required, req.base_unit)}</span>
                      <span><span className="text-ink-2">{O.reservedRef}: </span><strong>{formatQty(locale, req.reserved, req.base_unit)}</strong></span>
                    </div>
                    {rows.length === 0 && <Empty>{O.noLots}</Empty>}
                    {rows.map(({ lot, use, n }) => (
                      <div key={lot.lot_id + lot.location_id} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_160px] sm:gap-3">
                        <input type="hidden" name={`use_${n}`} value={`${lot.lot_id}|${lot.location_id}`} />
                        <span className="min-w-0 text-sm break-words">
                          {lot.lot_number} · {lot.location}
                          <span className="block text-xs text-ink-2">{formatQty(locale, lot.quantity, req.base_unit)} · {t.inventory.expires} {formatDate(locale, lot.expires_on)}</span>
                        </span>
                        <label className="field"><span className="text-xs">{O.qtyUsed} ({unitLabel(req.base_unit)})</span>
                          <input name={`qty_${n}`} type="number" min={0} step="any" defaultValue={use || ""} className="input" />
                        </label>
                      </div>
                    ))}
                    <ReasonField name={`reason_${req.item_id}`} label={O.reason} choose={O.reasonChoose} other={O.reasonOther} otherLabel={O.reasonOtherLabel} options={O.reasons} />
                  </fieldset>
                ))}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="field"><span>{O.batchNumber} *</span><input name="batch_number" required className="input" /></label>
                  <label className="field"><span>{O.produced} *</span><input name="produced_quantity" type="number" min={1} step={1} required defaultValue={mo.quantity} className="input" /></label>
                  <label className="field"><span>{O.producedOn} *</span><input name="produced_on" type="date" required className="input" /></label>
                  <label className="field"><span>{O.expiresOn} *</span>
                    <input name="expires_on" type="date" required className="input" aria-describedby="expiry-hint" />
                    <small id="expiry-hint" className="text-xs text-ink-2">{O.expiresHint}</small>
                  </label>
                </div>
              </ActionForm>
            </Card>
          )}

          {usage.length > 0 && (
            <Card title={O.usage} id="usage-h">
              <div>
                <div className="row hide-sm border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2 md:grid-cols-[minmax(0,1.2fr)_110px_110px_150px]">
                  <span>{t.production.detail.item}</span><span>{O.reservedRef}</span><span>{O.usedTotal}</span><span>{t.production.detail.diff}</span>
                </div>
                {usage.map((u) => (
                  <div key={u.item_id} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 md:grid-cols-[minmax(0,1.2fr)_110px_110px_150px]">
                    <div className="min-w-0">
                      <div className="font-semibold break-words">{nm(u)}</div>
                      {u.reason && <div className="text-xs break-words text-ink-2">{u.reason}</div>}
                    </div>
                    <span className="hide-sm">{formatQty(locale, u.reserved, u.base_unit)}</span>
                    <span className="hide-sm">{formatQty(locale, u.used, u.base_unit)}</span>
                    <Chip tone={u.over_limit ? "red" : "neutral"}>
                      {Number(u.diff) > 0 ? "+" : ""}{formatQty(locale, u.diff, u.base_unit)}{u.diff_pct != null ? ` · ${formatNumber(locale, u.diff_pct, 1)} %` : ""}
                    </Chip>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title={O.sources} id="sources-h">
            <p className="m-0 text-[13px] text-ink-2">{O.sourcesNote}</p>
            {sources.length === 0 && <Empty>{O.noSources}</Empty>}
            {reqs.map((r) => {
              const list = sources.filter((x) => x.item_id === r.item_id);
              return list.length ? (
                <div key={r.item_id} className="flex flex-col gap-2 border-b border-mist pb-3 last:border-0">
                  <span className="text-sm font-semibold break-words">{nm(r)}</span>
                  {list.map((x, i) => (
                    <div key={i} className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <span className="col-span-2 text-xs text-ink-2">
                        {x.source === "delivery" ? fmt(O.delivery, { code: x.delivery_code ?? "" }) : fmt(O.stockLot, { lot: x.lot_number ?? "" })}
                      </span>
                      <Fact label={O.supplier}>{x.supplier ?? "—"}</Fact>
                      <Fact label={O.quantity}>{formatQty(locale, x.quantity, r.base_unit)}</Fact>
                      <Fact label={O.unitPrice}>{x.unit_price != null ? `${formatPrice(locale, x.unit_price, x.currency, 4)} / ${unitLabel(r.base_unit)}` : "—"}</Fact>
                      <Fact label={O.date}>{formatDate(locale, x.on_date)}</Fact>
                    </div>
                  ))}
                </div>
              ) : null;
            })}
          </Card>

          {mo.batch_number && (
            <Card title={t.production.detail.batch} id="batch-h">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <Fact label={O.batchNumber}>{mo.batch_number}</Fact>
                <Fact label={t.production.detail.produced}>{formatNumber(locale, mo.produced_quantity ?? 0)} {t.common.units}</Fact>
                <Fact label={O.producedOn}>{formatDate(locale, mo.produced_on)}</Fact>
              </div>
            </Card>
          )}

          <Card title={O.invoice} id="invoice-h">
            {invoices.map((i) => (
              <div key={i.id} className="flex flex-wrap justify-between gap-2 text-sm">
                <span>{i.invoice_number} · {formatDate(locale, i.invoice_date)}</span>
                <span className="font-semibold">{formatPrice(locale, i.amount, i.currency)}</span>
              </div>
            ))}
            <ActionForm action={addProductionInvoice} submitLabel={O.invoiceSubmit}>
              <input type="hidden" name="mo_id" value={mo.id} />
              <label className="field"><span>{O.invoiceNumber} *</span><input name="invoice_number" required className="input" /></label>
              <label className="field"><span>{O.invoiceDate} *</span><input name="invoice_date" type="date" required className="input" /></label>
              <label className="field"><span>{O.amount} *</span><input name="amount" type="number" min={0} step="0.01" required className="input" /></label>
            </ActionForm>
          </Card>
        </div>
      </div>
    </div>
  );
}
