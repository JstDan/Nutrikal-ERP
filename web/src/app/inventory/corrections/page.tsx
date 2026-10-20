import Link from "next/link";
import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { formatDate, formatQty } from "@/lib/i18n";
import { Chip, Empty, PageHeader } from "@/components/ui";

type Row = {
  id: string; created_at: string; diff: string; reason: string; lot_number: string; item_id: string; sku: string; name: string;
  name_bg: string | null; base_unit: string; location: string; created_by_name: string;
};

/** Every stock correction made by Production (ledger adjustments), for Admin. */
export default async function CorrectionsPage() {
  const { user, locale, t } = await requireRole("admin");
  const C = t.inventory.corrections;
  const rows = await q<Row>(user.id,
    `select id::text, created_at::text, diff::text, reason, lot_number, item_id, sku, name, name_bg, base_unit, location, created_by_name
       from production_corrections order by created_at desc limit 300`);
  const grid = "md:grid-cols-[130px_minmax(0,1.4fr)_90px_130px] xl:grid-cols-[130px_minmax(0,1.4fr)_90px_130px_minmax(0,1.2fr)_140px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader crumb={<Link href="/inventory" className="text-ink-2">{t.inventory.title}</Link>} title={C.title} subtitle={C.subtitle} />
      <section aria-label={C.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`}>
          <span>{C.when}</span><span>{t.inventory.item}</span><span>{t.inventory.location}</span><span>{C.diff}</span>
          <span className="hidden xl:block">{C.reason}</span><span className="hidden xl:block">{C.by}</span>
        </div>
        {rows.length === 0 && <div className="py-4"><Empty>{C.empty}</Empty></div>}
        {rows.map((r) => (
          <div key={r.id} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 ${grid}`}>
            <span className="hide-sm">{formatDate(locale, r.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            <span className="min-w-0">
              <Link href={`/inventory/items/${r.item_id}`} className="font-semibold break-words text-ink">{locale === "bg" && r.name_bg ? r.name_bg : r.name}</Link>
              <span className="block text-xs text-ink-2">{r.lot_number} · {r.sku}<span className="md:hidden"> · {r.location} · {formatDate(locale, r.created_at, { day: "numeric", month: "short" })}</span></span>
              <span className="block text-xs break-words text-ink-2 xl:hidden">{r.reason} · {r.created_by_name}</span>
            </span>
            <span className="hide-sm">{r.location}</span>
            <span><Chip tone={Number(r.diff) < 0 ? "amber" : "neutral"}>{Number(r.diff) > 0 ? "+" : ""}{formatQty(locale, r.diff, r.base_unit)}</Chip></span>
            <span className="hidden min-w-0 break-words xl:block">{r.reason}</span>
            <span className="hidden min-w-0 break-words xl:block">{r.created_by_name}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
