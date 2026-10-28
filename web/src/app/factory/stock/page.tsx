import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { formatDate, formatQty } from "@/lib/i18n";
import { Card, Chip, Empty, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { countStock } from "@/app/actions";
import { SearchSelect } from "@/components/search-select";
import { qcTone } from "@/lib/status";

type Stock = {
  lot_id: string; location_id: string; lot_number: string; item: string; item_bg: string | null; item_type: string; base_unit: string;
  quantity: string; location: string; qc_status: string; expires_on: string | null; supplier_lot: string | null; sku: string;
};
type Correction = { id: string; created_at: string; lot_number: string; item: string; item_bg: string | null; base_unit: string; quantity: string; reason: string; location: string };

const CORRECTABLE = ["raw_material", "excipient", "packaging"];

export default async function FactoryStockPage({ searchParams }: PageProps<"/factory/stock">) {
  const { user, locale, t } = await requireRole("production", "admin");
  const S = t.factory.stock;
  const sp = await searchParams;
  const term = typeof sp.q === "string" ? sp.q.trim() : "";

  const data = await withUser(user.id, async (tx) => ({
    stock: (await tx.query<Stock>(
      `select b.lot_id, b.location_id, b.lot_number, i.name as item, i.name_bg as item_bg, i.type as item_type, i.base_unit,
              b.quantity::text, l.code as location, b.qc_status, b.expires_on::text, lo.supplier_lot, i.sku
         from stock_balances b join items i on i.id = b.item_id join locations l on l.id = b.location_id
         join lots lo on lo.id = b.lot_id
        where b.quantity > 0 and l.is_partner_visible`)).rows,
    corrections: (await tx.query<Correction>(
      `select m.id::text, m.created_at::text, lo.lot_number, i.name as item, i.name_bg as item_bg, i.base_unit, m.quantity::text, m.reason, l.code as location
         from stock_movements m join lots lo on lo.id = m.lot_id join items i on i.id = m.item_id join locations l on l.id = m.location_id
        where m.type = 'adjustment' and m.created_by = auth.uid() order by m.created_at desc limit 10`)).rows,
  }));
  const name = (s: { item: string; item_bg: string | null }) => (locale === "bg" && s.item_bg ? s.item_bg : s.item);
  const correctable = data.stock.filter((s) => CORRECTABLE.includes(s.item_type));
  // Search: our lot number, the supplier's batch, item name or SKU
  const needle = term.toLowerCase();
  const shown = needle
    ? data.stock.filter((s) => [s.lot_number, s.supplier_lot, s.item, s.item_bg, s.sku].some((v) => v?.toLowerCase().includes(needle)))
    : data.stock;
  shown.sort((a, b) => a.item_type.localeCompare(b.item_type) || name(a).localeCompare(name(b)) || (a.expires_on ?? "").localeCompare(b.expires_on ?? ""));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={S.title} subtitle={S.subtitle} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-label={S.title} className="cq card flex flex-col px-5 pt-4 pb-3">
          <form method="get" role="search" className="flex flex-wrap gap-2">
            <label htmlFor="stock-q" className="sr-only">{S.search}</label>
            <input id="stock-q" name="q" type="search" defaultValue={term} placeholder={S.search} className="input min-w-0 flex-[1_1_200px]" />
            <button type="submit" className="btn btn-outline">{S.find}</button>
          </form>
          <div className="row cq-hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 @xl:grid-cols-[minmax(0,1.6fr)_100px_120px_120px]">
            <span>{t.inventory.item}</span><span>{t.inventory.location}</span><span className="text-right">{t.inventory.qty}</span><span>{t.inventory.qc}</span>
          </div>
          {shown.length === 0 && <div className="py-4"><Empty>{needle ? S.noMatch : S.empty}</Empty></div>}
          {shown.map((s) => (
            <div key={s.lot_id + s.location_id} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 @xl:grid-cols-[minmax(0,1.6fr)_100px_120px_120px]">
              <span className="min-w-0">
                <span className="font-semibold break-words">{name(s)}</span>
                <span className="block text-xs text-ink-2">{s.lot_number}{s.supplier_lot ? ` · ${S.supplierLot} ${s.supplier_lot}` : ""} · {t.enums.itemType[s.item_type as "raw_material"]} · {t.inventory.expires} {formatDate(locale, s.expires_on)}<span className="@xl:hidden"> · {s.location}</span></span>
              </span>
              <span className="cq-hide-sm">{s.location}</span>
              <span className="text-right font-semibold">{formatQty(locale, s.quantity, s.base_unit)}</span>
              <span className="cq-hide-sm"><Chip tone={qcTone(s.qc_status)}>{t.enums.qcStatus[s.qc_status as "released"]}</Chip></span>
            </div>
          ))}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title={S.correct} id="correct-h">
            <p className="m-0 text-sm text-ink-2">{S.correctNote}</p>
            <ActionForm action={countStock} submitLabel={S.submit}>
              <label className="field"><span>{S.lot} *</span>
                <SearchSelect name="lot_location" required placeholder={t.common.typeToSearch} noResults={t.common.noResults}
                  options={correctable.map((s) => ({
                    value: `${s.lot_id}|${s.location_id}`, label: `${s.lot_number} · ${name(s)} · ${s.location}`,
                    hint: formatQty(locale, s.quantity, s.base_unit), keywords: `${s.item} ${s.item_bg ?? ""} ${s.sku} ${s.supplier_lot ?? ""}`,
                  }))} />
              </label>
              <label className="field"><span>{S.counted} *</span>
                <input name="counted" type="number" min={0} step="any" required className="input" />
              </label>
              <label className="field"><span>{S.reason} *</span><input name="reason" required className="input" /></label>
            </ActionForm>
          </Card>

          <Card title={S.recent} id="recent-h">
            {data.corrections.length === 0 && <Empty>{S.noRecent}</Empty>}
            {data.corrections.map((c) => (
              <div key={c.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                <span className="min-w-0 flex-[1_1_180px]">
                  <span className="font-semibold break-words">{name(c)} · {c.lot_number}</span>
                  <span className="block break-words text-ink-2">{c.reason} · {c.location} · {formatDate(locale, c.created_at, { day: "numeric", month: "short" })}</span>
                </span>
                <span className="font-semibold">{Number(c.quantity) > 0 ? "+" : ""}{formatQty(locale, c.quantity, c.base_unit)}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
