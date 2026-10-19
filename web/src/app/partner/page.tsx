import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { formatDate, formatNumber, formatQty } from "@/lib/i18n";
import { Card, Chip, Empty, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { requestAdjustment } from "@/app/actions";
import { moTone, qcTone, requestTone } from "@/lib/status";

type Mo = { id: string; code: string; project_code: string; product: string; product_bg: string | null; quantity: number; planned_date: string | null; status: string };
type Stock = { lot_id: string; location_id: string; lot_number: string; item: string; item_bg: string | null; base_unit: string; quantity: string; location: string; qc_status: string; expires_on: string | null };
type Req = { id: string; lot_number: string; base_unit: string; quantity: string; reason: string; status: string; requested_at: string };

export default async function PartnerToday() {
  const { user, locale, t } = await requireRole("partner", "admin");

  const data = await withUser(user.id, async (tx) => ({
    orders: (await tx.query<Mo>(
      `select id, code, project_code, product, product_bg, quantity, planned_date::text, status from partner_manufacturing_orders
        where status in ('released', 'in_production') order by status desc, planned_date nulls last, code`)).rows,
    stock: (await tx.query<Stock>(
      `select b.lot_id, b.location_id, b.lot_number, i.name as item, i.name_bg as item_bg, i.base_unit, b.quantity, l.name as location, b.qc_status, b.expires_on::text
         from stock_balances b join items i on i.id = b.item_id join locations l on l.id = b.location_id
        where b.quantity > 0 and l.is_partner_visible order by i.type, i.name, b.expires_on`,
    )).rows,
    requests: (await tx.query<Req>(
      `select r.id, lo.lot_number, i.base_unit, r.quantity, r.reason, r.status, r.requested_at::text
         from stock_adjustment_requests r join lots lo on lo.id = r.lot_id join items i on i.id = lo.item_id
        where r.requested_by = auth.uid() order by r.requested_at desc limit 10`,
    )).rows,
  }));
  const p = t.partner;
  const itemName = (s: Stock) => (locale === "bg" && s.item_bg ? s.item_bg : s.item);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={p.title} subtitle={`${formatDate(locale, new Date(), { weekday: "long", day: "numeric", month: "long" })} · ${p.subtitle}`} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={t.production.partner.title} id="proj-h">
            {data.orders.length === 0 && <Empty>{t.production.partner.empty}</Empty>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data.orders.map((m) => (
                <Link key={m.id} href={`/partner/production/${m.id}`} className={`flex flex-col gap-2 rounded border p-4 text-ink no-underline ${m.status === "in_production" ? "border-2 border-green" : "border-line"}`}>
                  <span className="text-lg font-bold">{m.code} · {m.project_code}</span>
                  <span className="text-sm text-ink-2">{locale === "bg" && m.product_bg ? m.product_bg : m.product} · {formatNumber(locale, m.quantity)} {t.common.units} · {formatDate(locale, m.planned_date)}</span>
                  <Chip tone={moTone(m.status)}>{t.enums.moStatus[m.status as "released"]}</Chip>
                </Link>
              ))}
            </div>
          </Card>

          <Card title={p.stockHere} id="stock-h">
            {data.stock.length === 0 && <Empty>{p.noStock}</Empty>}
            <div className="flex flex-col">
              {data.stock.map((s) => (
                <div key={s.lot_id + s.location_id} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_110px_120px]">
                  <span className="min-w-0">
                    <span className="font-semibold break-words">{itemName(s)}</span>
                    <span className="block text-xs text-ink-2">{s.lot_number} · {t.inventory.expires} {formatDate(locale, s.expires_on)}</span>
                  </span>
                  <span className="hide-sm min-w-0 break-words">{s.location}</span>
                  <span className="text-right font-semibold">{formatQty(locale, s.quantity, s.base_unit)}</span>
                  <span className="hide-sm"><Chip tone={qcTone(s.qc_status)}>{t.enums.qcStatus[s.qc_status as "released"]}</Chip></span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title={p.correction} id="corr-h">
            <p className="m-0 text-sm text-ink-2">{p.correctionNote}</p>
            <ActionForm action={requestAdjustment} submitLabel={p.submit}>
              <label className="field"><span>{p.lot} *</span>
                <select name="lot_location" required className="input" defaultValue="">
                  <option value="" disabled>{p.chooseLot}</option>
                  {data.stock.map((s) => (
                    <option key={s.lot_id + s.location_id} value={`${s.lot_id}|${s.location_id}`}>
                      {s.lot_number} · {itemName(s)} · {s.location} ({formatQty(locale, s.quantity, s.base_unit)})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field"><span>{p.change} *</span>
                <input name="quantity" type="number" step="any" required className="input" aria-describedby="chg-hint" />
                <small id="chg-hint" className="text-xs text-ink-2">{p.changeHint}</small>
              </label>
              <label className="field"><span>{p.reason} *</span><input name="reason" required className="input" /></label>
            </ActionForm>
          </Card>

          <Card title={p.myRequests} id="req-h">
            {data.requests.length === 0 && <Empty>{p.noRequests}</Empty>}
            {data.requests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold">{r.lot_number} · {Number(r.quantity) > 0 ? "+" : ""}{formatQty(locale, r.quantity, r.base_unit)}</span>
                  <span className="block text-ink-2">{r.reason} · {formatDate(locale, r.requested_at, { day: "numeric", month: "short" })}</span>
                </span>
                <Chip tone={requestTone(r.status)}>{t.enums.requestStatus[r.status as "pending"]}</Chip>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
