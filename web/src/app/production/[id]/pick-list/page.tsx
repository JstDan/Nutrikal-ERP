import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt, formatDate, formatNumber, formatQty } from "@/lib/i18n";
import { PrintButton } from "@/components/print-button";
import { Wordmark } from "@/components/logo";

type Mo = { id: string; code: string; project_code: string; product: string; product_bg: string | null; quantity: number; planned_date: string | null; status: string };
type Req = { item_id: string; sku: string; name: string; name_bg: string | null; base_unit: string; required: string };
type Lot = { item_id: string; lot_number: string; location: string; quantity: string; expires_on: string | null };

/** Pick list for a production order sent to the partner: materials with lots
 *  suggested first-expiry-first from released stock at the facility.
 *  Uses only partner-safe data (project code, no client, no prices). */
export default async function PickListPage({ params }: PageProps<"/production/[id]/pick-list">) {
  const { id } = await params;
  const { user, locale, t } = await requireRole("admin", "inventory", "partner");
  const L = t.pickList;

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const mo = (await tx.query<Mo>(
      `select id, code, project_code, product, product_bg, quantity, planned_date::text, status
         from partner_manufacturing_orders where id = $1`, [id])).rows[0];
    if (!mo) return null;
    const reqs = (await tx.query<Req>(
      "select item_id, sku, name, name_bg, base_unit, required::text from mo_material_requirements($1)", [id])).rows;
    const lots = (await tx.query<Lot>(
      `select b.item_id, b.lot_number, l.name as location, b.quantity::text, b.expires_on::text
         from stock_balances b join locations l on l.id = b.location_id
        where b.quantity > 0 and b.qc_status = 'released' and not b.is_expired and l.is_partner_visible
          and b.item_id = any($1::uuid[])
        order by b.expires_on nulls last, b.lot_number`, [reqs.map((r) => r.item_id)])).rows;
    return { mo, reqs, lots };
  });
  if (!data) notFound();
  const { mo, reqs, lots } = data;
  const nm = (o: { name: string; name_bg: string | null }) => (locale === "bg" && o.name_bg ? o.name_bg : o.name);
  const back = user.role === "partner" ? `/partner/production/${mo.id}` : `/production/${mo.id}`;

  // First-expiry-first allocation of the required quantity
  const picks = reqs.map((r) => {
    let left = Number(r.required);
    const rows: { lot: Lot; qty: number }[] = [];
    for (const lot of lots.filter((x) => x.item_id === r.item_id)) {
      if (left <= 0) break;
      const qty = Math.min(left, Number(lot.quantity));
      rows.push({ lot, qty });
      left = Math.round((left - qty) * 1e6) / 1e6;
    }
    return { r, rows, short: left > 0 ? left : 0 };
  });
  const grid = "grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_90px_110px_70px]";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        <PrintButton label={L.print} />
        <Link href={back} className="btn btn-outline">{t.common.back}</Link>
      </div>

      <article className="card flex flex-col gap-6 p-6 text-sm sm:p-10 print:border-0 print:p-0">
        <header className="flex flex-wrap justify-between gap-6">
          <div className="min-w-0">
            <Wordmark height={22} className="mb-2" />
            <h1 className="m-0 text-[26px] font-extrabold tracking-[0.6px]">{L.title}</h1>
            <div className="text-ink-2">{fmt(L.subtitle, { code: mo.code, qty: formatNumber(locale, mo.quantity) })}</div>
          </div>
          <div className="min-w-0 sm:text-right">
            <div className="font-semibold">{locale === "bg" && mo.product_bg ? mo.product_bg : mo.product}</div>
            <div>{t.production.project}: {mo.project_code}</div>
            <div>{t.production.planned}: {formatDate(locale, mo.planned_date)}</div>
            <div>{t.production.status}: {t.enums.moStatus[mo.status as "released"]}</div>
          </div>
        </header>
        <p className="m-0 text-[13px] text-ink-2">{L.note}</p>

        <section className="flex flex-col">
          {picks.map(({ r, rows, short }) => (
            <div key={r.item_id} className="break-inside-avoid border-b border-line py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-bold break-words">{nm(r)} <span className="font-normal text-ink-2">· {r.sku}</span></span>
                <span>{L.required}: <strong>{formatQty(locale, r.required, r.base_unit)}</strong></span>
              </div>
              {rows.length > 0 && (
                <div className="mt-2 flex flex-col">
                  <div className={`row hide-sm text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`}>
                    <span>{L.lot}</span><span>{L.location}</span><span>{L.expires}</span><span className="text-right">{L.pick}</span><span className="text-right">{L.picked}</span>
                  </div>
                  {rows.map(({ lot, qty }) => (
                    <div key={lot.lot_number + lot.location} className={`row border-t border-mist py-1.5 ${grid}`}>
                      <span className="min-w-0">
                        <span className="font-semibold">{lot.lot_number}</span>
                        <span className="block text-xs text-ink-2 sm:hidden">{lot.location} · {formatDate(locale, lot.expires_on)}</span>
                      </span>
                      <span className="hide-sm min-w-0 break-words">{lot.location}</span>
                      <span className="hide-sm">{formatDate(locale, lot.expires_on)}</span>
                      <span className="text-right font-semibold">{formatQty(locale, qty, r.base_unit)}</span>
                      <span aria-hidden="true" className="hide-sm ml-auto h-6 w-12 border-b border-ink" />
                    </div>
                  ))}
                </div>
              )}
              {short > 0 && (
                <p className="m-0 mt-2 font-semibold text-red-ink">
                  {fmt(L.short, { qty: formatQty(locale, short, r.base_unit) })}
                </p>
              )}
            </div>
          ))}
        </section>

        <footer className="grid grid-cols-1 gap-6 pt-4 sm:grid-cols-3">
          {[L.pickedBy, L.checkedBy, L.date].map((label) => (
            <div key={label} className="flex flex-col gap-8">
              <span className="text-xs text-ink-2">{label}</span>
              <span aria-hidden="true" className="border-b border-ink" />
            </div>
          ))}
        </footer>
      </article>
    </div>
  );
}
