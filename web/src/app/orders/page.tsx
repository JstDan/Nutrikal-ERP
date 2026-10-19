import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { formatDate, formatNumber, formatPrice } from "@/lib/i18n";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { orderTone } from "@/lib/status";

type Row = {
  id: string; code: string; status: string; quantity: number; requested_date: string | null; client: string; client_id: string;
  project_code: string; product: string; product_bg: string | null;
};
const STATUSES = ["draft", "confirmed", "in_production", "ready", "dispatched", "closed", "cancelled"] as const;

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const { user, locale, t } = await requireStaff();
  const sp = await searchParams;
  const status = typeof sp.status === "string" && (STATUSES as readonly string[]).includes(sp.status) ? sp.status : "";
  const seesPrices = user.role === "admin" || user.role === "sales";

  const { rows, totals } = await withUser(user.id, async (tx) => ({
    // The overview has no prices, so Inventory can use it too
    rows: (await tx.query<Row>(
      `select id, code, status, quantity, requested_date::text, client, client_id, project_code, product, product_bg
         from sales_order_overview where ($1 = '' or status::text = $1)
        order by status in ('closed', 'cancelled'), code desc`, [status])).rows,
    totals: seesPrices
      ? (await tx.query<{ id: string; total: string; currency: string }>(
          "select id, (quantity * unit_price)::text as total, currency from sales_orders")).rows
      : [],
  }));
  const total = new Map(totals.map((x) => [x.id, x]));
  const grid = "md:grid-cols-[100px_minmax(0,1.2fr)_minmax(0,1fr)_140px] lg:grid-cols-[100px_minmax(0,1.2fr)_minmax(0,1fr)_100px_120px_110px_140px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.orders.title} subtitle={t.orders.subtitle} />
      {seesPrices && <p className="m-0 text-sm text-ink-2">{t.orders.fromOffer} <Link href="/offers?status=sent" className="text-ink">{t.nav.offers}</Link></p>}
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
          <span>{t.orders.code}</span><span>{t.orders.client}</span><span>{t.orders.product}</span>
          <span className="hide-md">{t.orders.quantity}</span><span className="hide-md">{seesPrices ? t.orders.total : ""}</span>
          <span className="hide-md">{t.orders.requested}</span><span>{t.orders.status}</span>
        </div>
        {rows.length === 0 && <div className="py-4"><Empty>{t.orders.empty}</Empty></div>}
        {rows.map((o) => {
          const tot = total.get(o.id);
          return (
            <div key={o.id} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3.5 text-sm last:border-0 ${grid}`}>
              <div className="min-w-0 md:contents">
                <Link href={`/orders/${o.id}`} className="font-semibold text-ink">{o.code}</Link>
                <span className="block min-w-0 break-words md:inline">{o.client}</span>
              </div>
              <span className="hide-sm min-w-0 break-words">{locale === "bg" && o.product_bg ? o.product_bg : o.product} <span className="text-ink-2">· {o.project_code}</span></span>
              <span className="hide-md">{formatNumber(locale, o.quantity)}</span>
              <span className="hide-md">{tot ? formatPrice(locale, tot.total, tot.currency) : ""}</span>
              <span className="hide-md">{formatDate(locale, o.requested_date)}</span>
              <Chip tone={orderTone(o.status)}>{t.enums.orderStatus[o.status as "draft"]}</Chip>
            </div>
          );
        })}
      </section>
    </div>
  );
}
