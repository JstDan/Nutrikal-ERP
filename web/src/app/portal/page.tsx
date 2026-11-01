import Link from "next/link";
import { Chip, Empty } from "@/components/ui";
import { DocumentList, OrderBar, Panel } from "@/components/portal-parts";
import { fmt, formatPrice } from "@/lib/i18n";
import { portalDocuments, portalInvoices, portalOrders } from "@/lib/portal";
import { getPortalSession } from "@/lib/session";
import { orderTone } from "@/lib/status";

const DONE = ["closed", "cancelled"];
const RECENT = 5;
const LATEST_ORDERS = 4;

export default async function PortalHome() {
  const { user, locale, t, unread } = await getPortalSession();
  const P = t.portal;
  const [orders, invoices, documents] = await Promise.all([portalOrders(user.id), portalInvoices(user.id), portalDocuments(user.id)]);
  const active = orders.filter((o) => !DONE.includes(o.status));
  const due = new Map<string, number>();
  for (const i of invoices) if (Number(i.open_amount ?? 0) > 0) due.set(i.currency, (due.get(i.currency) ?? 0) + Number(i.open_amount));
  const balance = [...due].map(([currency, amount]) => formatPrice(locale, amount, currency)).join(" · ") || formatPrice(locale, 0, orders[0]?.currency ?? "EUR");

  const onOrders = new Map<string, number>();
  for (const o of orders) if (Number(o.due) > 0) onOrders.set(o.currency, (onOrders.get(o.currency) ?? 0) + Number(o.due));
  const dueText = [...onOrders].map(([currency, amount]) => formatPrice(locale, amount, currency)).join(" · ");

  const tiles: { href: string; label: string; value: string | number; note?: string }[] = [
    { href: "/portal/orders", label: P.tiles.orders, value: active.length },
    { href: "/portal/invoices", label: P.tiles.balance, value: balance, note: dueText ? fmt(P.tiles.onOrders, { amount: dueText }) : undefined },
    { href: "/portal/documents", label: P.tiles.documents, value: documents.length },
    { href: "/portal/support", label: P.tiles.messages, value: await unread() },
  ];

  return (
    <>
      <section className="p-hero p-in">
        <h1 className="m-0 text-2xl font-bold sm:text-3xl">{fmt(P.welcome, { name: user.name })}</h1>
        <p className="m-0 mt-1 text-[#dfe3ea]">{P.lead}</p>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x, i) => (
          <Link key={x.href} href={x.href} style={{ animationDelay: `${(i + 1) * 60}ms` }} className="p-tile p-in">
            <span className="text-xs text-ink-2">{x.label}</span>
            <span className="text-xl font-bold break-words">{x.value}</span>
            {x.note && <span className="text-xs text-ink-2">{x.note}</span>}
          </Link>
        ))}
      </div>

      <Panel title={P.home.activeOrders} action={<Link href="/portal/orders" className="text-sm">{P.home.viewAll}</Link>}>
        {active.length === 0 && <Empty>{P.home.noOrders}</Empty>}
        {active.slice(0, LATEST_ORDERS).map((o) => (
          <Link key={o.id} href={`/portal/orders/${o.id}`} className="p-row flex-col !items-stretch">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 font-semibold break-words">{o.code}{o.customer_ref ? ` · ${o.customer_ref}` : ""}</span>
              <span className="flex items-center gap-2">
                {o.unread > 0 && <span className="p-count">{fmt(P.home.unread, { n: o.unread })}</span>}
                <Chip tone={orderTone(o.status)}>{P.status[o.status as keyof typeof P.status]}</Chip>
              </span>
            </span>
            <OrderBar status={o.status} />
          </Link>
        ))}
      </Panel>

      <Panel title={P.home.recentDocuments} action={<Link href="/portal/documents" className="text-sm">{P.home.viewAll}</Link>}>
        <DocumentList rows={documents.slice(0, RECENT)} showOrder locale={locale} t={t} />
      </Panel>

      <Panel title={P.help.title} action={<Link href="/portal/support" className="btn btn-primary">{P.help.write}</Link>}>
        <p className="m-0 text-sm text-ink-2">{P.help.text}</p>
      </Panel>
    </>
  );
}
