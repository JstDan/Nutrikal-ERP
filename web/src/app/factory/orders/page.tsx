import Link from "next/link";
import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { formatDate, formatNumber } from "@/lib/i18n";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { moTone } from "@/lib/status";

type Row = {
  id: string; code: string; project_code: string; product: string; product_bg: string | null; product_format: string;
  quantity: number; planned_date: string | null; status: string; batch_number: string | null;
};

export default async function FactoryOrdersPage() {
  const { user, locale, t } = await requireRole("production", "admin");
  const P = t.production;
  const rows = await q<Row>(
    user.id,
    `select id, code, project_code, product, product_bg, product_format, quantity, planned_date::text, status, batch_number
       from production_manufacturing_orders
      order by status = 'completed', planned_date nulls last, code`,
  );
  const grid = "md:grid-cols-[110px_minmax(0,1.4fr)_110px_170px] xl:grid-cols-[110px_minmax(0,1.4fr)_110px_100px_110px_120px_170px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.factory.orders.title} subtitle={t.factory.orders.subtitle} />
      <section aria-label={t.factory.orders.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`}>
          <span>{P.code}</span><span>{P.product}</span><span>{P.planned}</span>
          <span className="hidden xl:block">{P.quantity}</span><span className="hidden xl:block">{P.project}</span>
          <span className="hidden xl:block">{P.detail.batchNumber}</span><span>{P.status}</span>
        </div>
        {rows.length === 0 && <div className="py-4"><Empty>{t.factory.noOrders}</Empty></div>}
        {rows.map((m) => (
          <div key={m.id} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3.5 text-sm last:border-0 ${grid}`}>
            <div className="min-w-0 md:contents">
              <Link href={`/factory/orders/${m.id}`} className="font-semibold text-ink">{m.code}</Link>
              <span className="block min-w-0 break-words md:inline">
                {locale === "bg" && m.product_bg ? m.product_bg : m.product}
                <span className="block text-xs text-ink-2">{t.enums.productFormat[m.product_format as "capsule"]}</span>
              </span>
            </div>
            <span className="hide-sm">{formatDate(locale, m.planned_date)}</span>
            <span className="hidden xl:block">{formatNumber(locale, m.quantity)}</span>
            <span className="hidden xl:block">{m.project_code}</span>
            <span className="hidden xl:block">{m.batch_number ?? "—"}</span>
            <Chip tone={moTone(m.status)}>{t.enums.moStatus[m.status as "released"]}</Chip>
          </div>
        ))}
      </section>
    </div>
  );
}
