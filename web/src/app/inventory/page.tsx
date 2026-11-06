import Link from "next/link";
import { LiveSearch } from "@/components/live-search";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { fmt, formatDate, formatPrice, formatQty, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { Chip, Empty, PageHeader, type Tone } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { qcTone } from "@/lib/status";
import { countStock } from "@/app/actions";
import { SearchSelect } from "@/components/search-select";
import { LotDetailsForm } from "@/components/lot-details-form";
import { WarehouseSelect } from "@/components/warehouse-select";

type Item = {
  item_id: string; sku: string; name: string; name_bg: string | null; type: string; base_unit: string; shelf_life_months: number | null;
  novel_food_status: string | null; on_hand: string; usable: string; quarantine: string; reserved: string; available: string;
  reorder_level: string | null; below_reorder_level: boolean; next_expiry: string | null; days_left: number | null;
  incoming: string; next_expected_on: string | null; projected: string;
};
type Lot = { lot_id: string; item_id: string; location_id: string; lot_number: string; location: string; quantity: string; qc_status: string; expires_on: string | null; supplier_lot: string | null; is_expired: boolean; unit_cost: string | null };
type Loc = { id: string; code: string; name: string };
type Res = { item_id: string; code: string; client: string | null; quantity: string };

// Filter tabs (owner, Oct 2026): raw materials (with excipients and semi-finished goods), packaging, finished goods
const TYPES = ["raw_material", "packaging", "finished_good"] as const;
const TAB_TYPES: Record<(typeof TYPES)[number], string[]> = {
  raw_material: ["raw_material", "excipient", "semi_finished"],
  packaging: ["packaging"],
  finished_good: ["finished_good"],
};

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

function locFlag(i: Item, t: Dict, warnDays: number): { tone: Tone; text: string } {
  const f = t.inventory.flags;
  if (i.days_left !== null && i.days_left < 0) return { tone: "red", text: f.expired };
  if (i.days_left !== null && i.days_left <= warnDays) return { tone: "red", text: fmt(f.expiring, { d: i.days_left }) };
  if (Number(i.usable) <= 0) return { tone: "amber", text: t.inventory.quarantine };
  return { tone: "green", text: f.ok };
}

const COLS = "md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_140px] lg:grid-cols-[minmax(0,2.2fr)_repeat(3,minmax(0,1fr))_150px] xl:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))_150px]";

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const { user, locale, t } = await requireStaff();
  const sp = await searchParams;
  const type = (TYPES as readonly string[]).includes(String(sp.type)) ? (sp.type as (typeof TYPES)[number]) : "raw_material";
  const term = typeof sp.q === "string" ? sp.q.trim() : "";
  const canReceive = user.role === "admin";
  // One warehouse (owner, Nov 2026): its stock only; empty = all of them
  const loc = typeof sp.loc === "string" && /^[0-9a-f-]{36}$/i.test(sp.loc) ? sp.loc : "";

  const data = await withUser(user.id, async (tx) => {
    const warn = (await tx.query<{ d: number }>("select coalesce((select expiry_warning_days from company_settings limit 1), 90) as d")).rows[0].d;
    const locations = (await tx.query<Loc>(
      "select id, code, name from locations where is_active and type <> 'virtual' order by (code = 'NK-WH') desc, (code = 'G-PRO') desc, name")).rows;
    const at = locations.some((l) => l.id === loc) ? loc : "";
    const search = `($2 = '' or i.name ilike '%' || $2 || '%' or i.name_bg ilike '%' || $2 || '%' or i.sku ilike '%' || $2 || '%'
               or exists (select 1 from stock_balances b join lots lo on lo.id = b.lot_id
                           where b.item_id = i.id and b.quantity > 0 and ($3::uuid is null or b.location_id = $3::uuid)
                             and (lo.lot_number ilike '%' || $2 || '%' or lo.supplier_lot ilike '%' || $2 || '%')))`;
    const items = at ? (await tx.query<Item>(
      // Stock in the chosen warehouse only; reservations and incoming goods are not kept per warehouse
      `select i.id as item_id, i.sku, i.name, i.name_bg, i.type, i.base_unit, i.shelf_life_months, i.novel_food_status,
              b.on_hand::text, b.usable::text, b.quarantine::text, '0' as reserved, b.usable::text as available,
              null as reorder_level, false as below_reorder_level, b.next_expiry::text, (b.next_expiry - current_date) as days_left,
              '0' as incoming, null as next_expected_on, b.usable::text as projected
         from items i
         join (select item_id, sum(quantity) as on_hand,
                      coalesce(sum(quantity) filter (where qc_status = 'released' and not is_expired), 0) as usable,
                      coalesce(sum(quantity) filter (where qc_status = 'quarantine'), 0) as quarantine,
                      min(expires_on) as next_expiry
                 from stock_balances where location_id = $3::uuid and quantity > 0 group by item_id) b on b.item_id = i.id
        where i.type::text = any($1::text[]) and ${search}
        order by i.type, i.name`,
      [TAB_TYPES[type], term, at],
    )).rows : (await tx.query<Item>(
      `select s.item_id, s.sku, s.name, i.name_bg, s.type, s.base_unit, i.shelf_life_months, i.novel_food_status,
              s.on_hand, s.usable, s.quarantine, s.reserved, s.available, s.reorder_level, s.below_reorder_level,
              e.next_expiry::text, (e.next_expiry - current_date) as days_left,
              s.incoming, s.next_expected_on::text, s.projected
         from item_stock_summary s
         join items i on i.id = s.item_id
         left join lateral (select min(b.expires_on) as next_expiry from stock_balances b where b.item_id = s.item_id and b.quantity > 0) e on true
        where s.type::text = any($1::text[])
          and ($2 = '' or s.name ilike '%' || $2 || '%' or i.name_bg ilike '%' || $2 || '%' or s.sku ilike '%' || $2 || '%'
               -- our lot number or the supplier's batch of a lot in stock
               or exists (select 1 from stock_balances b join lots lo on lo.id = b.lot_id
                           where b.item_id = s.item_id and b.quantity > 0
                             and (lo.lot_number ilike '%' || $2 || '%' or lo.supplier_lot ilike '%' || $2 || '%')))
        order by s.type, s.name`,
      [TAB_TYPES[type], term],
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
    return { warn, items, lots: at ? lots.filter((l) => l.location_id === at) : lots, res, locations, at };
  });

  const itemName = (i: Item) => (locale === "bg" && i.name_bg ? i.name_bg : i.name);
  // A search that matches a lot opens its item and marks the lot
  const needle = term.toLowerCase();
  const lotHit = (l: Lot) => needle !== "" && (l.lot_number.toLowerCase().includes(needle) || (l.supplier_lot ?? "").toLowerCase().includes(needle));
  const q = (n: string, u: string, l: Locale = locale) => formatQty(l, n, u);
  const at = data.at;
  const keep = (extra: Record<string, string>) => new URLSearchParams({ ...extra, ...(at && { loc: at }) });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.inventory.title}
        titleAside={
          <WarehouseSelect label={t.inventory.warehouse} allLabel={t.inventory.allWarehouses} value={at}
            options={data.locations.map((l) => ({ id: l.id, name: l.name }))}
            keep={{ type, ...(term && { q: term }) }} />
        }
        subtitle={at ? t.inventory.warehouseNote : t.inventory.subtitle}
        actions={canReceive && (
          <>
            <Link href={`/inventory/transfer${at ? `?from=${at}` : ""}`} className="btn btn-outline">{t.inventory.transfer.button}</Link>
            {user.role === "admin" && <Link href="/inventory/corrections" className="btn btn-outline">{t.nav.corrections}</Link>}
            <Link href="/inventory/items/new" className="btn btn-outline">{t.inventory.newItem}</Link>
            <Link href="/inventory/receive" className="btn btn-primary">{t.inventory.receive}</Link>
          </>
        )}
      />

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label={t.inventory.filter} className="flex flex-wrap gap-1">
          {TYPES.map((ty) => (
            <Link
              key={ty}
              href={`/inventory?${keep({ type: ty, ...(term && { q: term }) })}`}
              aria-current={type === ty ? "page" : undefined}
              className={`flex min-h-10 items-center rounded-full border px-3.5 text-[13px] no-underline ${type === ty ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-white text-ink"}`}
            >
              {t.enums.itemType[ty]}
            </Link>
          ))}
        </nav>
        <form method="get" role="search" className="flex min-w-0 flex-[1_1_220px] justify-end">
          <input type="hidden" name="type" value={type} />
          {at && <input type="hidden" name="loc" value={at} />}
          <label htmlFor="inv-q" className="sr-only">{t.topbar.search}</label>
          <LiveSearch id="inv-q" defaultValue={term} placeholder={t.inventory.searchPlaceholder} className="input max-w-[320px]" />
        </form>
      </div>

      <section aria-label={t.inventory.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${COLS}`}>
          <span>{t.inventory.item}</span>
          <span className="text-right">{t.inventory.onHand}</span>
          <span className="hide-md text-right">{at ? t.inventory.quarantine : t.inventory.reserved}</span>
          <span className="text-right">{at ? t.inventory.usable : t.inventory.available}</span>
          <span className="hidden text-right xl:block">{at ? "" : t.inventory.incoming}</span>
          <span>{t.inventory.status}</span>
        </div>
        {data.items.length === 0 && <div className="py-4"><Empty>{t.inventory.empty}</Empty></div>}
        {data.items.map((i) => {
          const f = at ? locFlag(i, t, data.warn) : flag(i, t, locale, data.warn);
          const lots = data.lots.filter((l) => l.item_id === i.item_id);
          const res = at ? [] : data.res.filter((r) => r.item_id === i.item_id);
          return (
            <details key={i.item_id} open={lots.some(lotHit)} className="group border-b border-mist last:border-0">
              <summary className={`row cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] py-3.5 text-sm ${COLS} [&::-webkit-details-marker]:hidden`}>
                <div className="min-w-0">
                  <div className="font-semibold break-words">
                    <span aria-hidden="true" className="inline-block w-4 transition-transform group-open:rotate-90">▸</span>
                    {itemName(i)}
                  </div>
                  <div className="pl-4 text-xs text-ink-2">
                    {i.sku}
                    {i.shelf_life_months ? ` · ${fmt(t.inventory.shelfLife, { m: i.shelf_life_months })}` : ""}
                    <span className="md:hidden"> · {at ? t.inventory.usable : t.inventory.available}: {q(i.available, i.base_unit)}</span>
                  </div>
                </div>
                <span className="hide-sm text-right">{q(i.on_hand, i.base_unit)}</span>
                <span className="hide-md text-right">{q(at ? i.quarantine : i.reserved, i.base_unit)}</span>
                <span className="hide-sm text-right font-bold">{q(i.available, i.base_unit)}</span>
                <span className="hidden text-right xl:block">{at ? "" : Number(i.incoming) > 0 ? q(i.incoming, i.base_unit) : "—"}</span>
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
                      <div key={l.lot_id + l.location} className={`row grid-cols-[minmax(0,1fr)_auto] text-sm ${lotHit(l) ? "-mx-2 rounded bg-amber-tint px-2 py-1" : ""} md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_100px_120px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_100px_120px_110px_minmax(0,1fr)]`}>
                        <span className="min-w-0">
                          <span className="font-semibold">{l.lot_number}</span>
                          {l.supplier_lot && <span className="block text-xs text-ink-2 lg:hidden">{t.inventory.supplierLot}: {l.supplier_lot}</span>}
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
                {user.role === "admin" && lots.length > 0 && (
                  <div className="flex flex-col gap-2 border-t border-line pt-3">
                    <h3 className="m-0 text-sm font-bold">{t.inventory.lotDetails.title}</h3>
                    <LotDetailsForm
                      labels={t.inventory.lotDetails}
                      lots={[...new Map(lots.map((l) => [l.lot_id, l])).values()].map((l) => ({
                        lot_id: l.lot_id,
                        label: [l.lot_number, ...lots.filter((x) => x.lot_id === l.lot_id).map((x) => x.location), l.supplier_lot].filter(Boolean).join(" · "),
                        expires_on: l.expires_on,
                        supplier_lot: l.supplier_lot,
                      }))}
                    />
                  </div>
                )}
                {canReceive && lots.length > 0 && (
                  <div className="flex flex-col gap-2 border-t border-line pt-3">
                    <h3 className="m-0 text-sm font-bold">{t.inventory.count.title}</h3>
                    <p className="m-0 text-[13px] text-ink-2">{t.inventory.count.hint}</p>
                    <ActionForm action={countStock} submitLabel={t.inventory.count.submit}>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)]">
                        <label className="field"><span>{t.inventory.count.lot} *</span>
                          <SearchSelect name="lot_location" required placeholder={t.common.typeToSearch} noResults={t.common.noResults} defaultValue={lots.length === 1 ? `${lots[0].lot_id}|${lots[0].location_id}` : ""}
                            options={lots.map((l) => ({
                              value: `${l.lot_id}|${l.location_id}`, label: `${l.lot_number} · ${l.location}`, hint: q(l.quantity, i.base_unit),
                              keywords: l.supplier_lot ?? "",
                            }))} />
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
