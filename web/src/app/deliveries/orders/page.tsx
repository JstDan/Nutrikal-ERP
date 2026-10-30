import Link from "next/link";
import { q } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { formatDate, formatPrice, formatQty } from "@/lib/i18n";
import { Card, Chip, Empty, PageHeader, type Tone } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { SearchSelect } from "@/components/search-select";
import { createPurchaseOrder } from "@/app/purchase-order-actions";

type Line = { name: string; name_bg: string | null; quantity: string; unit: string };
type Row = {
  id: string; code: string; status: "draft" | "sent" | "cancelled"; supplier: string; order_date: string;
  lines: Line[]; total: string | null; currency: string;
};

const poTone = (s: string): Tone => (s === "sent" ? "green" : s === "draft" ? "amber" : "neutral");

/** Purchase orders (admin and users who see purchase prices; others get none by RLS). */
export default async function PurchaseOrdersPage() {
  const { user, locale, t } = await requireStaff();
  const P = t.purchaseOrders;
  const rows = await q<Row>(
    user.id,
    `select o.id, o.code, o.status, s.name as supplier, o.order_date::text, o.currency,
            coalesce((select json_agg(json_build_object('name', i.name, 'name_bg', i.name_bg, 'quantity', l.quantity::text,
                                                        'unit', i.base_unit) order by i.name)
                        from purchase_order_lines l join items i on i.id = l.item_id
                       where l.purchase_order_id = o.id), '[]'::json) as lines,
            (select sum(l.quantity * l.unit_price)::text from purchase_order_lines l where l.purchase_order_id = o.id) as total
       from purchase_orders o join suppliers s on s.id = o.supplier_id
      order by o.status = 'draft' desc, o.order_date desc, o.code desc limit 300`,
  );
  const suppliers = user.role === "admin"
    ? await q<{ id: string; name: string }>(user.id, "select id, name from suppliers where is_active order by name")
    : [];
  const nm = (l: Line) => (locale === "bg" && l.name_bg ? l.name_bg : l.name);
  const grid = "md:grid-cols-[110px_minmax(0,1fr)_minmax(0,1.4fr)_120px_130px] lg:grid-cols-[110px_minmax(0,1fr)_minmax(0,1.4fr)_110px_120px_130px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/deliveries" className="text-ink-2">{P.back}</Link> / {P.title}</>}
        title={P.title}
        subtitle={P.subtitle}
        actions={user.role === "admin" && <a href="#new" className="btn btn-primary">{P.newOrder}</a>}
      />
      {user.role === "admin" && <p className="m-0 text-sm text-ink-2">{P.fromShortages} <Link href="/deliveries#shortages-h" className="text-ink">{P.shortages}</Link></p>}
      <section aria-label={P.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`}>
          <span>{P.code}</span><span>{P.supplier}</span><span>{P.materials}</span>
          <span className="hide-md">{P.date}</span><span className="text-right">{P.total}</span><span>{P.status}</span>
        </div>
        {rows.length === 0 && <div className="py-4"><Empty>{P.empty}</Empty></div>}
        {rows.map((r) => (
          <div key={r.id} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3.5 text-sm last:border-0 ${grid}`}>
            <div className="min-w-0 md:contents">
              <Link href={`/deliveries/orders/${r.id}`} className="font-semibold text-ink">{r.code}</Link>
              <span className="block min-w-0 break-words md:inline">{r.supplier}</span>
              {r.lines.length === 0 ? (
                <span className="block text-ink-2 md:inline">—</span>
              ) : (
                <ul className="m-0 mt-1 min-w-0 list-none p-0 text-[13px] text-ink-2 md:mt-0 md:text-sm md:text-ink">
                  {r.lines.map((l, i) => (
                    <li key={i} className="break-words">{nm(l)} · <span className="whitespace-nowrap">{formatQty(locale, l.quantity, l.unit)}</span></li>
                  ))}
                </ul>
              )}
            </div>
            <span className="hide-md">{formatDate(locale, r.order_date)}</span>
            <span className="hide-sm text-right">{r.total != null ? formatPrice(locale, r.total, r.currency) : "—"}</span>
            <Chip tone={poTone(r.status)}>{P.statuses[r.status]}</Chip>
          </div>
        ))}
      </section>

      {user.role === "admin" && (
        <Card title={P.newOrder} id="new">
          <p className="m-0 text-[13px] text-ink-2">{P.newOrderNote}</p>
          <ActionForm action={createPurchaseOrder} submitLabel={P.create}>
            <label className="field"><span>{P.supplier} *</span>
              <SearchSelect name="supplier_id" required placeholder={t.common.typeToSearch} noResults={t.common.noResults}
                options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
            </label>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
