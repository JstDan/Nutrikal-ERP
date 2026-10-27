import Link from "next/link";
import { q } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { formatDate, formatPrice } from "@/lib/i18n";
import { Chip, Empty, PageHeader, type Tone } from "@/components/ui";

type Row = {
  id: string; code: string; status: "draft" | "sent" | "cancelled"; supplier: string; order_date: string;
  lines: number; total: string | null; currency: string;
};

const poTone = (s: string): Tone => (s === "sent" ? "green" : s === "draft" ? "amber" : "neutral");

/** Purchase orders (admin and users who see purchase prices; others get none by RLS). */
export default async function PurchaseOrdersPage() {
  const { user, locale, t } = await requireStaff();
  const P = t.purchaseOrders;
  const rows = await q<Row>(
    user.id,
    `select o.id, o.code, o.status, s.name as supplier, o.order_date::text, o.currency,
            (select count(*)::int from purchase_order_lines l where l.purchase_order_id = o.id) as lines,
            (select sum(l.quantity * l.unit_price)::text from purchase_order_lines l where l.purchase_order_id = o.id) as total
       from purchase_orders o join suppliers s on s.id = o.supplier_id
      order by o.status = 'draft' desc, o.order_date desc, o.code desc limit 300`,
  );
  const grid = "md:grid-cols-[110px_minmax(0,1.6fr)_110px_120px_130px] lg:grid-cols-[110px_minmax(0,1.6fr)_110px_80px_120px_130px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/deliveries" className="text-ink-2">{P.back}</Link> / {P.title}</>}
        title={P.title}
        subtitle={P.subtitle}
      />
      <section aria-label={P.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`}>
          <span>{P.code}</span><span>{P.supplier}</span><span>{P.date}</span>
          <span className="hide-md">{P.lines}</span><span className="text-right">{P.total}</span><span>{P.status}</span>
        </div>
        {rows.length === 0 && <div className="py-4"><Empty>{P.empty}</Empty></div>}
        {rows.map((r) => (
          <div key={r.id} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3.5 text-sm last:border-0 ${grid}`}>
            <div className="min-w-0 md:contents">
              <Link href={`/deliveries/orders/${r.id}`} className="font-semibold text-ink">{r.code}</Link>
              <span className="block min-w-0 break-words md:inline">{r.supplier}</span>
            </div>
            <span className="hide-sm">{formatDate(locale, r.order_date)}</span>
            <span className="hide-md">{r.lines}</span>
            <span className="hide-sm text-right">{r.total != null ? formatPrice(locale, r.total, r.currency) : "—"}</span>
            <Chip tone={poTone(r.status)}>{P.statuses[r.status]}</Chip>
          </div>
        ))}
      </section>
    </div>
  );
}
