import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { formatDate, formatNumber, formatPrice, formatQty } from "@/lib/i18n";
import { Card, Chip, Empty, Fact, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { moTone } from "@/lib/status";
import { addProductionInvoice, completeProduction, startProduction } from "@/app/actions";

type Mo = {
  id: string; code: string; project_code: string; product: string; product_bg: string | null; product_format: string;
  serving_size: string; serving_unit: "pcs" | "g" | "ml"; servings_per_pack: number; quantity: number; planned_date: string | null;
  status: string; batch_number: string | null; produced_quantity: number | null; produced_on: string | null;
};
type Req = { item_id: string; sku: string; name: string; name_bg: string | null; base_unit: string; required: string; reserved: string; at_partner: string };
type Lot = { lot_id: string; location_id: string; item_id: string; lot_number: string; location: string; quantity: string; expires_on: string | null };
type Invoice = { id: string; invoice_number: string; invoice_date: string; amount: string; currency: string };

export default async function PartnerProductionOrderPage({ params }: PageProps<"/partner/production/[id]">) {
  const { id } = await params;
  const { user, locale, t } = await requireRole("partner", "admin");
  const P = t.production.partner;
  const nm = (o: { name: string; name_bg: string | null }) => (locale === "bg" && o.name_bg ? o.name_bg : o.name);

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const mo = (await tx.query<Mo>(
      `select id, code, project_code, product, product_bg, product_format, serving_size::text, serving_unit, servings_per_pack, quantity,
              planned_date::text, status, batch_number, produced_quantity, produced_on::text
         from partner_manufacturing_orders where id = $1`, [id])).rows[0];
    if (!mo) return null;
    const reqs = (await tx.query<Req>(
      `select item_id, sku, name, name_bg, base_unit, required::text, reserved::text, at_partner::text
         from mo_material_requirements($1)`, [id])).rows;
    // Usable lots at the facility (RLS shows the partner only partner locations)
    const lots = (await tx.query<Lot>(
      `select b.lot_id, b.location_id, b.item_id, b.lot_number, l.name as location, b.quantity::text, b.expires_on::text
         from stock_balances b join locations l on l.id = b.location_id
        where b.quantity > 0 and b.qc_status = 'released' and not b.is_expired and l.is_partner_visible
          and b.item_id = any($1::uuid[])
        order by b.expires_on nulls last, b.lot_number`, [reqs.map((r) => r.item_id)])).rows;
    const invoices = (await tx.query<Invoice>(
      "select id, invoice_number, invoice_date::text, amount::text, currency from production_invoices where mo_id = $1 order by invoice_date", [id])).rows;
    return { mo, reqs, lots, invoices };
  });
  if (!data) notFound();
  const { mo, reqs, lots, invoices } = data;
  const canReport = mo.status === "released" || mo.status === "in_production";

  // Suggested use: first expiring lots first, up to what is needed
  let row = 0;
  const plan = reqs.map((r) => {
    let left = Number(r.required);
    return {
      req: r,
      lots: lots.filter((l) => l.item_id === r.item_id).map((l) => {
        const use = Math.max(0, Math.min(left, Number(l.quantity)));
        left -= use;
        return { lot: l, use: Math.round(use * 10000) / 10000, n: row++ };
      }),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/partner/production" className="text-ink-2">{P.title}</Link> / {mo.code}</>}
        title={`${mo.code} · ${locale === "bg" && mo.product_bg ? mo.product_bg : mo.product}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Chip tone={moTone(mo.status)}>{t.enums.moStatus[mo.status as "released"]}</Chip>
            <span>{mo.project_code} · {formatNumber(locale, mo.quantity)} {t.common.units}{mo.planned_date ? ` · ${formatDate(locale, mo.planned_date)}` : ""}</span>
          </span>
        }
        actions={canReport && <Link href={`/production/${mo.id}/pick-list`} className="btn btn-outline">{t.pickList.open}</Link>}
      />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={P.materials} id="mat-h">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              <Fact label={t.formulas.format}>{t.enums.productFormat[mo.product_format as "capsule"]}</Fact>
              <Fact label={t.formulas.detail.serving}>{formatNumber(locale, mo.serving_size, 3)} {t.enums.servingUnit[mo.serving_unit]}</Fact>
              <Fact label={t.formulas.detail.servingsPerPack}>{mo.servings_per_pack}</Fact>
            </div>
            <div>
              <div className="row hide-sm border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2 md:grid-cols-[minmax(0,1.4fr)_120px_120px_120px]">
                <span>{t.production.detail.item}</span><span>{P.required}</span><span>{P.reserved}</span><span>{P.atFacility}</span>
              </div>
              {reqs.map((r) => (
                <div key={r.item_id} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 md:grid-cols-[minmax(0,1.4fr)_120px_120px_120px]">
                  <div className="min-w-0"><div className="font-semibold break-words">{nm(r)}</div><div className="text-xs text-ink-2">{r.sku}</div></div>
                  <span className="font-semibold">{formatQty(locale, r.required, r.base_unit)}</span>
                  <span className="hide-sm">{formatQty(locale, r.reserved, r.base_unit)}</span>
                  <span className="hide-sm">
                    {mo.status === "completed"
                      ? formatQty(locale, r.at_partner, r.base_unit)
                      : <Chip tone={Number(r.at_partner) >= Number(r.required) ? "green" : "red"}>{formatQty(locale, r.at_partner, r.base_unit)}</Chip>}
                  </span>
                </div>
              ))}
            </div>
            {mo.status === "released" && (
              <ActionForm action={startProduction} submitLabel={P.start} resetOnSuccess={false}>
                <input type="hidden" name="mo_id" value={mo.id} />
              </ActionForm>
            )}
          </Card>

          {canReport && (
            <Card title={P.complete} id="complete-h">
              <p className="m-0 text-sm text-ink-2">{P.completeNote}</p>
              <ActionForm action={completeProduction} submitLabel={P.submit} resetOnSuccess={false}>
                <input type="hidden" name="mo_id" value={mo.id} />
                <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
                  <legend className="mb-2 text-base font-bold">{P.lotsUsed}</legend>
                  {plan.map(({ req, lots: rows }) => (
                    <div key={req.item_id} className="flex flex-col gap-2 border-b border-mist pb-3 last:border-0">
                      <div className="text-sm font-semibold">{nm(req)} <span className="font-normal text-ink-2">· {formatQty(locale, req.required, req.base_unit)}</span></div>
                      {rows.length === 0 && <Empty>{t.partner.noStock}</Empty>}
                      {rows.map(({ lot, use, n }) => (
                        <div key={lot.lot_id + lot.location_id} className="grid grid-cols-[minmax(0,1fr)_140px] items-end gap-3">
                          <input type="hidden" name={`use_${n}`} value={`${lot.lot_id}|${lot.location_id}`} />
                          <span className="min-w-0 text-sm break-words">
                            {lot.lot_number} · {lot.location}
                            <span className="block text-xs text-ink-2">{formatQty(locale, lot.quantity, req.base_unit)} · {t.inventory.expires} {formatDate(locale, lot.expires_on)}</span>
                          </span>
                          <label className="field"><span className="text-xs">{P.qtyUsed} ({req.base_unit === "pcs" ? t.common.units : req.base_unit})</span>
                            <input name={`qty_${n}`} type="number" min={0} step="any" defaultValue={use || ""} className="input" />
                          </label>
                        </div>
                      ))}
                    </div>
                  ))}
                </fieldset>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="field"><span>{P.batchNumber} *</span><input name="batch_number" required className="input" /></label>
                  <label className="field"><span>{P.produced} *</span><input name="produced_quantity" type="number" min={1} step={1} required defaultValue={mo.quantity} className="input" /></label>
                  <label className="field"><span>{P.producedOn} *</span><input name="produced_on" type="date" required className="input" /></label>
                </div>
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {mo.batch_number && (
            <Card title={t.production.detail.batch} id="batch-h">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <Fact label={P.batchNumber}>{mo.batch_number}</Fact>
                <Fact label={t.production.detail.produced}>{formatNumber(locale, mo.produced_quantity ?? 0)} {t.common.units}</Fact>
                <Fact label={P.producedOn}>{formatDate(locale, mo.produced_on)}</Fact>
              </div>
            </Card>
          )}
          <Card title={P.invoice} id="invoice-h">
            {invoices.map((i) => (
              <div key={i.id} className="flex flex-wrap justify-between gap-2 text-sm">
                <span>{i.invoice_number} · {formatDate(locale, i.invoice_date)}</span>
                <span className="font-semibold">{formatPrice(locale, i.amount, i.currency)}</span>
              </div>
            ))}
            <ActionForm action={addProductionInvoice} submitLabel={P.invoiceSubmit}>
              <input type="hidden" name="mo_id" value={mo.id} />
              <label className="field"><span>{P.invoiceNumber} *</span><input name="invoice_number" required className="input" /></label>
              <label className="field"><span>{P.invoiceDate} *</span><input name="invoice_date" type="date" required className="input" /></label>
              <label className="field"><span>{P.amount} *</span><input name="amount" type="number" min={0} step="0.01" required className="input" /></label>
            </ActionForm>
          </Card>
        </div>
      </div>
    </div>
  );
}
