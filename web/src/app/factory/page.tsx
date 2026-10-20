import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { formatDate, formatNumber, formatQty } from "@/lib/i18n";
import { Card, Chip, Empty, PageHeader } from "@/components/ui";
import { moTone } from "@/lib/status";

type Mo = { id: string; code: string; project_code: string; product: string; product_bg: string | null; quantity: number; planned_date: string | null; status: string };
type Delivery = { id: string; code: string; name: string; name_bg: string | null; base_unit: string; supplier: string | null; remaining: string; expected_on: string | null; is_overdue: boolean };

export default async function FactoryToday() {
  const { user, locale, t } = await requireRole("production", "admin");
  const F = t.factory;

  const data = await withUser(user.id, async (tx) => ({
    orders: (await tx.query<Mo>(
      `select id, code, project_code, product, product_bg, quantity, planned_date::text, status from production_manufacturing_orders
        where status in ('released', 'in_production') order by status desc, planned_date nulls last, code`)).rows,
    deliveries: (await tx.query<Delivery>(
      `select id, code, name, name_bg, base_unit, supplier, remaining::text, expected_on::text, is_overdue from production_deliveries
        where status = 'open' order by expected_on nulls last, code limit 8`)).rows,
  }));
  const nm = (o: { name: string; name_bg: string | null }) => (locale === "bg" && o.name_bg ? o.name_bg : o.name);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={F.title} subtitle={`${formatDate(locale, new Date(), { weekday: "long", day: "numeric", month: "long" })} · ${F.subtitle}`} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card title={F.active} id="orders-h" action={<Link href="/factory/orders" className="text-sm text-ink">{F.allOrders}</Link>}>
          {data.orders.length === 0 && <Empty>{F.noOrders}</Empty>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.orders.map((m) => (
              <Link key={m.id} href={`/factory/orders/${m.id}`} className={`flex flex-col gap-2 rounded border p-4 text-ink no-underline ${m.status === "in_production" ? "border-2 border-green" : "border-line"}`}>
                <span className="text-lg font-bold">{m.code} · {m.project_code}</span>
                <span className="text-sm text-ink-2">{locale === "bg" && m.product_bg ? m.product_bg : m.product} · {formatNumber(locale, m.quantity)} {t.common.units} · {formatDate(locale, m.planned_date)}</span>
                <Chip tone={moTone(m.status)}>{t.enums.moStatus[m.status as "released"]}</Chip>
              </Link>
            ))}
          </div>
        </Card>

        <Card title={F.incoming} id="deliveries-h" action={<Link href="/factory/deliveries" className="text-sm text-ink">{F.allDeliveries}</Link>}>
          {data.deliveries.length === 0 && <Empty>{F.noIncoming}</Empty>}
          {data.deliveries.map((d) => (
            <Link key={d.id} href={`/factory/deliveries/${d.id}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-mist pb-3 text-sm text-ink no-underline last:border-0">
              <span className="min-w-0 flex-[1_1_180px]">
                <span className="font-semibold break-words">{nm(d)}</span>
                <span className="block text-xs text-ink-2">{d.code}{d.supplier ? ` · ${d.supplier}` : ""}</span>
              </span>
              <span className="text-right">
                {formatQty(locale, d.remaining, d.base_unit)}
                <span className={`block text-xs ${d.is_overdue ? "font-semibold text-red-ink" : "text-ink-2"}`}>{formatDate(locale, d.expected_on)}</span>
              </span>
            </Link>
          ))}
        </Card>
      </div>
    </div>
  );
}
