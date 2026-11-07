import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { DocumentList, InvoiceList, Panel, PortalThread } from "@/components/portal-parts";
import { q } from "@/lib/db/engine";
import { fmt, formatDate, formatNumber, formatPrice } from "@/lib/i18n";
import { portalDocuments, portalFeed, portalInvoices, portalMarkRead, validId, type PortalOrder } from "@/lib/portal";
import { getPortalSession } from "@/lib/session";
import { orderTone } from "@/lib/status";
import { PortalLabels, PortalReorder, type PortalLabel } from "@/components/portal-order-actions";

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
  const current = steps.findIndex((s) => !s.done);
  const next = P.next[o.status as "confirmed"];
  const [win] = await q<{ w: { from: number; to: number } | null }>(user.id, "select portal_order_window($1) as w", [id]);
  const mine = invoices.filter((i) => i.order_id === id);
  // Photos and files of the batches that the team chose to show (owner, Nov 2026)
  const photos = await q<{ id: string; name: string; mime: string | null; created_at: string; batch: string }>(user.id,
    "select id, name, mime, created_at::text, batch from portal_batch_files($1)", [id]);
  // Order again and labels to approve (owner, Nov 2026)
  const reorderLines = await q<{ id: string; description: string; quantity: number }>(user.id, "select id, description, quantity from portal_order_lines($1)", [id]);
  const reorders = await q<{ id: string; lines: { description: string; quantity: number }[]; note: string | null; status: "new" | "done" | "declined"; asked_at: string; reason: string | null; new_code: string | null }>(
    user.id, "select id, lines, note, status, asked_at::text, reason, new_code from portal_reorders($1)", [id]);
  const labels = await q<PortalLabel>(user.id,
    "select id, file_id, file_name, status, note, client_comment, requested_at::text, decided_at::text, decided_name from portal_labels($1)", [id]);
  const production = READY.includes(o.status);

  return (
    <>
      <PageHeader title={o.code} crumb={<Link href="/portal/orders">{P.nav.orders}</Link>}
        subtitle={o.customer_ref ? fmt(O.ref, { ref: o.customer_ref }) : undefined}
        actions={<Chip tone={orderTone(o.status)}>{P.status[o.status as keyof typeof P.status]}</Chip>} />

      {o.status !== "cancelled" && (
        <Panel title={O.progress}>
          <ol className="p-steps">
            {steps.map((s, i) => (
              <li key={s.label} data-done={s.done || undefined} data-now={i === current || undefined} style={{ animationDelay: `${i * 80}ms` }}>
                <span aria-hidden="true" className="p-dot">{s.done ? "✓" : ""}</span>
                <span className="flex min-w-0 flex-col">
                  <span className={`text-sm ${s.done || i === current ? "font-semibold" : "text-ink-2"}`}>{s.label}</span>
                  {s.at && <span className="text-xs text-ink-2">{s.at}</span>}
                </span>
              </li>
            ))}
          </ol>
          {win?.w && <p className="m-0 text-sm font-semibold">{fmt(O.window, { from: win.w.from, to: win.w.to })}</p>}
          {next && <p className="p-next"><strong>{P.next.title}:</strong> {next}</p>}
        </Panel>
      )}

      <Panel title={O.products}>
        {o.lines.map((l, i) => (
          <div key={i} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-mist py-2 text-sm last:border-0">
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold break-words">{l.description}</span>
              <span className="text-xs text-ink-2">{formatNumber(locale, l.quantity)} × {money(l.unit_price)}</span>
            </span>
            <span className="text-right font-semibold">{money(l.quantity * l.unit_price)}</span>
          </div>
        ))}
        <p className="m-0 flex justify-between gap-3 pt-2 text-base font-bold"><span>{O.value}</span><span className="text-right">{money(o.value)}</span></p>
        {Number(o.due) > 0 && <p className="m-0 flex justify-between gap-3 text-sm"><span>{O.due}</span><span className="text-right font-semibold">{money(Number(o.due))}</span></p>}
        {o.requested_date && <p className="m-0 text-xs text-ink-2">{O.requested}: {date(o.requested_date)}</p>}
      </Panel>

      {o.batches.length > 0 && (
        <Panel title={O.batches}>
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
        </Panel>
      )}

      {labels.length > 0 && (
        <Panel title={P.labels.title}>
          <PortalLabels orderId={id} labels={labels} P={P} locale={locale} />
        </Panel>
      )}

      {reorderLines.length > 0 && (
        <Panel title={P.reorder.title}>
          <PortalReorder orderId={id} lines={reorderLines} requests={reorders} P={P} locale={locale} />
        </Panel>
      )}

      {photos.length > 0 && (
        <Panel title={O.photos}>
          <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(140px, 100%), 1fr))" }}>
            {photos.map((f) => (
              <li key={f.id} className="flex min-w-0 flex-col gap-1">
                <a href={`/portal/batch-file/${f.id}`} target="_blank" rel="noopener" className="block overflow-hidden rounded-md border border-line bg-canvas">
                  {f.mime?.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element -- private files behind a permission check
                    <img src={`/portal/batch-file/${f.id}`} alt={f.name} loading="lazy" className="block aspect-square w-full object-cover" />
                  ) : <span className="grid aspect-square w-full place-items-center text-sm font-semibold text-ink">PDF</span>}
                </a>
                <span className="truncate text-xs text-ink-2" title={f.name}>{f.batch} · {date(f.created_at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {o.dispatches.length > 0 && (
        <Panel title={O.shipments}>
          {o.dispatches.map((d) => (
            <p key={d.code} className="m-0 flex flex-col border-b border-mist py-1.5 text-sm last:border-0">
              <span className="font-semibold">{date(d.dispatched_on)}{d.carrier ? ` · ${d.carrier}` : ""}</span>
              <span className="text-xs break-all text-ink-2">{d.tracking ? `${O.tracking}: ${d.tracking}` : O.noTracking}</span>
            </p>
          ))}
        </Panel>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title={O.documents}>
          <Link href={`/portal/orders/${id}/proforma`} className="p-row font-semibold">{O.proforma}</Link>
          {production && <Link href={`/portal/orders/${id}/proforma?final=1`} className="p-row font-semibold">{O.finalProforma}</Link>}
          {o.dispatches.map((d) => <Link key={d.id} href={`/portal/delivery/${d.id}`} className="p-row font-semibold">{O.deliveryNote} {d.code}</Link>)}
          {(documents.length > 0 || o.dispatches.length === 0) && <DocumentList rows={documents} showOrder={false} locale={locale} t={t} />}
        </Panel>
        <Panel title={O.invoices}>
          {mine.length ? <InvoiceList rows={mine} locale={locale} t={t} /> : <Empty>{P.invoices.empty}</Empty>}
        </Panel>
      </div>

      <Panel title={O.messages}><PortalThread orderId={id} rows={feed} locale={locale} t={t} /></Panel>
    </>
  );
}
