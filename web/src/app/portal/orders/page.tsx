import Link from "next/link";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { OrderBar, Panel } from "@/components/portal-parts";
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
      <Panel>
        {orders.length === 0 && <Empty>{P.home.noOrders}</Empty>}
        {orders.map((o) => (
          <Link key={o.id} href={`/portal/orders/${o.id}`} className="p-row flex-col !items-stretch">
            <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold break-words">{o.code}{o.customer_ref ? ` · ${o.customer_ref}` : ""}</span>
              <span className="text-xs text-ink-2">{formatDate(locale, o.created_at.slice(0, 10))} · {formatPrice(locale, Number(o.value), o.currency)}</span>
            </span>
            <Chip tone={orderTone(o.status)}>{P.status[o.status as keyof typeof P.status]}</Chip>
            </span>
            <OrderBar status={o.status} />
          </Link>
        ))}
      </Panel>
    </>
  );
}
