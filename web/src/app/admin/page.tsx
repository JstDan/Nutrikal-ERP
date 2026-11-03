import Link from "next/link";
import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { period } from "@/lib/accounting";
import { fmt, formatDate, formatNumber, formatPrice } from "@/lib/i18n";
import { Card, Chip, Empty, PageHeader } from "@/components/ui";
import { moTone } from "@/lib/status";
import { DashboardParts, Part, Tiles, type DashboardData } from "@/components/admin-dashboard";

type Row = {
  id: string; code: string; status: string; produced_on: string | null; planned_date: string | null;
  project_code: string | null; order_id: string | null; order_code: string | null; client: string | null;
  product: string; product_bg: string | null; packs: number; is_actual: boolean;
  total_cost: string; cost_per_pack: string | null;
  estimated_lines: number; missing_prices: number; unit_price: string | null; currency: string | null;
};

const GRID = "md:grid-cols-[minmax(0,1.6fr)_80px_110px_110px] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_80px_110px_110px_80px]";

/** Admin only: money, sales, stock, purchases and production costs per batch (margin against the order's sales price). */
export default async function AdminDashboard({ searchParams }: PageProps<"/admin">) {
  const { user, locale, t } = await requireRole("admin", "bookkeeper");
  const A = t.admin;
  const sp = await searchParams;
  const { from, to } = period(sp);
  const withOpen = sp.open !== "0";
  const rows = await q<Row>(
    user.id,
    `select id, code, status, produced_on::text, planned_date::text, project_code, order_id, order_code, client, product, product_bg,
            packs, is_actual, total_cost::text, cost_per_pack::text,
            estimated_lines, missing_prices, unit_price::text, currency
       from admin_production_costs($1, $2, $3)`,
    [from, to, withOpen],
  );
  const dash = (await q<{ d: DashboardData }>(user.id, "select admin_dashboard($1, $2) as d", [from, to]))[0].d;
  const done = rows.filter((r) => r.is_actual);
  const open = rows.filter((r) => !r.is_actual);

  const sum = (xs: Row[], f: (r: Row) => number) => xs.reduce((a, r) => a + f(r), 0);
  const packs = sum(done, (r) => r.packs);
  const total = sum(done, (r) => Number(r.total_cost));
  const priced = done.filter((r) => r.unit_price != null && r.currency === "EUR");
  const revenue = sum(priced, (r) => Number(r.unit_price) * r.packs);
  const pricedCost = sum(priced, (r) => Number(r.total_cost));
  const money = (n: number | string) => formatPrice(locale, n, "EUR", 2);
  const margin = (r: Row) =>
    r.unit_price != null && r.currency === "EUR" && r.cost_per_pack != null && Number(r.unit_price) > 0
      ? ((Number(r.unit_price) - Number(r.cost_per_pack)) / Number(r.unit_price)) * 100
      : null;

  const tiles = [
    { label: A.batches, value: formatNumber(locale, done.length) },
    { label: A.packs, value: formatNumber(locale, packs) },
    { label: A.total, value: money(total) },
    { label: A.avgPerPack, value: packs > 0 ? formatPrice(locale, total / packs, "EUR", 4) : "—" },
    { label: A.revenue, value: priced.length ? money(revenue) : "—" },
    { label: A.margin, value: revenue > 0 ? `${money(revenue - pricedCost)} · ${formatNumber(locale, ((revenue - pricedCost) / revenue) * 100, 1)} %` : "—" },
  ];

  const list = (xs: Row[]) => (
    <div>
      <div className={`row hide-sm border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${GRID}`}>
        <span>{A.batch}</span><span className="hide-md">{A.client}</span><span>{t.production.quantity}</span>
        <span className="text-right">{A.total}</span><span className="text-right">{A.perPack}</span><span className="hide-md text-right">{A.marginPct}</span>
      </div>
      {xs.map((r) => {
        const m = margin(r);
        const flagged = r.estimated_lines + r.missing_prices;
        return (
          <Link key={r.id} href={`/admin/costs/${r.id}`}
            className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm text-ink no-underline last:border-0 hover:bg-canvas ${GRID}`}>
            <span className="min-w-0 break-words">
              <span className="font-semibold">{r.code}</span> · {locale === "bg" && r.product_bg ? r.product_bg : r.product}
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
                {!r.is_actual && <Chip tone={moTone(r.status)}>{t.enums.moStatus[r.status as "scheduled"]}</Chip>}
                <span>{formatDate(locale, r.produced_on ?? r.planned_date) || "—"}</span>
                {r.project_code && <span>{r.project_code}</span>}
                {r.client && <span className="lg:hidden">{r.client}</span>}
                {flagged > 0 && <span className="text-amber-ink">{fmt(A.flagged, { n: flagged })}</span>}
                <span className="md:hidden">{formatNumber(locale, r.packs)} {t.common.units}</span>
              </span>
            </span>
            <span className="hide-md min-w-0 break-words">{r.client ?? "—"}</span>
            <span className="hide-sm">{formatNumber(locale, r.packs)}</span>
            <span className="hide-sm text-right">{money(r.total_cost)}</span>
            <span className="text-right font-semibold">
              {r.cost_per_pack != null ? formatPrice(locale, r.cost_per_pack, "EUR", 4) : "—"}
              <span className="block text-xs font-normal text-ink-2 md:hidden">{money(r.total_cost)}</span>
            </span>
            <span className={`hide-md text-right font-semibold ${m != null && m < 0 ? "text-red-ink" : ""}`}>{m != null ? `${formatNumber(locale, m, 1)} %` : "—"}</span>
          </Link>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={A.title} subtitle={A.subtitle} />
      <nav aria-label={A.sections} className="flex flex-wrap gap-2">
        {([["money", A.tabMoney], ["sales", A.tabSales], ["stock", A.tabStock], ["purchases", A.tabPurchases], ["costs", A.tabCosts]] as const).map(([id, label]) => (
          <a key={id} href={`#${id}`} className="btn btn-outline">{label}</a>
        ))}
      </nav>
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-4">
          <label className="field min-w-0 flex-[1_1_160px]"><span>{A.from}</span><input name="from" type="date" defaultValue={from} required className="input" /></label>
          <label className="field min-w-0 flex-[1_1_160px]"><span>{A.to}</span><input name="to" type="date" defaultValue={to} required className="input" /></label>
          <input type="hidden" name="open" value="0" />
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" name="open" value="1" defaultChecked={withOpen} className="h-5 w-5 shrink-0 accent-ink" />
            {A.withOpen}
          </label>
          <button type="submit" className="btn btn-outline">{A.show}</button>
        </form>
        <p className="m-0 text-xs text-ink-2">{A.periodNote}</p>
      </Card>

      <DashboardParts d={dash} locale={locale} t={t} />

      <Part id="costs" title={A.costsTitle}>
      <Tiles label={A.costsTitle} items={tiles} />

      <Card title={A.batches} id="costs-list-h">
        <p className="m-0 text-sm text-ink-2">{A.costsNote} {A.marginNote}</p>
        {done.length === 0 ? <Empty>{A.noCompleted}</Empty> : list(done)}
      </Card>

      {withOpen && (
        <Card title={A.openTitle} id="open-h">
          <p className="m-0 text-sm text-ink-2">{A.openNote}</p>
          {open.length === 0 ? <Empty>{A.noOpen}</Empty> : list(open)}
        </Card>
      )}
      </Part>
    </div>
  );
}
