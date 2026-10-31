import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { fmt, formatDate, formatNumber, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { Card, Chip, Empty } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { dispatchOrder } from "@/app/batch-actions";

type Lot = {
  lot_id: string; location_id: string; lot_number: string; name: string; name_bg: string | null; location: string;
  quantity: string; qc_status: string; expires_on: string | null; project_code: string;
};
type Note = { id: string; code: string; dispatched_on: string; units: string };

/** Delivery notes of an order and, once it is ready, the form that sends batches out of stock. */
export async function DispatchCard({ orderId, status, balanceDue, isAdmin, userId, locale, t }: {
  orderId: string; status: string; balanceDue: boolean; isAdmin: boolean; userId: string; locale: Locale; t: Dict;
}) {
  const D = t.dispatch;
  const canDispatch = status === "ready" || status === "dispatched";
  const { lots, notes } = await withUser(userId, async (tx) => ({
    lots: canDispatch
      ? (await tx.query<Lot>(
          "select lot_id, location_id, lot_number, name, name_bg, location, quantity::text, qc_status, expires_on::text, project_code from order_dispatchable_lots($1)", [orderId])).rows
      : [],
    notes: (await tx.query<Note>(
      `select d.id, d.code, d.dispatched_on::text, coalesce(sum(l.quantity), 0)::text as units
         from dispatches d left join dispatch_lines l on l.dispatch_id = d.id
        where d.order_id = $1 group by d.id order by d.code`, [orderId])).rows,
  }));
  if (!canDispatch && notes.length === 0) return null;
  const nm = (x: Lot) => (locale === "bg" && x.name_bg ? x.name_bg : x.name);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card title={D.title} id="dispatch-h">
      {notes.length > 0 && (
        <div className="flex flex-col gap-1 text-sm">
          <span className="label">{D.list}</span>
          {notes.map((n) => (
            <Link key={n.id} href={`/orders/${orderId}/delivery/${n.id}`} className="flex min-h-9 items-center text-ink">
              {n.code} · {formatDate(locale, n.dispatched_on)} · {formatNumber(locale, n.units)} {t.common.units}
            </Link>
          ))}
        </div>
      )}
      {canDispatch && !isAdmin && <p className="m-0 text-sm text-ink-2">{D.onlyAdmin}</p>}
      {canDispatch && isAdmin && lots.length === 0 && <Empty>{D.noStock}</Empty>}
      {canDispatch && isAdmin && lots.length > 0 && (
        <ActionForm action={dispatchOrder} submitLabel={D.submit} resetOnSuccess={false}>
          <input type="hidden" name="order_id" value={orderId} />
          <p className="m-0 text-sm text-ink-2">{D.note}</p>
          {lots.map((l, i) => {
            const ok = l.qc_status === "released";
            return (
              <div key={l.lot_id + l.location_id} className="flex flex-wrap items-end gap-3 border-t border-mist pt-3">
                <div className="min-w-0 flex-[1_1_180px] text-sm">
                  <div className="font-semibold break-words">{nm(l)}</div>
                  <div className="text-xs text-ink-2 break-words">
                    {l.lot_number} · {formatNumber(locale, l.quantity)} {D.inStock} · {fmt(D.expires, { date: formatDate(locale, l.expires_on) })}
                  </div>
                </div>
                {ok ? (
                  <label className="field w-28">
                    <span>{D.quantity}</span>
                    <input type="hidden" name={`use_${i}`} value={`${l.lot_id}|${l.location_id}`} />
                    <input name={`qty_${i}`} type="number" min={0} max={Number(l.quantity)} step="any" defaultValue={Number(l.quantity)} className="input" />
                  </label>
                ) : (
                  <Link href="/quality" className="no-underline"><Chip tone="red">{D.blockedLot}</Chip></Link>
                )}
              </div>
            );
          })}
          <div className="grid grid-cols-1 gap-3 border-t border-mist pt-3">
            <label className="field"><span>{D.date} *</span><input name="dispatched_on" type="date" required defaultValue={today} className="input" /></label>
            <label className="field"><span>{D.carrier}</span><input name="carrier" className="input" /></label>
            <label className="field"><span>{D.tracking}</span><input name="tracking" className="input" /></label>
            <label className="field"><span>{D.notes}</span><textarea name="notes" className="input" /></label>
          </div>
          {balanceDue && (
            <>
              <p className="m-0 text-sm font-semibold text-red-ink">{D.balanceDue}</p>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" name="override" className="h-5 w-5 shrink-0 accent-ink" />
                <span>{D.override}</span>
              </label>
            </>
          )}
        </ActionForm>
      )}
    </Card>
  );
}
