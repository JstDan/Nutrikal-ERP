import Link from "next/link";
import type { ReactNode } from "react";
import { fmt, formatDate, formatNumber, formatPrice, formatQty, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { Card, Chip, Empty } from "@/components/ui";

type Num = number | string;
export type DashboardData = {
  money: {
    received: Num; awaiting_first: Num; awaiting_balance: Num; overdue: Num; other_currency: number; invoiced: Num;
    open: { id: string; code: string; client_id: string; client: string; currency: string; kind: "first" | "balance"; amount: Num; due_on: string | null; overdue: boolean | null }[];
  };
  sales: {
    orders: number; revenue: Num; avg_order: Num; offers: number; offers_won: number;
    top_clients: { client_id: string; client: string; orders: number; net: Num }[];
    top_products: { product: string; product_bg: string | null; packs: Num; net: Num }[];
  };
  stock: {
    value: Num; by_type: Record<string, Num>; no_cost: number; expiring_value: Num;
    expiring: { lot_id: string; lot_number: string; item_id: string; item_name: string; name_bg: string | null; days_left: number; quantity: Num; base_unit: string; value: Num | null }[];
  };
  purchases: {
    ordered: Num; ordered_count: number; open_value: Num; open_count: number; drafts: number; received: Num;
    open: { id: string; code: string; status: "draft" | "sent"; order_date: string; currency: string; supplier: string; total: Num; open_lines: number; age_days: number }[];
  };
};

/** A row of figure tiles (two per row on phones). */
export function Tiles({ items, label }: { items: { label: string; value: string; note?: ReactNode; tone?: "red" }[]; label: string }) {
  return (
    <div aria-label={label} className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {items.map((x) => (
        <div key={x.label} className="card flex min-w-0 flex-col gap-1 p-4 sm:p-5">
          <span className="text-xs font-semibold tracking-[1px] uppercase text-ink-2">{x.label}</span>
          <span className={`text-lg font-extrabold break-words sm:text-2xl ${x.tone === "red" ? "text-red-ink" : ""}`}>{x.value}</span>
          {x.note && <span className="text-xs text-ink-2">{x.note}</span>}
        </div>
      ))}
    </div>
  );
}

/** A dashboard part: an h2 and its content, reachable from the section links. */
export function Part({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex scroll-mt-4 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-h`} className="m-0 text-xl font-bold">{title}</h2>
        {note && <p className="m-0 text-sm text-ink-2">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** Money, sales, stock and purchases of the admin dashboard. */
export function DashboardParts({ d, locale, t }: { d: DashboardData; locale: Locale; t: Dict }) {
  const A = t.admin;
  const eur = (n: Num) => formatPrice(locale, n, "EUR", 2);
  const nm = (o: { name: string; name_bg: string | null }) => (locale === "bg" && o.name_bg ? o.name_bg : o.name);
  const M = A.money, S = A.sales, K = A.stock, P = A.purchases;
  const pct = d.sales.offers > 0 ? Math.round((d.sales.offers_won / d.sales.offers) * 100) : 0;
  const types = ["raw_material", "excipient", "packaging", "finished_good"] as const;

  return (
    <>
      <Part id="money" title={M.title} note={M.note}>
        <Tiles label={M.title} items={[
          { label: M.received, value: eur(d.money.received) },
          { label: M.invoiced, value: eur(d.money.invoiced) },
          { label: M.awaitingFirst, value: eur(d.money.awaiting_first) },
          { label: M.awaitingBalance, value: eur(d.money.awaiting_balance) },
          ...(Number(d.money.overdue) > 0 ? [{ label: M.overdue, value: eur(d.money.overdue), tone: "red" as const }] : []),
        ]} />
        <Card title={M.openTitle} id="money-open-h">
          {d.money.open.length === 0 ? <Empty>{M.noOpen}</Empty> : (
            <div>
              <div className="row hide-sm border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2 md:grid-cols-[minmax(0,1.6fr)_140px_130px_120px]">
                <span>{M.order}</span><span>{M.kind}</span><span>{M.due}</span><span className="text-right">{M.amount}</span>
              </div>
              {d.money.open.map((x) => (
                <div key={`${x.id}-${x.kind}`} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 md:grid-cols-[minmax(0,1.6fr)_140px_130px_120px]">
                  <span className="min-w-0 break-words">
                    <Link href={`/orders/${x.id}`} className="font-semibold text-ink">{x.code}</Link> · {x.client}
                    <span className="block text-xs text-ink-2 md:hidden">{x.kind === "first" ? M.kindFirst : M.kindBalance} · {x.due_on ? formatDate(locale, x.due_on) : M.noDue}</span>
                  </span>
                  <span className="hide-sm">{x.kind === "first" ? M.kindFirst : M.kindBalance}</span>
                  <span className={`hide-sm ${x.overdue ? "font-semibold text-red-ink" : ""}`}>{x.due_on ? formatDate(locale, x.due_on) : M.noDue}</span>
                  <span className={`text-right font-semibold ${x.overdue ? "text-red-ink" : ""}`}>{formatPrice(locale, x.amount, x.currency, 2)}</span>
                </div>
              ))}
            </div>
          )}
          {d.money.other_currency > 0 && <p className="m-0 text-xs text-ink-2">{fmt(M.otherCurrency, { n: d.money.other_currency })}</p>}
        </Card>
      </Part>

      <Part id="sales" title={S.title} note={S.note}>
        <Tiles label={S.title} items={[
          { label: S.orders, value: formatNumber(locale, d.sales.orders) },
          { label: S.revenue, value: eur(d.sales.revenue) },
          { label: S.avgOrder, value: d.sales.orders ? eur(d.sales.avg_order) : "—" },
          { label: S.conversion, value: d.sales.offers ? fmt(S.conversionValue, { won: d.sales.offers_won, offers: d.sales.offers, pct }) : "—" },
        ]} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title={S.topClients} id="top-clients-h">
            {d.sales.top_clients.length === 0 ? <Empty>{S.noSales}</Empty> : d.sales.top_clients.map((c) => (
              <div key={c.client_id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-mist pb-2 text-sm last:border-0 last:pb-0">
                <span className="min-w-0 break-words"><Link href={`/clients/${c.client_id}`} className="font-semibold text-ink">{c.client}</Link>
                  <span className="text-xs text-ink-2"> · {fmt(S.ordersN, { n: c.orders })}</span></span>
                <span className="font-semibold">{eur(c.net)}</span>
              </div>
            ))}
          </Card>
          <Card title={S.topProducts} id="top-products-h">
            {d.sales.top_products.length === 0 ? <Empty>{S.noSales}</Empty> : d.sales.top_products.map((p, i) => (
              <div key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-mist pb-2 text-sm last:border-0 last:pb-0">
                <span className="min-w-0 break-words font-semibold">{locale === "bg" && p.product_bg ? p.product_bg : p.product}
                  <span className="text-xs font-normal text-ink-2"> · {fmt(S.packsN, { n: formatNumber(locale, p.packs) })}</span></span>
                <span className="font-semibold">{eur(p.net)}</span>
              </div>
            ))}
          </Card>
        </div>
      </Part>

      <Part id="stock" title={K.title}>
        <Tiles label={K.title} items={[
          { label: K.value, value: eur(d.stock.value), note: d.stock.no_cost > 0 ? fmt(K.noCost, { n: d.stock.no_cost }) : undefined },
          ...types.filter((x) => Number(d.stock.by_type[x] ?? 0) > 0).map((x) => ({ label: t.enums.itemType[x], value: eur(d.stock.by_type[x]) })),
          { label: K.expiringValue, value: eur(d.stock.expiring_value) },
        ]} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title={K.expiring} id="stock-exp-h">
            {d.stock.expiring.length === 0 ? <Empty>{K.noExpiring}</Empty> : d.stock.expiring.map((x) => (
              <div key={x.lot_id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-mist pb-2 text-sm last:border-0 last:pb-0">
                <span className="min-w-0 break-words">
                  <span className="font-semibold">{locale === "bg" && x.name_bg ? x.name_bg : x.item_name}</span>
                  <span className="block text-xs text-ink-2">{x.lot_number} · {formatQty(locale, x.quantity, x.base_unit)}{x.value != null ? ` · ${eur(x.value)}` : ""}</span>
                </span>
                <Chip tone={x.days_left < 0 ? "red" : x.days_left <= 30 ? "amber" : "neutral"}>{x.days_left < 0 ? K.expired : fmt(K.daysLeft, { n: x.days_left })}</Chip>
              </div>
            ))}
          </Card>
        </div>
      </Part>

      <Part id="purchases" title={P.title}>
        <Tiles label={P.title} items={[
          { label: P.ordered, value: eur(d.purchases.ordered), note: fmt(P.orderedCount, { n: d.purchases.ordered_count }) },
          { label: P.openValue, value: eur(d.purchases.open_value), note: fmt(P.openCount, { n: d.purchases.open_count }) },
          { label: P.received, value: eur(d.purchases.received) },
          { label: P.drafts, value: formatNumber(locale, d.purchases.drafts) },
        ]} />
        <Card title={P.openTitle} id="po-open-h">
          {d.purchases.open.length === 0 ? <Empty>{P.noOpen}</Empty> : (
            <div>
              <div className="row hide-sm border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2 md:grid-cols-[minmax(0,1.6fr)_150px_120px_110px]">
                <span>{t.purchaseOrders.supplier}</span><span>{P.created}</span><span className="text-right">{t.purchaseOrders.total}</span><span>{t.purchaseOrders.status}</span>
              </div>
              {d.purchases.open.map((x) => (
                <div key={x.id} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 md:grid-cols-[minmax(0,1.6fr)_150px_120px_110px]">
                  <span className="min-w-0 break-words">
                    <Link href={`/deliveries/orders/${x.id}`} className="font-semibold text-ink">{x.code}</Link> · {x.supplier}
                    {x.open_lines > 0 && <span className="block text-xs text-ink-2">{fmt(P.openLines, { n: x.open_lines })}</span>}
                    <span className="block text-xs text-ink-2 md:hidden">{P.created}: {formatDate(locale, x.order_date)} · {formatPrice(locale, x.total, x.currency, 2)}</span>
                  </span>
                  <span className="hide-sm">{formatDate(locale, x.order_date)}<span className="block text-xs text-ink-2">{fmt(P.age, { n: x.age_days })}</span></span>
                  <span className="hide-sm text-right font-semibold">{formatPrice(locale, x.total, x.currency, 2)}</span>
                  <Chip tone={x.status === "sent" ? "green" : "amber"}>{t.purchaseOrders.statuses[x.status]}</Chip>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Part>
    </>
  );
}
