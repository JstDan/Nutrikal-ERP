import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Chip, Empty, PageHeader } from "@/components/ui";
import { DocumentList, InvoiceList, PortalThread } from "@/components/portal-parts";
import { q } from "@/lib/db/engine";
import { fmt, formatDate, formatNumber, formatPrice } from "@/lib/i18n";
import { portalDocuments, portalFeed, portalInvoices, portalMarkRead, validId, type PortalOrder } from "@/lib/portal";
import { getPortalSession } from "@/lib/session";
import { orderTone } from "@/lib/status";

const MAKING = ["in_production", "ready", "dispatched", "closed"];
const READY = ["ready", "dispatched", "closed"];
const SENT = ["dispatched", "closed"];

export default async function PortalOrderPage({ params }: PageProps<"/portal/orders/[id]">) {
  const { id } = await params;
  const { user, locale, t } = await getPortalSession();
  if (!validId(id)) notFound();
  const [row] = await q<{ d: PortalOrder | null }>(user.id, "select portal_order($1) as d", [id]);
  const o = row?.d;
  if (!o) notFound();
  const P = t.portal;
  const O = P.order;
  const money = (n: number) => formatPrice(locale, n, o.currency);
  const date = (d: string | null) => (d ? formatDate(locale, d.slice(0, 10)) : "");

  const [documents, invoices, feed] = await Promise.all([portalDocuments(user.id, id), portalInvoices(user.id), portalFeed(user.id, id)]);
  await portalMarkRead(user.id, id);

  const steps = [
    { label: P.steps.confirmed, done: !!o.confirmed_at, at: date(o.confirmed_at) },
    ...(Number(o.deposit_pct ?? 0) > 0 ? [{ label: P.steps.deposit, done: !!o.deposit_received_on, at: date(o.deposit_received_on) }] : []),
    { label: P.steps.production, done: !!o.production_started_at || MAKING.includes(o.status), at: date(o.production_started_at) },
    { label: P.steps.ready, done: READY.includes(o.status), at: "" },
    { label: P.steps.dispatched, done: SENT.includes(o.status), at: date(o.dispatched_at) },
  ];

  return (
    <>
      <PageHeader title={o.code} crumb={<Link href="/portal/orders">{P.nav.orders}</Link>}
        subtitle={o.customer_ref ? fmt(O.ref, { ref: o.customer_ref }) : undefined}
        actions={<Chip tone={orderTone(o.status)}>{t.enums.orderStatus[o.status as keyof typeof t.enums.orderStatus]}</Chip>} />

      {o.status !== "cancelled" && (
        <Card title={O.progress}>
          <ol className="m-0 grid list-none grid-cols-1 gap-2 p-0 md:grid-flow-col md:auto-cols-fr">
            {steps.map((s) => (
              <li key={s.label} className="flex min-w-0 items-center gap-2 md:flex-col md:items-start">
                <span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs ${s.done ? "bg-[#7BC74D] text-ink" : "border border-line-strong text-ink-2"}`}>{s.done ? "✓" : ""}</span>
                <span className="flex min-w-0 flex-col">
                  <span className={`text-sm ${s.done ? "font-semibold" : "text-ink-2"}`}>{s.label}</span>
                  {s.at && <span className="text-xs text-ink-2">{s.at}</span>}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card title={O.products}>
        {o.lines.map((l, i) => (
          <div key={i} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-mist py-1.5 text-sm last:border-0">
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold break-words">{l.description}</span>
              <span className="text-xs text-ink-2">{formatNumber(locale, l.quantity)} × {money(l.unit_price)}</span>
            </span>
            <span className="text-right font-semibold">{money(l.quantity * l.unit_price)}</span>
          </div>
        ))}
        <p className="m-0 flex justify-between gap-3 pt-2 text-sm font-semibold"><span>{O.value}</span><span className="text-right">{money(o.value)}</span></p>
        {o.requested_date && <p className="m-0 text-xs text-ink-2">{O.requested}: {date(o.requested_date)}</p>}
      </Card>

      {o.batches.length > 0 && (
        <Card title={O.batches}>
          {o.batches.map((b) => (
            <div key={b.lot_id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-mist py-1.5 text-sm last:border-0">
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold break-all">{b.lot_number}</span>
                <span className="text-xs text-ink-2">{[`${formatNumber(locale, b.quantity)} ${O.units}`, b.produced_on && `${O.produced}: ${date(b.produced_on)}`, b.expires_on && `${O.expires}: ${date(b.expires_on)}`].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="flex items-center gap-3">
                {b.coa && <a href={`/portal/coa/${b.lot_id}`} className="text-sm">{O.coa}</a>}
                <Chip tone={b.released ? "green" : "neutral"}>{b.released ? O.released : O.inReview}</Chip>
              </span>
            </div>
          ))}
        </Card>
      )}

      {o.dispatches.length > 0 && (
        <Card title={O.shipments}>
          {o.dispatches.map((d) => (
            <p key={d.code} className="m-0 flex flex-col border-b border-mist py-1.5 text-sm last:border-0">
              <span className="font-semibold">{date(d.dispatched_on)}{d.carrier ? ` · ${d.carrier}` : ""}</span>
              <span className="text-xs break-all text-ink-2">{d.tracking ? `${O.tracking}: ${d.tracking}` : O.noTracking}</span>
            </p>
          ))}
        </Card>
      )}

      <Card title={O.documents}><DocumentList rows={documents} showOrder={false} locale={locale} t={t} /></Card>

      <Card title={O.invoices}>
        {invoices.some((i) => i.order_id === id) ? <InvoiceList rows={invoices.filter((i) => i.order_id === id)} locale={locale} t={t} /> : <Empty>{P.invoices.empty}</Empty>}
      </Card>

      <Card title={O.messages}><PortalThread orderId={id} rows={feed} locale={locale} t={t} /></Card>
    </>
  );
}
