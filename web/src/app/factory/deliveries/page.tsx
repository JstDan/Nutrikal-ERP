import Link from "next/link";
import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { formatDate, formatQty } from "@/lib/i18n";
import { Chip, Empty, PageHeader } from "@/components/ui";

type Row = {
  id: string; code: string; name: string; name_bg: string | null; base_unit: string; supplier: string | null; quantity: string;
  received: string; expected_on: string | null; status: string; is_overdue: boolean; is_partial: boolean; attachments: number;
};

/** Deliveries Nutrikal ordered to the production locations: Ordered -> Received. */
export default async function FactoryDeliveriesPage() {
  const { user, locale, t } = await requireRole("production", "admin");
  const D = t.factory.deliveries;
  const rows = await q<Row>(user.id,
    `select id, code, name, name_bg, base_unit, supplier, quantity::text, received::text, expected_on::text, status, is_overdue, is_partial, attachments
       from production_deliveries order by status = 'received', expected_on nulls last, code desc limit 200`);
  const nm = (o: { name: string; name_bg: string | null }) => (locale === "bg" && o.name_bg ? o.name_bg : o.name);
  const grid = "md:grid-cols-[minmax(0,1.6fr)_110px_120px_120px_130px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={D.title} subtitle={D.subtitle} />
      <section aria-label={D.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`}>
          <span>{t.inventory.item}</span><span>{D.expected}</span><span className="text-right">{D.ordered}</span>
          <span className="text-right">{D.received}</span><span>{t.deliveries.status}</span>
        </div>
        {rows.length === 0 && <div className="py-4"><Empty>{D.empty}</Empty></div>}
        {rows.map((r) => (
          <div key={r.id} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3.5 text-sm last:border-0 ${grid}`}>
            <div className="min-w-0">
              <Link href={`/factory/deliveries/${r.id}`} className="font-semibold break-words text-ink">{nm(r)}</Link>
              <div className="text-xs text-ink-2">
                {r.code}{r.supplier ? ` · ${r.supplier}` : ""}
                <span className="md:hidden"> · {formatDate(locale, r.expected_on)} · {formatQty(locale, r.quantity, r.base_unit)}</span>
              </div>
            </div>
            <span className={`hide-sm ${r.is_overdue ? "font-semibold text-red-ink" : ""}`}>{formatDate(locale, r.expected_on)}</span>
            <span className="hide-sm text-right">{formatQty(locale, r.quantity, r.base_unit)}</span>
            <span className="hide-sm text-right">{formatQty(locale, r.received, r.base_unit)}</span>
            <Chip tone={r.status === "received" ? "green" : r.is_overdue ? "red" : r.is_partial ? "amber" : "neutral"}>
              {r.is_partial && r.status === "open" ? t.deliveries.partial : t.enums.productionDeliveryStatus[r.status as "open"]}
            </Chip>
          </div>
        ))}
      </section>
    </div>
  );
}
