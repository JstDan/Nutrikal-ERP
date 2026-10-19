import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { formatDate, formatQty } from "@/lib/i18n";
import { Card, Chip, Empty, PageHeader } from "@/components/ui";
import { decideAdjustment, setLotQc } from "@/app/actions";
import { requestTone } from "@/lib/status";

type QLot = { lot_id: string; lot_number: string; item: string; sku: string; base_unit: string; quantity: string; location: string; supplier_lot: string | null; received_on: string; expires_on: string | null };
type Req = { id: string; lot_number: string; item: string; base_unit: string; location: string; quantity: string; reason: string; status: string; requested_at: string; requested_by: string | null };

export default async function QcPage() {
  const { user, locale, t } = await requireStaff();
  const isAdmin = user.role === "admin";
  const canDecide = user.role === "admin" || user.role === "inventory";

  const data = await withUser(user.id, async (tx) => ({
    lots: (await tx.query<QLot>(
      `select b.lot_id, b.lot_number, case when $1 = 'bg' then coalesce(i.name_bg, i.name) else i.name end as item, i.sku, i.base_unit, b.quantity, l.name as location, lo.supplier_lot, lo.received_on::text, b.expires_on::text
         from stock_balances b join items i on i.id = b.item_id join locations l on l.id = b.location_id join lots lo on lo.id = b.lot_id
        where b.qc_status = 'quarantine' and b.quantity > 0 order by lo.received_on`,
      [locale],
    )).rows,
    requests: (await tx.query<Req>(
      `select r.id, lo.lot_number, case when $1 = 'bg' then coalesce(i.name_bg, i.name) else i.name end as item, i.base_unit, l.name as location, r.quantity, r.reason, r.status, r.requested_at::text, p.full_name as requested_by
         from stock_adjustment_requests r join lots lo on lo.id = r.lot_id join items i on i.id = lo.item_id
         join locations l on l.id = r.location_id left join profiles p on p.id = r.requested_by
        order by r.status <> 'pending', r.requested_at desc limit 20`,
      [locale],
    )).rows,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.qc.title} subtitle={t.qc.subtitle} />

      <Card title={t.qc.quarantine} id="quar-h">
        {!isAdmin && data.lots.length > 0 && <p className="m-0 text-sm text-ink-2">{t.qc.adminOnly}</p>}
        {data.lots.length === 0 && <Empty>{t.qc.noQuarantine}</Empty>}
        {data.lots.map((l) => (
          <div key={l.lot_id + l.location} className="flex flex-col gap-3 border-t border-mist pt-4 first-of-type:border-0 first-of-type:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{l.lot_number} · {l.item}</span>
              <span className="text-sm text-ink-2">{formatQty(locale, l.quantity, l.base_unit)} · {l.location}</span>
            </div>
            <div className="text-[13px] text-ink-2">
              {l.sku}{l.supplier_lot ? ` · ${t.inventory.supplierLot}: ${l.supplier_lot}` : ""} · {formatDate(locale, l.received_on)} → {t.inventory.expires} {formatDate(locale, l.expires_on)}
            </div>
            {isAdmin && (
              <form action={setLotQc} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="lot_id" value={l.lot_id} />
                <label className="field flex-[1_1_240px]">
                  <span>{t.qc.notes}</span>
                  <input name="notes" className="input" />
                </label>
                <button type="submit" name="status" value="released" className="btn btn-primary">{t.qc.release}</button>
                <button type="submit" name="status" value="rejected" className="btn btn-outline">{t.qc.reject}</button>
              </form>
            )}
          </div>
        ))}
      </Card>

      <Card title={t.qc.adjustments} id="adj-h">
        {data.requests.length === 0 && <Empty>{t.qc.noAdjustments}</Empty>}
        {data.requests.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-mist pt-4 first-of-type:border-0 first-of-type:pt-0">
            <div className="min-w-0 text-sm">
              <div className="font-semibold">
                {r.lot_number} · {r.item} · <span className={Number(r.quantity) < 0 ? "text-red-ink" : "text-green-ink"}>{Number(r.quantity) > 0 ? "+" : ""}{formatQty(locale, r.quantity, r.base_unit)}</span>
              </div>
              <div className="text-ink-2">{r.reason} · {r.location} · {r.requested_by ?? ""} · {formatDate(locale, r.requested_at)}</div>
            </div>
            {r.status === "pending" && canDecide ? (
              <form action={decideAdjustment} className="flex gap-2">
                <input type="hidden" name="request_id" value={r.id} />
                <button type="submit" name="approve" value="true" className="btn btn-primary">{t.qc.approve}</button>
                <button type="submit" name="approve" value="false" className="btn btn-outline">{t.qc.reject}</button>
              </form>
            ) : (
              <Chip tone={requestTone(r.status)}>{t.enums.requestStatus[r.status as "pending"]}</Chip>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
