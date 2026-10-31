import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { formatDate, formatNumber, formatPrice } from "@/lib/i18n";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { orderTone } from "@/lib/status";

type Row = {
  id: string; code: string; status: string; requested_date: string | null; client: string; line_count: number; total_packs: number;
  products: string | null;
};
const STATUSES = ["unpaid", "draft", "confirmed", "in_production", "ready", "dispatched", "closed", "cancelled"] as const;

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const { user, locale, t } = await requireStaff();
  const sp = await searchParams;
  const status = typeof sp.status === "string" && (STATUSES as readonly string[]).includes(sp.status) ? sp.status : "";
  const seesPrices = user.role === "admin" || user.role === "sales";
  const name = locale === "bg" ? "coalesce(l.product_bg, l.product)" : "l.product";

  const { rows, totals } = await withUser(user.id, async (tx) => ({
    // The overviews have no prices, so Inventory can use them too
    rows: (await tx.query<Row>(
      `select o.id, o.code, o.status, o.requested_date::text, o.client, o.line_count, o.total_packs,
              (select string_agg(${name}, ', ' order by l.sort_order) from sales_order_line_overview l where l.order_id = o.id and l.kind <> 'service') as products
         from sales_order_overview o where ($1 = '' or o.status::text = $1)
        order by o.status in ('closed', 'cancelled'), o.code desc`, [status])).rows,
    totals: seesPrices
      ? (await tx.query<{ id: string; total: string; currency: string }>(
          `select o.id, coalesce(sum(l.quantity * l.unit_price), 0)::text as total, o.currency
             from sales_orders o left join sales_order_lines l on l.order_id = o.id group by o.id`)).rows
      : [],
  }));
  const total = new Map(totals.map((x) => [x.id, x]));
  const grid = "md:grid-cols-[100px_minmax(0,1fr)_minmax(0,1.2fr)_140px] xl:grid-cols-[100px_minmax(0,1fr)_minmax(0,1.2fr)_100px_120px_110px_140px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.orders.title}
        subtitle={t.orders.subtitle}
        actions={seesPrices ? (
          <span className="flex flex-wrap gap-2">
            <Link href="/orders/new" className="btn btn-primary">+ {t.orders.newOrder}</Link>
          </span>
        ) : undefined}
      />
      {seesPrices && <p className="m-0 text-sm text-ink-2">{t.orders.fromOffer} <Link href="/offers" className="text-ink">{t.nav.offers}</Link></p>}
      <nav aria-label={t.orders.status} className="flex flex-wrap gap-1">
        {(["", ...STATUSES] as const).map((s) => (
          <Link
            key={s || "all"}
            href={s ? `/orders?status=${s}` : "/orders"}
            aria-current={status === s ? "page" : undefined}
            className={`flex min-h-10 items-center rounded-full border px-3.5 text-[13px] no-underline ${status === s ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-white text-ink"}`}
          >
            {s ? t.enums.orderStatus[s] : t.common.all}
          </Link>
        ))}
      </nav>

      <section aria-label={t.orders.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`}>
          <span>{t.orders.code}</span><span>{t.orders.client}</span><span>{t.orders.products}</span>
          <span className="hide-lg">{t.orders.packs}</span><span className="hide-lg">{seesPrices ? t.orders.total : ""}</span>
          <span className="hide-lg">{t.orders.requested}</span><span>{t.orders.status}</span>
        </div>
        {rows.length === 0 && <div className="py-4"><Empty>{t.orders.empty}</Empty></div>}
        {rows.map((o) => {
          const tot = total.get(o.id);
          return (
            <div key={o.id} className={`row relative grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3.5 text-sm last:border-0 hover:bg-mist/60 ${grid}`}>
              <div className="min-w-0 md:contents">
                <Link href={`/orders/${o.id}`} className="font-semibold text-ink underline after:absolute after:inset-0 after:content-['']">{o.code}</Link>
                <span className="block min-w-0 break-words md:inline">{o.client}</span>
              </div>
              <span className="hide-sm min-w-0 break-words">{o.products ?? "—"}</span>
              <span className="hide-lg">{formatNumber(locale, o.total_packs)}</span>
              <span className="hide-lg">{tot ? formatPrice(locale, tot.total, tot.currency) : ""}</span>
              <span className="hide-lg">{formatDate(locale, o.requested_date)}</span>
              <Chip tone={orderTone(o.status)}>{t.enums.orderStatus[o.status as "draft"]}</Chip>
            </div>
          );
        })}
      </section>
    </div>
  );
}
