import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { fmt, formatDate, formatNumber, formatPrice } from "@/lib/i18n";
import { Card, Chip, Empty, Fact, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { orderTone } from "@/lib/status";
import { addOrderLine, createProductionFromLine, linkOrderLineFormula, removeOrderLine, saveOrder, setOrderStatus } from "@/app/actions";

type Overview = { id: string; code: string; status: string; requested_date: string | null; client: string; client_id: string };
type Line = {
  id: string; quantity: number; project_id: string | null; project_code: string | null; project_name: string | null; formula_id: string | null;
  formula_code: string | null; formula_version: number | null; formula_version_id: string | null; product: string; product_bg: string | null;
  offer_id: string | null; kind: "offer" | "calc_offer" | "service"; calc_offer_id: string | null; calc_offer_no: string | null;
};
type Approved = { id: string; code: string; name: string; name_bg: string | null; version: number };
type Commercial = {
  currency: string; deposit_pct: string | null; balance_terms: "before_dispatch" | "net_days" | null; balance_net_days: number | null;
  deposit_received_on: string | null; balance_received_on: string | null; customer_ref: string | null; notes: string | null;
};
type Mo = { id: string; code: string; status: string; sales_order_line_id: string; quantity: number };
type OfferOption = { offer_id: string; code: string; product: string; product_bg: string | null; quantity: number; unit_price: string };

// Next steps offered per status (the database decides what is allowed)
const NEXT: Record<string, string[]> = {
  draft: ["confirmed", "cancelled"],
  unpaid: ["confirmed", "cancelled"],
  confirmed: ["in_production", "draft", "cancelled"],
  in_production: ["ready", "cancelled"],
  ready: ["dispatched"],
  dispatched: ["closed"],
};

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const { user, locale, t } = await requireStaff();
  const d = t.orders.detail;
  const canEdit = user.role === "admin" || user.role === "sales";
  const isAdmin = user.role === "admin";
  const productName = (l: { product: string; product_bg: string | null }) => (locale === "bg" && l.product_bg ? l.product_bg : l.product);

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const o = (await tx.query<Overview>(
      "select id, code, status, requested_date::text, client, client_id from sales_order_overview where id = $1", [id])).rows[0];
    if (!o) return null;
    const lines = (await tx.query<Line>(
      `select id, quantity, project_id, project_code, project_name, formula_id, formula_code, formula_version, formula_version_id, product, product_bg,
              offer_id, kind, calc_offer_id, calc_offer_no
         from sales_order_line_overview where order_id = $1 order by sort_order`, [id])).rows;
    const mos = (await tx.query<Mo>(
      `select id, code, status, sales_order_line_id, quantity from manufacturing_orders
        where sales_order_line_id in (select id from sales_order_line_overview where order_id = $1) order by code`, [id])).rows;
    const c = canEdit
      ? (await tx.query<Commercial>(
          `select currency, deposit_pct::text, balance_terms, balance_net_days, deposit_received_on::text, balance_received_on::text,
                  customer_ref, notes from sales_orders where id = $1`, [id])).rows[0]
      : undefined;
    const prices = canEdit
      ? (await tx.query<{ id: string; unit_price: string; offer_code: string }>(
          `select l.id, l.unit_price::text, of.code as offer_code from sales_order_lines l left join offers of on of.id = l.offer_id
            where l.order_id = $1`, [id])).rows
      : [];
    const offerOptions = canEdit && o.status === "draft"
      ? (await tx.query<OfferOption>(
          `select of.id as offer_id, of.code, f.name as product, f.name_bg as product_bg, t.quantity, t.unit_price::text
             from offers of join offer_tiers t on t.offer_id = of.id
             join formula_versions v on v.id = of.formula_version_id join formulas f on f.id = v.formula_id
            where of.client_id = $1 and of.status in ('sent', 'accepted') and of.project_id is not null and t.unit_price is not null
            order by of.code desc, t.quantity`, [o.client_id])).rows
      : [];
    // Approved formulas a calculator line can be made from (the client's own or general ones)
    const approved = isAdmin && ["confirmed", "in_production"].includes(o.status) && lines.some((l) => l.kind === "calc_offer" && !l.formula_version_id)
      ? (await tx.query<Approved>(
          `select v.id, f.code, f.name, f.name_bg, v.version from formula_versions v join formulas f on f.id = v.formula_id
            where v.status = 'approved' and (f.client_id is null or f.client_id = $1) order by f.client_id is null, f.code`, [o.client_id])).rows
      : [];
    return { o, lines, mos, c, prices, offerOptions, approved };
  });
  if (!data) notFound();
  const { o, lines, mos, c, prices, offerOptions, approved } = data;
  const products = lines.filter((l) => l.kind !== "service");
  const services = lines.filter((l) => l.kind === "service");
  // Payment of the proforma is confirmed by admin only
  const next = (NEXT[o.status] ?? []).filter((s) => !(o.status === "unpaid" && s === "confirmed" && !isAdmin));

  const price = new Map(prices.map((p) => [p.id, p]));
  const total = lines.reduce((s, l) => s + Number(price.get(l.id)?.unit_price ?? 0) * l.quantity, 0);
  const money = (n: number | string) => formatPrice(locale, n, c?.currency ?? "EUR");
  const isDraft = o.status === "draft";
  const canPlan = !["cancelled", "dispatched", "closed"].includes(o.status);
  const balanceText = c ? fmt(t.enums.balanceTerms[c.balance_terms ?? "before_dispatch"], { days: c.balance_net_days ?? 0 }) : "";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/orders" className="text-ink-2">{t.orders.title}</Link> / {o.code}</>}
        title={`${o.code} · ${o.client}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Chip tone={orderTone(o.status)}>{t.enums.orderStatus[o.status as "draft"]}</Chip>
            <span>{t.orders.products}: {products.length}{c ? ` · ${money(total)}` : ""}</span>
          </span>
        }
        actions={canEdit && o.status !== "cancelled" ? (
          <Link href={`/orders/${o.id}/proforma`} className="btn btn-primary">{d.exportProforma}</Link>
        ) : undefined}
      />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={d.lines} id="lines-h">
            {products.length === 0 && <Empty>{d.noLines}</Empty>}
            {products.map((l) => {
              const p = price.get(l.id);
              const lineMos = mos.filter((m) => m.sales_order_line_id === l.id);
              const active = lineMos.some((m) => m.status !== "cancelled");
              return (
                <div key={l.id} className="flex flex-col gap-3 border-b border-mist pb-4 last:border-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-[1_1_240px]">
                      <div className="font-semibold break-words">{productName(l)}</div>
                      <div className="text-xs text-ink-2">
                        {l.kind === "calc_offer" && l.calc_offer_id && (
                          <Link href={`/offers/calc/${l.calc_offer_id}`} className="text-ink-2">{fmt(d.calcOffer, { no: l.calc_offer_no ?? "" })}</Link>
                        )}
                        {l.formula_code && <>{l.kind === "calc_offer" && " · "}{l.project_code} · {l.project_name} · {fmt(t.offers.detail.formulaVersion, { code: l.formula_code, n: l.formula_version ?? 0 })}</>}
                        {l.offer_id && p?.offer_code && <> · <Link href={`/offers/${l.offer_id}`} className="text-ink-2">{p.offer_code}</Link></>}
                      </div>
                    </div>
                    {isDraft && canEdit && (
                      <form action={removeOrderLine}>
                        <input type="hidden" name="line_id" value={l.id} />
                        <input type="hidden" name="order_id" value={o.id} />
                        <button type="submit" className="btn btn-outline" aria-label={`${d.remove}: ${productName(l)}`}>{d.remove}</button>
                      </form>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                    <Fact label={d.quantity}>{formatNumber(locale, l.quantity)} {t.common.units}</Fact>
                    {p && <Fact label={d.unitPrice}>{money(p.unit_price)}</Fact>}
                    {p && <Fact label={d.lineTotal}><strong>{money(Number(p.unit_price) * l.quantity)}</strong></Fact>}
                    <Fact label={d.production}>
                      {lineMos.length === 0 ? "—" : (
                        <span className="flex flex-col gap-1">
                          {lineMos.map((m) => (
                            <Link key={m.id} href={`/production/${m.id}`} className="text-ink">
                              {m.code} · {t.enums.moStatus[m.status as "simulation"]}
                            </Link>
                          ))}
                        </span>
                      )}
                    </Fact>
                  </div>
                  {isAdmin && l.kind === "calc_offer" && !l.formula_version_id && ["confirmed", "in_production"].includes(o.status) && (
                    <div className="flex flex-col gap-2 rounded-sm border border-line p-3">
                      <div className="text-sm font-semibold">{d.formula}</div>
                      <p className="m-0 text-[13px] text-ink-2">{d.formulaHint}</p>
                      {approved.length === 0 ? (
                        <p className="m-0 text-[13px] font-semibold">{d.noApproved} <Link href="/formulas" className="text-ink">{t.nav.formulas}</Link></p>
                      ) : (
                        <ActionForm action={linkOrderLineFormula} submitLabel={d.linkFormula} resetOnSuccess={false}>
                          <input type="hidden" name="line_id" value={l.id} />
                          <label className="field"><span>{d.chooseFormula} *</span>
                            <select name="formula_version_id" required className="input" defaultValue="">
                              <option value="" disabled>—</option>
                              {approved.map((v) => (
                                <option key={v.id} value={v.id}>{fmt(t.offers.detail.formulaVersion, { code: v.code, n: v.version })} · {productName({ product: v.name, product_bg: v.name_bg })}</option>
                              ))}
                            </select>
                          </label>
                        </ActionForm>
                      )}
                    </div>
                  )}
                  {canPlan && !active && l.formula_version_id && o.status !== "unpaid" && (
                    <ActionForm action={createProductionFromLine} submitLabel={d.planProduction} resetOnSuccess={false}>
                      <input type="hidden" name="line_id" value={l.id} />
                    </ActionForm>
                  )}
                </div>
              );
            })}
            {services.length > 0 && (
              <div className="flex flex-col gap-2 border-t border-mist pt-4">
                <h3 className="m-0 text-base font-bold">{t.orders.new.services}</h3>
                {services.map((l) => {
                  const p = price.get(l.id);
                  return (
                    <div key={l.id} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-2 text-sm last:border-0 sm:grid-cols-[minmax(0,1fr)_120px_120px]">
                      <span className="min-w-0 break-words">{l.product}</span>
                      <span className="hide-sm">{formatNumber(locale, l.quantity)} × {p ? money(p.unit_price) : "—"}</span>
                      <strong className="text-right">{p ? money(Number(p.unit_price) * l.quantity) : ""}</strong>
                    </div>
                  );
                })}
              </div>
            )}
            {isDraft && canEdit && offerOptions.length > 0 && (
              <div className="flex flex-col gap-3 border-t border-mist pt-4">
                <h3 className="m-0 text-base font-bold">{d.addLine}</h3>
                <p className="m-0 text-[13px] text-ink-2">{d.addLineNote}</p>
                <ActionForm action={addOrderLine} submitLabel={t.common.add}>
                  <input type="hidden" name="order_id" value={o.id} />
                  <label className="field"><span>{d.chooseOffer} *</span>
                    <select name="offer_quantity" required className="input" defaultValue="">
                      <option value="" disabled>—</option>
                      {offerOptions.map((x) => (
                        <option key={x.offer_id + x.quantity} value={`${x.offer_id}|${x.quantity}`}>
                          {x.code} · {productName(x)} · {formatNumber(locale, x.quantity)} × {money(x.unit_price)}
                        </option>
                      ))}
                    </select>
                  </label>
                </ActionForm>
              </div>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {canEdit && next.length > 0 && (
            <Card title={d.nextStep} id="next-h">
              {o.status === "unpaid" && <p className="m-0 text-sm text-ink-2">{isAdmin ? d.unpaidNote : d.unpaidSales}</p>}
              {o.status === "confirmed" && <p className="m-0 text-sm text-ink-2">{d.depositWarning}</p>}
              {o.status === "ready" && <p className="m-0 text-sm text-ink-2">{d.balanceWarning}</p>}
              {next.map((s) => (
                <ActionForm key={s} action={setOrderStatus} submitLabel={o.status === "unpaid" && s === "confirmed" ? d.confirmPayment : d.toStatus[s as "confirmed"]} resetOnSuccess={false}>
                  <input type="hidden" name="order_id" value={o.id} />
                  <input type="hidden" name="status" value={s} />
                </ActionForm>
              ))}
            </Card>
          )}

          {c ? (
            <Card title={d.payments} id="payments-h">
              <p className="m-0 text-sm">
                {c.deposit_pct != null && Number(c.deposit_pct) > 0 && <>{fmt(d.depositAmount, { amount: money(total * Number(c.deposit_pct) / 100) })} · </>}
                {balanceText}
              </p>
              <ActionForm action={saveOrder} submitLabel={t.common.save} resetOnSuccess={false}>
                <input type="hidden" name="order_id" value={o.id} />
                <div className="grid grid-cols-1 gap-3">
                  <label className="field"><span>{d.depositPct}</span><input name="deposit_pct" type="number" min={0} max={100} step="any" defaultValue={c.deposit_pct ?? ""} className="input" /></label>
                  <label className="field"><span>{d.depositReceived}</span><input name="deposit_received_on" type="date" defaultValue={c.deposit_received_on ?? ""} className="input" /></label>
                  <label className="field"><span>{d.balanceReceived}</span><input name="balance_received_on" type="date" defaultValue={c.balance_received_on ?? ""} className="input" /></label>
                  <label className="field"><span>{d.requested}</span><input name="requested_date" type="date" defaultValue={o.requested_date ?? ""} className="input" /></label>
                  <label className="field"><span>{d.customerRef}</span><input name="customer_ref" defaultValue={c.customer_ref ?? ""} className="input" /></label>
                  <label className="field"><span>{d.notes}</span><textarea name="notes" defaultValue={c.notes ?? ""} className="input" /></label>
                </div>
              </ActionForm>
            </Card>
          ) : (
            <Card title={d.payments} id="payments-h">
              <Fact label={d.requested}>{formatDate(locale, o.requested_date)}</Fact>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
