import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt, formatDate, formatNumber, formatQty } from "@/lib/i18n";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { DocHeader } from "@/components/sales-document";
import { LiveSearch } from "@/components/live-search";
import { PrintButton } from "@/components/print-button";
import { qcTone } from "@/lib/status";

type Found = {
  lot_id: string; lot_number: string; supplier_lot: string | null; sku: string; name: string; name_bg: string | null;
  item_type: string; qc_status: string; expires_on: string | null;
};
type Back = {
  mo_code: string; finished_lot: string; lot_id: string; lot_number: string; supplier_lot: string | null; supplier: string | null;
  sku: string; name: string; name_bg: string | null; base_unit: string; quantity: string; received_on: string | null; expires_on: string | null;
};
type Forward = {
  lot_id: string; lot_number: string; name: string; name_bg: string | null; mo_code: string; produced_on: string | null;
  made: string | null; on_hand: string; expires_on: string | null; qc_status: string;
};
type Client = {
  dispatch_id: string; dispatch_code: string; dispatched_on: string; order_id: string; order_code: string; client_id: string; client: string;
  lot_number: string; name: string; name_bg: string | null; quantity: string;
};

/** Traceability: find a lot, see where it came from, what was made with it and who received it. */
export default async function TraceabilityPage({ searchParams }: PageProps<"/traceability">) {
  const { user, locale, t } = await requireRole("admin", "sales");
  const sp = await searchParams;
  const term = typeof sp.q === "string" ? sp.q.trim() : "";
  const lotId = typeof sp.lot === "string" && /^[0-9a-f-]{36}$/i.test(sp.lot) ? sp.lot : null;
  const T = t.trace;
  const nm = (x: { name: string; name_bg: string | null }) => (locale === "bg" && x.name_bg ? x.name_bg : x.name);

  const data = await withUser(user.id, async (tx) => {
    const found = term ? (await tx.query<Found>("select lot_id, lot_number, supplier_lot, sku, name, name_bg, item_type, qc_status, expires_on::text from trace_find_lots($1)", [term])).rows : [];
    const id = lotId ?? (found.length === 1 ? found[0].lot_id : null);
    if (!id) return { found, lot: null, back: [], forward: [], clients: [] };
    const lot = (await tx.query<Found>(
      `select l.id as lot_id, l.lot_number, l.supplier_lot, i.sku, i.name, i.name_bg, i.type as item_type, l.qc_status, l.expires_on::text
         from lots l join items i on i.id = l.item_id where l.id = $1`, [id])).rows[0] ?? null;
    return {
      found, lot,
      back: (await tx.query<Back>("select mo_code, finished_lot, lot_id, lot_number, supplier_lot, supplier, sku, name, name_bg, base_unit, quantity::text, received_on::text, expires_on::text from trace_back($1)", [id])).rows,
      forward: (await tx.query<Forward>("select lot_id, lot_number, name, name_bg, mo_code, produced_on::text, made::text, on_hand::text, expires_on::text, qc_status from trace_forward($1)", [id])).rows,
      clients: (await tx.query<Client>("select dispatch_id, dispatch_code, dispatched_on::text, order_id, order_code, client_id, client, lot_number, name, name_bg, quantity::text from trace_clients($1)", [id])).rows,
    };
  });
  const { found, lot, back, forward, clients } = data;
  const backGrid = "sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_110px]";
  const fwdGrid = "sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_110px_110px]";
  const cliGrid = "sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_110px_110px]";
  const heading = "row hide-sm doc-th";
  const row = "row grid-cols-1 gap-1 border-b border-mist py-2.5 text-sm sm:gap-3";

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden"><PageHeader title={T.title} subtitle={T.subtitle} /></div>
      <form method="get" role="search" className="flex min-w-0 flex-wrap gap-2 print:hidden">
        <label htmlFor="trace-q" className="sr-only">{T.title}</label>
        <LiveSearch id="trace-q" defaultValue={term} placeholder={T.searchPlaceholder} className="input min-w-0 flex-[1_1_240px]" />
        {lot && <PrintButton label={T.print} variant="outline" />}
      </form>

      {!term && !lot && <Empty>{T.choose}</Empty>}
      {term && found.length === 0 && <Empty>{T.noMatch}</Empty>}
      {found.length > 1 && !lot && (
        <section aria-label={T.title} className="card flex flex-col px-5 py-2">
          {found.map((x) => (
            <Link key={x.lot_id} href={`/traceability?q=${encodeURIComponent(term)}&lot=${x.lot_id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-mist py-2 text-sm text-ink no-underline last:border-0">
              <span className="min-w-0 break-words"><strong>{x.lot_number}</strong> · {nm(x)}{x.supplier_lot ? ` · ${x.supplier_lot}` : ""}</span>
              <Chip tone={qcTone(x.qc_status)}>{t.enums.qcStatus[x.qc_status as "released"]}</Chip>
            </Link>
          ))}
        </section>
      )}

      {lot && (
        <article className="doc">
          <DocHeader title={T.report} meta={[`${T.lot}: ${lot.lot_number}`, fmt(T.generated, { date: formatDate(locale, new Date()) })]} sellerName="Nutrikal" logoDataUrl={null} />
          <div className="doc-body">
            <section className="doc-section">
              <div className="text-lg font-bold break-words">{nm(lot)}</div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2">
                <span>{lot.sku}</span>
                {lot.supplier_lot && <span>{T.supplierLot}: {lot.supplier_lot}</span>}
                <span>{T.expires}: {formatDate(locale, lot.expires_on)}</span>
                <Chip tone={qcTone(lot.qc_status)}>{t.enums.qcStatus[lot.qc_status as "released"]}</Chip>
              </div>
            </section>

            <section className="doc-section">
              <h2 className="doc-label">{T.backTitle}</h2>
              {back.length === 0 ? <Empty>{T.noBack}</Empty> : (
                <div>
                  <div className={`${heading} ${backGrid}`}><span>{T.item}</span><span>{T.lot}</span><span>{T.supplier}</span><span className="text-right">{T.quantity}</span></div>
                  {back.map((b, i) => (
                    <div key={i} className={`${row} ${backGrid}`}>
                      <span className="min-w-0 break-words">{nm(b)}<span className="block text-xs text-ink-2">{b.mo_code}</span></span>
                      <span className="min-w-0 break-words"><Link href={`/traceability?lot=${b.lot_id}`} className="font-semibold text-ink">{b.lot_number}</Link>{b.supplier_lot && <span className="block text-xs text-ink-2">{b.supplier_lot}</span>}</span>
                      <span className="min-w-0 break-words">{b.supplier ?? "—"}<span className="block text-xs text-ink-2">{formatDate(locale, b.received_on)}</span></span>
                      <span className="sm:text-right">{formatQty(locale, b.quantity, b.base_unit)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="doc-section">
              <h2 className="doc-label">{T.forwardTitle}</h2>
              {forward.length === 0 ? <Empty>{T.noForward}</Empty> : (
                <div>
                  <div className={`${heading} ${fwdGrid}`}><span>{T.item}</span><span>{T.batch}</span><span className="text-right">{T.made}</span><span className="text-right">{T.left}</span></div>
                  {forward.map((f) => (
                    <div key={f.lot_id} className={`${row} ${fwdGrid}`}>
                      <span className="min-w-0 break-words">{nm(f)}<span className="block text-xs text-ink-2">{f.mo_code} · {formatDate(locale, f.produced_on)}</span></span>
                      <span className="min-w-0 break-words"><Link href={`/traceability?lot=${f.lot_id}`} className="font-semibold text-ink">{f.lot_number}</Link><span className="block text-xs text-ink-2">{T.expires} {formatDate(locale, f.expires_on)}</span></span>
                      <span className="sm:text-right">{f.made ? `${formatNumber(locale, f.made)} ${t.common.units}` : "—"}</span>
                      <span className="sm:text-right">{formatNumber(locale, f.on_hand)} {t.common.units}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="doc-section">
              <h2 className="doc-label">{T.clientsTitle}</h2>
              {clients.length === 0 ? <Empty>{T.noClients}</Empty> : (
                <div>
                  <div className={`${heading} ${cliGrid}`}><span>{T.client}</span><span>{T.batch}</span><span>{T.date}</span><span className="text-right">{T.quantity}</span></div>
                  {clients.map((c, i) => (
                    <div key={i} className={`${row} ${cliGrid}`}>
                      <span className="min-w-0 break-words"><Link href={`/clients/${c.client_id}`} className="font-semibold text-ink">{c.client}</Link><span className="block text-xs text-ink-2">{c.order_code}</span></span>
                      <span className="min-w-0 break-words">{c.lot_number}<span className="block text-xs text-ink-2">{nm(c)}</span></span>
                      <span><Link href={`/orders/${c.order_id}/delivery/${c.dispatch_id}`} className="text-ink">{c.dispatch_code}</Link><span className="block text-xs text-ink-2">{formatDate(locale, c.dispatched_on)}</span></span>
                      <span className="sm:text-right">{formatNumber(locale, c.quantity)} {t.common.units}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </article>
      )}
    </div>
  );
}
