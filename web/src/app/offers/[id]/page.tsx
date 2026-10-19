import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt, formatNumber, formatPrice, formatQty } from "@/lib/i18n";
import { Card, Chip, Empty, Fact, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { offerTone } from "@/lib/status";
import {
  addOfferPackaging, addOfferTier, createOrderFromOffer, recalcOffer, removeOfferPackaging, removeOfferTier, saveOfferTerms, setOfferStatus,
} from "@/app/actions";

type Offer = {
  id: string; code: string; status: string; locale: "bg" | "en"; currency: string; incoterm: string; valid_until: string | null;
  deposit_pct: string | null; balance_terms: "before_dispatch" | "net_days" | null; balance_net_days: number | null;
  notes: string | null; internal_notes: string | null; client: string; client_id: string; project_id: string | null; project_code: string | null;
  formula_id: string; formula_code: string; formula: string; formula_bg: string | null; version: number;
  product_format: string; serving_size: string; serving_unit: "pcs" | "g" | "ml"; servings_per_pack: number;
};
type Tier = { id: string; quantity: number; margin_pct: string | null; unit_price: string | null; price_is_manual: boolean; unit_cost: string | null; cost_complete: boolean };
type Pack = { id: string; sku: string; name: string; name_bg: string | null; qty_per_pack: string };
type CostLine = { kind: string; sku: string | null; name: string | null; name_bg: string | null; qty_per_pack: string | null; base_unit: string | null; unit_price: string | null; cost_per_pack: string | null };

const STATUSES = ["draft", "sent", "accepted", "rejected", "expired"] as const;
const KINDS = ["ingredient", "shell", "packaging", "production", "setup"] as const;

export default async function OfferPage({ params, searchParams }: PageProps<"/offers/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, locale, t } = await requireRole("admin", "sales");
  const d = t.offers.detail;
  const bgName = (o: { name: string | null; name_bg: string | null }) => (locale === "bg" && o.name_bg ? o.name_bg : o.name ?? "");

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const offer = (await tx.query<Offer>(
      `select o.id, o.code, o.status, o.locale, o.currency, o.incoterm, o.valid_until::text, o.deposit_pct::text, o.balance_terms,
              o.balance_net_days, o.notes, o.internal_notes, c.legal_name as client, c.id as client_id, o.project_id, p.code as project_code,
              f.id as formula_id, f.code as formula_code, f.name as formula, f.name_bg as formula_bg, v.version,
              f.product_format, f.serving_size::text, f.serving_unit, f.servings_per_pack
         from offers o
         join clients c on c.id = o.client_id
         left join projects p on p.id = o.project_id
         join formula_versions v on v.id = o.formula_version_id
         join formulas f on f.id = v.formula_id
        where o.id = $1`, [id])).rows[0];
    if (!offer) return null;
    const tiers = (await tx.query<Tier>(
      `select id, quantity, margin_pct::text, unit_price::text, price_is_manual, unit_cost::text, cost_complete
         from offer_tiers where offer_id = $1 order by quantity`, [id])).rows;
    const packaging = (await tx.query<Pack>(
      `select op.id, i.sku, i.name, i.name_bg, op.qty_per_pack::text
         from offer_packaging op join items i on i.id = op.item_id where op.offer_id = $1 order by i.name`, [id])).rows;
    const packOptions = (await tx.query<{ id: string; sku: string; name: string; name_bg: string | null }>(
      "select id, sku, name, name_bg from items where is_active and type = 'packaging' order by name")).rows;
    const canSeeCosts = (await tx.query<{ ok: boolean }>("select can_see_purchase_prices() as ok")).rows[0]?.ok ?? false;
    const breakdownQty = tiers.find((x) => x.quantity === Number(sp.tier))?.quantity ?? tiers[0]?.quantity;
    const breakdown = canSeeCosts && breakdownQty
      ? (await tx.query<CostLine>(
          `select kind, sku, name, name_bg, qty_per_pack::text, base_unit, unit_price::text, cost_per_pack::text
             from offer_cost_breakdown($1, $2)`, [id, breakdownQty])).rows
      : [];
    const orders = (await tx.query<{ id: string; code: string; quantity: number; status: string }>(
      "select id, code, quantity, status from sales_orders where offer_id = $1 order by code", [id])).rows;
    const projects = (await tx.query<{ id: string; code: string; name: string }>(
      "select id, code, name from projects where client_id = $1 and status not in ('completed', 'lost') order by code desc", [offer.client_id])).rows;
    return { offer, tiers, packaging, packOptions, canSeeCosts, breakdownQty, breakdown, orders, projects };
  });
  if (!data) notFound();
  const { offer: o, tiers, packaging, packOptions, canSeeCosts, breakdownQty, breakdown, orders, projects } = data;
  const oc = t.orders.create;
  const isDraft = o.status === "draft";
  const money = (n: string | number | null, frac = 2) => (n == null ? "—" : formatPrice(locale, n, o.currency, frac));
  const incomplete = tiers.some((x) => !x.cost_complete);
  const tierGrid = isDraft
    ? "md:grid-cols-[minmax(90px,1fr)_110px_90px_100px_44px] lg:grid-cols-[minmax(90px,1fr)_110px_90px_100px_120px_44px]"
    : "md:grid-cols-[minmax(90px,1fr)_110px_90px_100px] lg:grid-cols-[minmax(90px,1fr)_110px_90px_100px_120px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/offers" className="text-ink-2">{t.offers.title}</Link> / {o.code}</>}
        title={`${o.code} · ${o.client}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Chip tone={offerTone(o.status)}>{t.enums.offerStatus[o.status as "draft"]}</Chip>
            <span>{locale === "bg" && o.formula_bg ? o.formula_bg : o.formula}{o.project_code ? ` · ${o.project_code}` : ""}</span>
          </span>
        }
        actions={<Link href={`/offers/${o.id}/print`} className="btn btn-outline">{d.print}</Link>}
      />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={d.product} id="product-h">
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
              <Fact label={t.formulas.title}>
                <Link href={`/formulas/${o.formula_id}?v=${o.version}`} className="text-ink">{fmt(d.formulaVersion, { code: o.formula_code, n: o.version })}</Link>
              </Fact>
              <Fact label={t.formulas.format}>{t.enums.productFormat[o.product_format as "capsule"]}</Fact>
              <Fact label={t.formulas.detail.serving}>{formatNumber(locale, o.serving_size, 3)} {t.enums.servingUnit[o.serving_unit]}</Fact>
              <Fact label={t.formulas.detail.servingsPerPack}>{o.servings_per_pack}</Fact>
            </div>
          </Card>

          <Card title={d.tiers} id="tiers-h">
            {incomplete && <p role="alert" className="m-0 rounded bg-red-tint px-3 py-2 text-sm font-semibold text-red-ink">{d.incomplete}</p>}
            <div>
              <div className={`row hide-sm border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${tierGrid}`}>
                <span>{d.quantity}</span><span>{d.unitCost}</span><span>{d.margin}</span><span>{d.unitPrice}</span>
                <span className="hide-md">{d.total}</span>
                {isDraft && <span><span className="sr-only">{d.remove}</span></span>}
              </div>
              {tiers.length === 0 && <div className="py-3"><Empty>{d.noTiers}</Empty></div>}
              {tiers.map((x) => (
                <div key={x.id} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 ${tierGrid}`}>
                  <span className="font-semibold">
                    {canSeeCosts ? (
                      <Link href={`/offers/${o.id}?tier=${x.quantity}#breakdown-h`} className="text-ink">{formatNumber(locale, x.quantity)}</Link>
                    ) : formatNumber(locale, x.quantity)}
                  </span>
                  <span className="hide-sm">{money(x.unit_cost, 4)}</span>
                  <span className="hide-sm">{x.margin_pct != null ? `${formatNumber(locale, x.margin_pct)}%` : "—"}{x.price_is_manual && <span className="block text-xs text-ink-2">{d.manual}</span>}</span>
                  <span className="font-semibold">{money(x.unit_price)}</span>
                  <span className="hide-md">{x.unit_price ? money(Number(x.unit_price) * x.quantity) : "—"}</span>
                  {isDraft && (
                    <form action={removeOfferTier} className="col-start-2 justify-self-end md:col-start-auto">
                      <input type="hidden" name="tier_id" value={x.id} />
                      <input type="hidden" name="offer_id" value={o.id} />
                      <button type="submit" className="btn btn-outline h-11 w-11 text-base" style={{ padding: 0, letterSpacing: 0 }} aria-label={`${d.remove}: ${x.quantity}`} title={d.remove}>×</button>
                    </form>
                  )}
                </div>
              ))}
            </div>
            {isDraft && (
              <div className="flex flex-col gap-4 border-t border-mist pt-4">
                <h3 className="m-0 text-base font-bold">{d.addTier}</h3>
                <ActionForm action={addOfferTier} submitLabel={t.common.add}>
                  <input type="hidden" name="offer_id" value={o.id} />
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <label className="field"><span>{d.quantity} *</span><input name="quantity" type="number" min={1} step={1} required className="input" /></label>
                    <label className="field"><span>{d.marginPct}</span>
                      <input name="margin_pct" type="number" min={0} max={99} step="any" className="input" aria-describedby="margin-hint" />
                      <small id="margin-hint" className="text-xs text-ink-2">{d.marginHint}</small>
                    </label>
                    <label className="field"><span>{d.manualPrice}</span>
                      <input name="unit_price" type="number" min="0.01" step="any" className="input" aria-describedby="price-hint" />
                      <small id="price-hint" className="text-xs text-ink-2">{d.priceHint}</small>
                    </label>
                  </div>
                </ActionForm>
                {tiers.length > 0 && (
                  <ActionForm action={recalcOffer} submitLabel={d.recalc} resetOnSuccess={false}>
                    <input type="hidden" name="offer_id" value={o.id} />
                  </ActionForm>
                )}
              </div>
            )}
          </Card>

          <Card title={d.packaging} id="packaging-h">
            {packaging.length === 0 && <Empty>{d.noPackaging}</Empty>}
            {packaging.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-mist pb-3 text-sm last:border-0">
                <span className="min-w-0 flex-[1_1_220px] break-words"><span className="font-semibold">{bgName(p)}</span> <span className="text-ink-2">· {p.sku}</span></span>
                <span>{formatNumber(locale, p.qty_per_pack, 3)} {t.common.units}</span>
                {isDraft && (
                  <form action={removeOfferPackaging}>
                    <input type="hidden" name="packaging_id" value={p.id} />
                    <input type="hidden" name="offer_id" value={o.id} />
                    <button type="submit" className="btn btn-outline" aria-label={`${d.remove}: ${bgName(p)}`}>{d.remove}</button>
                  </form>
                )}
              </div>
            ))}
            {isDraft && (
              <ActionForm action={addOfferPackaging} submitLabel={d.addPackaging}>
                <input type="hidden" name="offer_id" value={o.id} />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <label className="field"><span>{d.item} *</span>
                    <select name="item_id" required className="input" defaultValue="">
                      <option value="" disabled>{d.choosePackaging}</option>
                      {packOptions.map((p) => <option key={p.id} value={p.id}>{bgName(p)} · {p.sku}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>{d.qtyPerPack}</span><input name="qty_per_pack" type="number" min="0.0001" step="any" defaultValue={1} className="input" /></label>
                </div>
              </ActionForm>
            )}
          </Card>

          {canSeeCosts && breakdownQty && (
            <Card title={d.breakdown} id="breakdown-h">
              <p className="m-0 text-sm text-ink-2">{fmt(d.breakdownFor, { qty: formatNumber(locale, breakdownQty) })}</p>
              {KINDS.map((k) => {
                const lines = breakdown.filter((b) => b.kind === k);
                if (lines.length === 0) return null;
                const sum = lines.reduce((s, b) => s + Number(b.cost_per_pack ?? 0), 0);
                return (
                  <div key={k} className="flex flex-col gap-1.5 border-b border-mist pb-3 text-sm last:border-0">
                    <div className="flex flex-wrap justify-between gap-2 font-semibold"><span>{d.kinds[k]}</span><span>{money(sum, 4)}</span></div>
                    {lines.filter((b) => b.name).map((b, i) => (
                      <div key={i} className="flex flex-wrap justify-between gap-x-3 text-ink-2">
                        <span className="min-w-0 flex-[1_1_200px] break-words">
                          {bgName(b)} · {b.qty_per_pack ? formatQty(locale, Number(b.qty_per_pack).toPrecision(4), b.base_unit ?? "") : ""} × {b.unit_price ? money(b.unit_price, 4) : <span className="font-semibold text-red-ink">{d.noPrice}</span>}
                        </span>
                        <span>{money(b.cost_per_pack, 4)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {(o.status === "sent" || o.status === "accepted") && tiers.length > 0 && (
            <Card title={oc.title} id="order-h">
              {orders.length > 0 && (
                <div className="flex flex-col gap-1 text-sm">
                  <span className="label">{oc.existing}</span>
                  {orders.map((x) => (
                    <Link key={x.id} href={`/orders/${x.id}`} className="text-ink">
                      {x.code} · {formatNumber(locale, x.quantity)} · {t.enums.orderStatus[x.status as "draft"]}
                    </Link>
                  ))}
                </div>
              )}
              {o.project_id ? (
                <ActionForm action={createOrderFromOffer} submitLabel={oc.submit} resetOnSuccess={false}>
                  <input type="hidden" name="offer_id" value={o.id} />
                  <label className="field"><span>{oc.quantity} *</span>
                    <select name="quantity" required className="input" defaultValue={tiers[0].quantity}>
                      {tiers.filter((x) => x.unit_price).map((x) => (
                        <option key={x.id} value={x.quantity}>{formatNumber(locale, x.quantity)} × {money(x.unit_price)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field"><span>{oc.customerRef}</span><input name="customer_ref" className="input" /></label>
                  <label className="field"><span>{oc.requested}</span><input name="requested_date" type="date" className="input" /></label>
                </ActionForm>
              ) : (
                <p className="m-0 text-sm text-ink-2">{oc.needsProject}</p>
              )}
            </Card>
          )}
          <Card title={d.setStatus} id="status-h">
            {!isDraft && <p className="m-0 text-sm text-ink-2">{d.lockedNote}</p>}
            <ActionForm action={setOfferStatus} submitLabel={t.common.save} resetOnSuccess={false}>
              <input type="hidden" name="offer_id" value={o.id} />
              <label className="field"><span className="sr-only">{t.offers.status}</span>
                <select name="status" defaultValue={o.status} className="input" aria-label={t.offers.status}>
                  {STATUSES.map((s) => <option key={s} value={s}>{t.enums.offerStatus[s]}</option>)}
                </select>
              </label>
            </ActionForm>
          </Card>

          <Card title={d.terms} id="terms-h">
            <ActionForm action={saveOfferTerms} submitLabel={t.common.save} resetOnSuccess={false}>
              <input type="hidden" name="offer_id" value={o.id} />
              <fieldset disabled={!isDraft} className="m-0 grid grid-cols-1 gap-3 border-0 p-0">
                <label className="field"><span>{t.orders.detail.project}</span>
                  <select name="project_id" defaultValue={o.project_id ?? ""} className="input">
                    <option value="">—</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                    {o.project_id && !projects.some((p) => p.id === o.project_id) && <option value={o.project_id}>{o.project_code}</option>}
                  </select>
                </label>
                <label className="field"><span>{t.offers.validUntil}</span><input name="valid_until" type="date" defaultValue={o.valid_until ?? ""} className="input" /></label>
                <label className="field"><span>{d.incoterm}</span><input name="incoterm" defaultValue={o.incoterm} className="input" /></label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="field"><span>{d.deposit}</span><input name="deposit_pct" type="number" min={0} max={100} step="any" defaultValue={o.deposit_pct ?? ""} className="input" /></label>
                  <label className="field"><span>{d.netDays}</span><input name="balance_net_days" type="number" min={0} defaultValue={o.balance_net_days ?? ""} className="input" /></label>
                </div>
                <label className="field"><span>{d.balance}</span>
                  <select name="balance_terms" defaultValue={o.balance_terms ?? "before_dispatch"} className="input">
                    <option value="before_dispatch">{t.enums.balanceTermsOption.before_dispatch}</option>
                    <option value="net_days">{t.enums.balanceTermsOption.net_days}</option>
                  </select>
                </label>
                <label className="field"><span>{d.language}</span>
                  <select name="locale" defaultValue={o.locale} className="input">
                    <option value="bg">{t.enums.locale.bg}</option>
                    <option value="en">{t.enums.locale.en}</option>
                  </select>
                </label>
                <label className="field"><span>{d.notes}</span><textarea name="notes" defaultValue={o.notes ?? ""} className="input" /></label>
                <label className="field"><span>{d.internalNotes}</span><textarea name="internal_notes" defaultValue={o.internal_notes ?? ""} className="input" /></label>
              </fieldset>
            </ActionForm>
          </Card>
        </div>
      </div>
    </div>
  );
}
