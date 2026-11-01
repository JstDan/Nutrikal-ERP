import Link from "next/link";
import { Card, Chip, Empty, PageHeader } from "@/components/ui";
import { formatDate, formatPrice } from "@/lib/i18n";
import { portalOrders } from "@/lib/portal";
import { getPortalSession } from "@/lib/session";
import { orderTone } from "@/lib/status";

export default async function PortalOrders() {
  const { user, locale, t } = await getPortalSession();
  const P = t.portal;
  const orders = await portalOrders(user.id);
  return (
    <>
      <PageHeader title={P.nav.orders} />
      <Card>
        {orders.length === 0 && <Empty>{P.home.noOrders}</Empty>}
        {orders.map((o) => (
          <Link key={o.id} href={`/portal/orders/${o.id}`} className="grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-mist py-2 text-sm text-ink no-underline last:border-0 hover:underline">
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold break-words">{o.code}{o.customer_ref ? ` · ${o.customer_ref}` : ""}</span>
              <span className="text-xs text-ink-2">{formatDate(locale, o.created_at.slice(0, 10))} · {formatPrice(locale, Number(o.value), o.currency)}</span>
            </span>
            <Chip tone={orderTone(o.status)}>{t.enums.orderStatus[o.status as keyof typeof t.enums.orderStatus]}</Chip>
          </Link>
        ))}
      </Card>
    </>
  );
}
