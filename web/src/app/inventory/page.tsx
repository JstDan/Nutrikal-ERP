import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { fmt, formatDate, formatPrice, formatQty, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { Chip, Empty, PageHeader, type Tone } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { qcTone } from "@/lib/status";
import { countStock } from "@/app/actions";

type Item = {
  item_id: string; sku: string; name: string; name_bg: string | null; type: string; base_unit: string; shelf_life_months: number | null;
  novel_food_status: string | null; on_hand: string; usable: string; quarantine: string; reserved: string; available: string;
  reorder_level: string | null; below_reorder_level: boolean; next_expiry: string | null; days_left: number | null;
  incoming: string; next_expected_on: string | null; projected: string;
};
type Lot = { lot_id: string; item_id: string; location_id: string; lot_number: string; location: string; quantity: string; qc_status: string; expires_on: string | null; supplier_lot: string | null; is_expired: boolean; unit_cost: string | null };
type Res = { item_id: string; code: string; client: string | null; quantity: string };

const TYPES = ["raw_material", "excipient", "packaging", "semi_finished", "finished_good"] as const;

function flag(i: Item, t: Dict, locale: Locale, warnDays: number): { tone: Tone; text: string } {
  const f = t.inventory.flags;
  if (i.days_left !== null && i.days_left < 0) return { tone: "red", text: f.expired };
  if (i.days_left !== null && i.days_left <= warnDays) return { tone: "red", text: fmt(f.expiring, { d: i.days_left }) };
  if (Number(i.available) < 0) return { tone: "red", text: fmt(f.short, { qty: formatQty(locale, -Number(i.available), i.base_unit) }) };
  if (Number(i.on_hand) <= 0) return { tone: "neutral", text: f.noStock };
  if (i.below_reorder_level) return { tone: "amber", text: f.low };
  if (Number(i.available) <= 0) return { tone: "neutral", text: f.fullyReserved };
  return { tone: "green", text: f.ok };
}

const COLS = "md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_140px] lg:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))_minmax(0,1fr)_150px] xl:grid-cols-[minmax(0,2.2fr)_repeat(5,minmax(0,1fr))_minmax(0,1fr)_150px]";

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const { user, locale, t } = await requireStaff();
  const sp = await searchParams;
  const type = typeof sp.type === "string" && (TYPES as readonly string[]).includes(sp.type) ? sp.type : "";
  const term = typeof sp.q === "string" ? sp.q.trim() : "";
  const canReceive = user.role === "admin" || user.role === "inventory";

  const data = await withUser(user.id, async (tx) => {
    const warn = (await tx.query<{ d: number }>("select coalesce((select expiry_warning_days from company_settings limit 1), 90) as d")).rows[0].d;
    const items = (await tx.query<Item>(
      `select s.item_id, s.sku, s.name, i.name_bg, s.type, s.base_unit, i.shelf_life_months, i.novel_food_status,
              s.on_hand, s.usable, s.quarantine, s.reserved, s.available, s.reorder_level, s.below_reorder_level,
              e.next_expiry::text, (e.next_expiry - current_date) as days_left,
              s.incoming, s.next_expected_on::text, s.projected
         from item_stock_summary s
         join items i on i.id = s.item_id
         left join lateral (select min(b.expires_on) as next_expiry from stock_balances b where b.item_id = s.item_id and b.quantity > 0) e on true
        where ($1 = '' or s.type::text = $1)
          and ($2 = '' or s.name ilike '%' || $2 || '%' or i.name_bg ilike '%' || $2 || '%' or s.sku ilike '%' || $2 || '%')
        order by s.type, s.name`,
      [type, term],
    )).rows;
    const lots = (await tx.query<Lot>(
      // lot_costs is visible only to users who may see purchase prices (RLS); others get null
      `select b.lot_id, b.item_id, b.location_id, b.lot_number, l.name as location, b.quantity, b.qc_status, b.expires_on::text, lo.supplier_lot, b.is_expired,
              lc.unit_cost::text
         from stock_balances b join locations l on l.id = b.location_id join lots lo on lo.id = b.lot_id
         left join lot_costs lc on lc.lot_id = b.lot_id
        where b.quantity > 0 order by b.expires_on nulls last, b.lot_number`,
    )).rows;
    const res = (await tx.query<Res>(
      `select r.item_id, coalesce(mo.code || coalesce(' · ' || p.code, ''), p.code) as code, c.legal_name as client, sum(r.quantity)::text as quantity
         from stock_reservations r
         left join projects p on p.id = r.project_id left join clients c on c.id = p.client_id
         left join manufacturing_orders mo on mo.id = r.manufacturing_order_id
        where r.status = 'active' group by r.item_id, mo.code, p.code, c.legal_name order by 2`,
    )).rows;
    return { warn, items, lots, res };
  });

  const itemName = (i: Item) => (locale === "bg" && i.name_bg ? i.name_bg : i.name);
  const q = (n: string, u: string, l: Locale = locale) => formatQty(l, n, u);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.inventory.title}
        subtitle={t.inventory.subtitle}
        actions={canReceive && (
          <>
            <Link href="/inventory/items/new" className="btn btn-outline">{t.inventory.newItem}</Link>
            <Link href="/inventory/receive" className="btn btn-primary">{t.inventory.receive}</Link>
          </>
        )}
      />

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label={t.inventory.filter} className="flex flex-wrap gap-1">
          {(["", ...TYPES] as const).map((ty) => (
            <Link
              key={ty || "all"}
              href={`/inventory?${new URLSearchParams({ ...(ty && { type: ty }), ...(term && { q: term }) })}`}
              aria-current={type === ty ? "page" : undefined}
              className={`flex min-h-10 items-center rounded-full border px-3.5 text-[13px] no-underline ${type === ty ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-white text-ink"}`}
            >
              {ty ? t.enums.itemType[ty] : t.inventory.allTypes}
            </Link>
          ))}
        </nav>
        <form method="get" role="search" className="flex min-w-0 flex-[1_1_220px] justify-end">
          {type && <input type="hidden" name="type" value={type} />}
          <label htmlFor="inv-q" className="sr-only">{t.topbar.search}</label>
          <input id="inv-q" name="q" type="search" defaultValue={term} placeholder={t.inventory.searchPlaceholder} className="input max-w-[320px]" />
        </form>
      </div>

      <section aria-label={t.inventory.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${COLS}`}>
          <span>{t.inventory.item}</span>
          <span className="text-right">{t.inventory.onHand}</span>
          <span className="hide-md text-right">{t.inventory.quarantine}</span>
          <span className="hide-md text-right">{t.inventory.reserved}</span>
          <span className="text-right">{t.inventory.available}</span>
          <span className="hidden text-right xl:block">{t.inventory.incoming}</span>
          <span className="hide-md">{t.inventory.nextExpiry}</span>
          <span>{t.inventory.status}</span>
        </div>
        {data.items.length === 0 && <div className="py-4"><Empty>{t.inventory.empty}</Empty></div>}
        {data.items.map((i) => {
          const f = flag(i, t, locale, data.warn);
          const lots = data.lots.filter((l) => l.item_id === i.item_id);
          const res = data.res.filter((r) => r.item_id === i.item_id);
          return (
            <details key={i.item_id} className="group border-b border-mist last:border-0">
              <summary className={`row cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] py-3.5 text-sm ${COLS} [&::-webkit-details-marker]:hidden`}>
                <div className="min-w-0">
                  <div className="font-semibold break-words">
                    <span aria-hidden="true" className="inline-block w-4 transition-transform group-open:rotate-90">▸</span>
                    {itemName(i)}
                  </div>
                  <div className="pl-4 text-xs text-ink-2">
                    {i.sku}
                    {i.shelf_life_months ? ` · ${fmt(t.inventory.shelfLife, { m: i.shelf_life_months })}` : ""}
                    <span className="md:hidden"> · {t.inventory.available}: {q(i.available, i.base_unit)}</span>
                  </div>
                </div>
                <span className="hide-sm text-right">{q(i.on_hand, i.base_unit)}</span>
                <span className="hide-md text-right">{q(i.quarantine, i.base_unit)}</span>
                <span className="hide-md text-right">{q(i.reserved, i.base_unit)}</span>
                <span className="hide-sm text-right font-bold">{q(i.available, i.base_unit)}</span>
                <span className="hidden text-right xl:block">{Number(i.incoming) > 0 ? q(i.incoming, i.base_unit) : "—"}</span>
                <span className="hide-md">{formatDate(locale, i.next_expiry, { month: "short", year: "numeric" })}</span>
                <Chip tone={f.tone}>{f.text}</Chip>
              </summary>

              <div className="mb-4 flex flex-col gap-2.5 rounded bg-canvas px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span className="text-ink-2">
                    {Number(i.incoming) > 0
                      ? fmt(t.inventory.incomingLine, {
                          qty: q(i.incoming, i.base_unit),
                          date: i.next_expected_on ? fmt(t.inventory.nextOn, { date: formatDate(locale, i.next_expected_on) }) : "",
                          projected: q(i.projected, i.base_unit),
                        })
                      : ""}
                  </span>
                  <Link href={`/inventory/items/${i.item_id}`} className="text-xs font-semibold tracking-[1px] uppercase text-ink">
                    {canReceive ? t.inventory.editItem : t.items.stockLink}
                  </Link>
                </div>
                {lots.length === 0 ? (
                  <span className="text-sm text-ink-2">{t.inventory.noLots}</span>
                ) : (
                  <>
                    <div className="row hide-sm text-xs font-semibold tracking-[1px] uppercase text-ink-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_100px_120px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_100px_120px_110px_minmax(0,1fr)]">
                      <span>{t.inventory.lot}</span><span>{t.inventory.location}</span><span className="text-right">{t.inventory.qty}</span>
                      <span>{t.inventory.qc}</span><span className="hide-md">{t.inventory.expires}</span><span className="hide-md">{t.inventory.supplierLot}{data.lots.some((x) => x.unit_cost) ? ` · ${t.inventory.cost}` : ""}</span>
                    </div>
                    {lots.map((l) => (
                      <div key={l.lot_id + l.location} className="row grid-cols-[minmax(0,1fr)_auto] text-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_100px_120px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_100px_120px_110px_minmax(0,1fr)]">
                        <span className="min-w-0">
                          <span className="font-semibold">{l.lot_number}</span>
                          <span className="block text-xs text-ink-2 md:hidden">{l.location} · {t.enums.qcStatus[l.qc_status as "released"]}</span>
                        </span>
                        <span className="hide-sm min-w-0 break-words">{l.location}</span>
                        <span className="text-right">{q(l.quantity, i.base_unit)}</span>
                        <span className="hide-sm"><Chip tone={qcTone(l.qc_status)}>{t.enums.qcStatus[l.qc_status as "released"]}</Chip></span>
                        <span className={`hide-md ${l.is_expired ? "font-semibold text-red-ink" : ""}`}>{formatDate(locale, l.expires_on)}</span>
                        <span className="hide-md min-w-0 break-words">{l.supplier_lot ?? "—"}{l.unit_cost != null && <span className="block text-xs text-ink-2">{formatPrice(locale, l.unit_cost, "EUR", 4)} / {i.base_unit === "pcs" ? t.common.units : i.base_unit}</span>}</span>
                      </div>
                    ))}
                  </>
                )}
                {res.length > 0 && (
                  <div className="flex flex-col gap-1 border-t border-line pt-2 text-[13px] text-ink-2">
                    {res.map((r) => (
                      <span key={r.code}>
                        {t.inventory.reservedFor}: <span className="font-semibold text-ink">{q(r.quantity, i.base_unit)} · {r.code}</span>
                        {r.client ? ` (${r.client})` : ""}
                      </span>
                    ))}
                  </div>
                )}
                {canReceive && lots.length > 0 && (
                  <div className="flex flex-col gap-2 border-t border-line pt-3">
                    <h3 className="m-0 text-sm font-bold">{t.inventory.count.title}</h3>
                    <p className="m-0 text-[13px] text-ink-2">{t.inventory.count.hint}</p>
                    <ActionForm action={countStock} submitLabel={t.inventory.count.submit}>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)]">
                        <label className="field"><span>{t.inventory.count.lot} *</span>
                          <select name="lot_location" required className="input">
                            {lots.map((l) => (
                              <option key={l.lot_id + l.location_id} value={`${l.lot_id}|${l.location_id}`}>
                                {l.lot_number} · {l.location} · {q(l.quantity, i.base_unit)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field"><span>{t.inventory.count.counted} *</span>
                          <input name="counted" type="number" min="0" step="any" required className="input" />
                        </label>
                        <label className="field"><span>{t.inventory.count.reason}</span><input name="reason" className="input" /></label>
                      </div>
                    </ActionForm>
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </section>
    </div>
  );
}
