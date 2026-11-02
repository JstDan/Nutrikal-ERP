import { q } from "@/lib/db/engine";
import { fmt, formatDate, formatNumber, formatPrice, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { ActionForm } from "@/components/action-form";
import { Fold } from "@/components/ui";
import {
  correctOrderAddOffer, correctOrderAddService, correctOrderClient, correctOrderLine, correctOrderRemoveLine, correctOrderTerms,
} from "@/app/actions";

type Line = { id: string; kind: string; product: string; quantity: number; unit_price: string };
type Offer = { id: string; offer_no: string; product_name: string | null };
type Client = { id: string; legal_name: string };
type Correction = { id: string; kind: string; detail: Record<string, unknown>; reason: string; created_at: string; author: string | null };

/**
 * Corrections of an order until it goes to production (owner, Nov 2026): lines, VAT and balance, client and currency.
 * Admin and Sales; the database checks every rule and keeps the history with the reason (correct_order_*).
 */
export async function OrderCorrections({ orderId, clientId, currency, vatPct, balanceTerms, balanceNetDays, userId, locale, t }: {
  orderId: string; clientId: string; currency: string; vatPct: string | null;
  balanceTerms: "before_dispatch" | "net_days" | null; balanceNetDays: number | null;
  userId: string; locale: Locale; t: Dict;
}) {
  const C = t.orders.corrections;
  const [lines, offers, clients, history] = await Promise.all([
    q<Line>(userId,
      `select id, kind, coalesce(description, '') as product, quantity, unit_price::text from sales_order_lines
        where order_id = $1 order by sort_order`, [orderId]),
    q<Offer>(userId,
      `select co.id, co.offer_no, co.product_name from calc_offers co
        where co.client_id = $1 and nullif(co.data ->> 'numberOfUnits', '') is not null
          and not exists (select 1 from sales_order_lines l join sales_orders so on so.id = l.order_id
                           where l.calc_offer_id = co.id and so.status <> 'cancelled')
        order by co.created_at desc limit 100`, [clientId]),
    q<Client>(userId, "select id, legal_name from clients order by legal_name"),
    q<Correction>(userId,
      `select c.id, c.kind, c.detail, c.reason, c.created_at::text, p.full_name as author
         from order_corrections c left join profiles p on p.id = c.created_by
        where c.order_id = $1 order by c.created_at desc`, [orderId]),
  ]);
  const money = (n: string | number) => formatPrice(locale, n, currency);
  const reason = <label className="field"><span>{C.reason}</span><input name="reason" required className="input" /></label>;
  const hidden = <input type="hidden" name="order_id" value={orderId} />;
  const pair = (v: unknown) => (Array.isArray(v) && v.length === 2 && String(v[0]) !== String(v[1]) ? `${v[0] ?? "—"} → ${v[1] ?? "—"}` : null);
  const describe = (c: Correction) => {
    const x = c.detail;
    const parts = [
      typeof x.product === "string" && x.product ? x.product : null,
      typeof x.offer_no === "string" ? x.offer_no : null,
      pair(x.client), pair(x.currency),
      pair(x.quantity) ? `${C.quantity}: ${pair(x.quantity)}` : typeof x.quantity === "number" ? `${C.quantity}: ${formatNumber(locale, x.quantity)}` : null,
      pair(x.unit_price) ? `${C.unitPrice}: ${pair(x.unit_price)}` : typeof x.unit_price === "number" ? `${C.unitPrice}: ${money(x.unit_price)}` : null,
      pair(x.vat_pct) ? `${C.vatChange}: ${pair(x.vat_pct)}` : null,
      pair(x.balance_terms), pair(x.balance_net_days),
      typeof x.mos_cancelled === "number" && x.mos_cancelled > 0 ? fmt(C.cancelledBatches, { n: x.mos_cancelled }) : null,
    ];
    return parts.filter(Boolean).join(" · ");
  };

  return (
    <Fold title={C.title} note={C.note}>
      <p className="m-0 text-sm text-ink-2">{C.intro}</p>

      <h3 className="m-0 text-base font-bold">{C.lines}</h3>
      {lines.map((l) => (
        <div key={l.id} className="flex flex-col gap-3 rounded-sm border border-line p-3">
          <div className="font-semibold break-words">{l.product}</div>
          <ActionForm action={correctOrderLine} submitLabel={C.save} resetOnSuccess={false}>
            {hidden}
            <input type="hidden" name="line_id" value={l.id} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="field"><span>{C.quantity}</span>
                <input name="quantity" type="number" min={1} step={1} inputMode="numeric" required defaultValue={l.quantity} className="input" />
              </label>
              <label className="field"><span>{C.unitPrice} ({currency})</span>
                <input name="unit_price" type="number" min={0} step="any" inputMode="decimal" required defaultValue={Number(l.unit_price)} className="input" />
              </label>
            </div>
            {reason}
          </ActionForm>
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{fmt(C.removeTitle, { name: l.product })}</summary>
            <ActionForm action={correctOrderRemoveLine} submitLabel={C.remove}>
              {hidden}
              <input type="hidden" name="line_id" value={l.id} />
              {reason}
            </ActionForm>
          </details>
        </div>
      ))}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="m-0 text-base font-bold">{C.addOffer}</h3>
          <p className="m-0 text-[13px] text-ink-2">{C.addOfferNote}</p>
          {offers.length === 0 ? <p className="m-0 text-sm text-ink-2">{C.noOffers}</p> : (
            <ActionForm action={correctOrderAddOffer} submitLabel={C.add}>
              {hidden}
              <label className="field"><span>{C.chooseOffer}</span>
                <select name="offer_id" required className="input" defaultValue="">
                  <option value="" disabled>—</option>
                  {offers.map((o) => <option key={o.id} value={o.id}>{o.offer_no}{o.product_name ? ` · ${o.product_name}` : ""}</option>)}
                </select>
              </label>
              {reason}
            </ActionForm>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="m-0 text-base font-bold">{C.addService}</h3>
          <ActionForm action={correctOrderAddService} submitLabel={C.add}>
            {hidden}
            <label className="field"><span>{C.description}</span><input name="description" required className="input" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="field"><span>{C.quantity}</span><input name="quantity" type="number" min={1} step={1} defaultValue={1} required className="input" /></label>
              <label className="field"><span>{C.unitPrice} ({currency})</span><input name="unit_price" type="number" min={0} step="any" inputMode="decimal" required className="input" /></label>
            </div>
            {reason}
          </ActionForm>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="m-0 text-base font-bold">{C.terms}</h3>
          <ActionForm action={correctOrderTerms} submitLabel={C.save} resetOnSuccess={false}>
            {hidden}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="field"><span>{C.vat}</span>
                <input name="vat_pct" type="number" min={0} max={100} step="any" required defaultValue={vatPct ?? ""} className="input" />
              </label>
              <label className="field"><span>{C.balance}</span>
                <select name="balance_terms" required defaultValue={balanceTerms ?? "before_dispatch"} className="input">
                  {(["before_dispatch", "net_days"] as const).map((b) => <option key={b} value={b}>{t.enums.balanceTermsOption[b]}</option>)}
                </select>
              </label>
              <label className="field"><span>{C.netDays}</span>
                <input name="balance_net_days" type="number" min={1} step={1} defaultValue={balanceNetDays ?? ""} className="input" />
              </label>
            </div>
            {reason}
          </ActionForm>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="m-0 text-base font-bold">{C.client}</h3>
          <p className="m-0 text-[13px] text-ink-2">{C.clientNote}</p>
          <ActionForm action={correctOrderClient} submitLabel={C.save} resetOnSuccess={false}>
            {hidden}
            <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
              <label className="field"><span>{C.chooseClient}</span>
                <select name="client_id" required defaultValue={clientId} className="input">
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}
                </select>
              </label>
              <label className="field"><span>{C.currency}</span>
                <input name="currency" required maxLength={3} defaultValue={currency} className="input uppercase" />
              </label>
            </div>
            {reason}
          </ActionForm>
        </div>
      </div>

      <h3 className="m-0 text-base font-bold">{C.history}</h3>
      {history.length === 0 ? <p className="m-0 text-sm text-ink-2">{C.noHistory}</p> : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {history.map((c) => (
            <li key={c.id} className="flex flex-col gap-0.5 border-b border-mist pb-2 text-sm last:border-0">
              <span className="font-semibold">{C.kinds[c.kind as "line"] ?? c.kind}{describe(c) ? ` · ${describe(c)}` : ""}</span>
              <span className="break-words">{c.reason}</span>
              <span className="text-xs text-ink-2">{fmt(C.by, { date: formatDate(locale, c.created_at.slice(0, 10)), name: c.author ?? "—" })}</span>
            </li>
          ))}
        </ul>
      )}
    </Fold>
  );
}
