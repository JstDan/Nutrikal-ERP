import Link from "next/link";
import { Card, Chip, Empty, PageHeader } from "@/components/ui";
import { DocumentList } from "@/components/portal-parts";
import { fmt, formatPrice } from "@/lib/i18n";
import { portalDocuments, portalInvoices, portalOrders } from "@/lib/portal";
import { getPortalSession } from "@/lib/session";
import { orderTone } from "@/lib/status";

const DONE = ["closed", "cancelled"];
const RECENT = 5;

export default async function PortalHome() {
  const { user, locale, t } = await getPortalSession();
  const P = t.portal;
  const [orders, invoices, documents] = await Promise.all([portalOrders(user.id), portalInvoices(user.id), portalDocuments(user.id)]);
  const active = orders.filter((o) => !DONE.includes(o.status));
  const due = new Map<string, number>();
  for (const i of invoices) if (Number(i.open_amount ?? 0) > 0) due.set(i.currency, (due.get(i.currency) ?? 0) + Number(i.open_amount));

  return (
    <>
      <PageHeader title={fmt(P.welcome, { name: user.name })} />
      {due.size > 0 && (
        <Card title={P.home.openBalance} action={<Link href="/portal/invoices" className="text-sm">{P.home.viewAll}</Link>}>
          {[...due].map(([currency, amount]) => <p key={currency} className="m-0 text-xl font-semibold">{formatPrice(locale, amount, currency)}</p>)}
        </Card>
      )}
      <Card title={P.home.activeOrders} action={<Link href="/portal/orders" className="text-sm">{P.home.viewAll}</Link>}>
        {active.length === 0 && <Empty>{P.home.noOrders}</Empty>}
        {active.map((o) => (
          <Link key={o.id} href={`/portal/orders/${o.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-mist py-1.5 text-sm text-ink no-underline last:border-0 hover:underline">
            <span className="min-w-0 font-semibold break-words">{o.code}{o.customer_ref ? ` · ${o.customer_ref}` : ""}</span>
            <span className="flex items-center gap-2">
              {o.unread > 0 && <span className="text-xs">{fmt(P.home.unread, { n: o.unread })}</span>}
              <Chip tone={orderTone(o.status)}>{t.enums.orderStatus[o.status as keyof typeof t.enums.orderStatus]}</Chip>
            </span>
          </Link>
        ))}
      </Card>
      <Card title={P.home.recentDocuments} action={<Link href="/portal/documents" className="text-sm">{P.home.viewAll}</Link>}>
        <DocumentList rows={documents.slice(0, RECENT)} showOrder locale={locale} t={t} />
      </Card>
    </>
  );
}
