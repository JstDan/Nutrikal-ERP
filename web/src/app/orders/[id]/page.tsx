import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { fmt, formatDate, formatNumber, formatPrice, formatQty } from "@/lib/i18n";
import { Card, Chip, Empty, Fact, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { orderTone } from "@/lib/status";
import { reserveOrderMaterials, saveOrder, setOrderStatus } from "@/app/actions";

type Overview = {
  id: string; code: string; status: string; quantity: number; requested_date: string | null; client: string; client_id: string;
  project_code: string; project_name: string; formula_id: string; formula_code: string; formula_version: number;
  product: string; product_bg: string | null; product_format: string; confirmed_at: string | null; dispatched_at: string | null;
};
type Commercial = {
  offer_id: string; offer_code: string; unit_price: string; currency: string; deposit_pct: string | null;
  balance_terms: "before_dispatch" | "net_days" | null; balance_net_days: number | null; deposit_received_on: string | null;
  balance_received_on: string | null; customer_ref: string | null; notes: string | null;
};
type Req = { item_id: string; sku: string; name: string; name_bg: string | null; kind: string; base_unit: string; required: string; reserved: string; available: string };

// Next steps offered per status (the database decides what is allowed)
const NEXT: Record<string, string[]> = {
  draft: ["confirmed", "cancelled"],
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
  const bgName = (o: { name: string; name_bg: string | null }) => (locale === "bg" && o.name_bg ? o.name_bg : o.name);

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const o = (await tx.query<Overview>(
      `select id, code, status, quantity, requested_date::text, client, client_id, project_code, project_name, formula_id,
              formula_code, formula_version, product, product_bg, product_format, confirmed_at::text, dispatched_at::text
         from sales_order_overview where id = $1`, [id])).rows[0];
    if (!o) return null;
    const c = canEdit
      ? (await tx.query<Commercial>(
          `select so.offer_id, of.code as offer_code, so.unit_price::text, so.currency, so.deposit_pct::text, so.balance_terms,
                  so.balance_net_days, so.deposit_received_on::text, so.balance_received_on::text, so.customer_ref, so.notes
             from sales_orders so join offers of on of.id = so.offer_id where so.id = $1`, [id])).rows[0]
      : undefined;
    const reqs = (await tx.query<Req>(
      `select item_id, sku, name, name_bg, kind, base_unit, required::text, reserved::text, available::text
         from order_material_requirements($1)`, [id])).rows;
    return { o, c, reqs };
  });
  if (!data) notFound();
  const { o, c, reqs } = data;

  const total = c ? Number(c.unit_price) * o.quantity : 0;
  const money = (n: number | string) => formatPrice(locale, n, c?.currency ?? "EUR");
  const canReserve = o.status === "confirmed" || o.status === "in_production";
  const balanceText = c ? fmt(t.enums.balanceTerms[c.balance_terms ?? "before_dispatch"], { days: c.balance_net_days ?? 0 }) : "";
  const reqGrid = "md:grid-cols-[minmax(0,1.6fr)_120px_120px_150px] lg:grid-cols-[minmax(0,1.6fr)_120px_120px_120px_150px] xl:grid-cols-[minmax(0,1.6fr)_100px_115px_90px_160px] xl:max-[1439px]:grid-cols-[minmax(0,1.6fr)_110px_110px_170px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/orders" className="text-ink-2">{t.orders.title}</Link> / {o.code}</>}
        title={`${o.code} · ${o.client}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Chip tone={orderTone(o.status)}>{t.enums.orderStatus[o.status as "draft"]}</Chip>
            <span>{locale === "bg" && o.product_bg ? o.product_bg : o.product} · {formatNumber(locale, o.quantity)} {t.common.units}</span>
          </span>
        }
      />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={t.orders.product} id="product-h">
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
              <Fact label={d.project}><Link href={`/clients/${o.client_id}`} className="text-ink">{o.project_code} · {o.project_name}</Link></Fact>
              <Fact label={t.formulas.title}>
                {canEdit
                  ? <Link href={`/formulas/${o.formula_id}?v=${o.formula_version}`} className="text-ink">{fmt(t.offers.detail.formulaVersion, { code: o.formula_code, n: o.formula_version })}</Link>
                  : fmt(t.offers.detail.formulaVersion, { code: o.formula_code, n: o.formula_version })}
              </Fact>
              <Fact label={t.formulas.format}>{t.enums.productFormat[o.product_format as "capsule"]}</Fact>
              <Fact label={t.orders.quantity}>{formatNumber(locale, o.quantity)} {t.common.units}</Fact>
              {c && <Fact label={d.unitPrice}>{money(c.unit_price)}</Fact>}
              {c && <Fact label={t.orders.total}><strong>{money(total)}</strong></Fact>}
              {c && <Fact label={d.offer}><Link href={`/offers/${c.offer_id}`} className="text-ink">{c.offer_code}</Link></Fact>}
              <Fact label={d.requested}>{formatDate(locale, o.requested_date)}</Fact>
            </div>
          </Card>

          <Card title={d.materials} id="materials-h">
            <p className="m-0 text-[13px] text-ink-2">{d.materialsNote}</p>
            <div>
              <div className={`row hide-sm border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${reqGrid}`}>
                <span>{d.item}</span><span>{d.required}</span><span>{d.reserved}</span>
                <span className="hide-md xl:max-[1439px]:hidden">{d.available}</span><span><span className="sr-only">{t.orders.status}</span></span>
              </div>
              {reqs.length === 0 && <div className="py-3"><Empty>{d.noMaterials}</Empty></div>}
              {reqs.map((r) => {
                const missing = Number(r.required) - Number(r.reserved);
                return (
                  <div key={r.item_id} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 ${reqGrid}`}>
                    <div className="min-w-0">
                      <div className="font-semibold break-words">{bgName(r)}</div>
                      <div className="text-xs text-ink-2">{r.sku} · {t.offers.detail.kinds[r.kind as "ingredient"]}</div>
                    </div>
                    <span className="hide-sm">{formatQty(locale, r.required, r.base_unit)}</span>
                    <span className="hide-sm">{formatQty(locale, r.reserved, r.base_unit)}</span>
                    <span className="hide-md xl:max-[1439px]:hidden">{formatQty(locale, r.available, r.base_unit)}</span>
                    {missing > 0
                      ? <Chip tone="red">{fmt(d.missing, { qty: formatQty(locale, missing, r.base_unit) })}</Chip>
                      : <Chip tone="green">{d.covered}</Chip>}
                  </div>
                );
              })}
            </div>
            {canReserve ? (
              <ActionForm action={reserveOrderMaterials} submitLabel={d.reserve} resetOnSuccess={false}>
                <input type="hidden" name="order_id" value={o.id} />
              </ActionForm>
            ) : (
              <p className="m-0 text-sm text-ink-2">{d.reserveNote}</p>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {canEdit && (NEXT[o.status]?.length ?? 0) > 0 && (
            <Card title={d.nextStep} id="next-h">
              {o.status === "confirmed" && <p className="m-0 text-sm text-ink-2">{d.depositWarning}</p>}
              {o.status === "ready" && <p className="m-0 text-sm text-ink-2">{d.balanceWarning}</p>}
              {NEXT[o.status].map((s) => (
                <ActionForm key={s} action={setOrderStatus} submitLabel={d.toStatus[s as "confirmed"]} resetOnSuccess={false}>
                  <input type="hidden" name="order_id" value={o.id} />
                  <input type="hidden" name="status" value={s} />
                </ActionForm>
              ))}
            </Card>
          )}

          {c && (
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
          )}
        </div>
      </div>
    </div>
  );
}
