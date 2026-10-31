import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { formatDate, formatQty } from "@/lib/i18n";
import { Card, Chip, Empty, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { LiveSearch } from "@/components/live-search";
import { qcTone } from "@/lib/status";
import { attachCoa, setLotStatus } from "@/app/batch-actions";

type Lot = {
  id: string; lot_number: string; sku: string; name: string; name_bg: string | null; base_unit: string; qc_status: string;
  qc_notes: string | null; expires_on: string | null; coa_path: string | null; on_hand: string; item_type: string;
};

const LOT_SQL = `select l.id, l.lot_number, i.sku, i.name, i.name_bg, i.base_unit, l.qc_status, l.qc_notes, l.expires_on::text, l.coa_path,
         i.type as item_type, coalesce((select sum(m.quantity) from stock_movements m where m.lot_id = l.id), 0)::text as on_hand
    from lots l join items i on i.id = l.item_id`;

/** Finished batches to release (with their COA), blocked lots, and blocking any lot. */
export default async function QualityPage({ searchParams }: PageProps<"/quality">) {
  const { user, locale, t } = await requireRole("admin");
  const sp = await searchParams;
  const term = typeof sp.q === "string" ? sp.q.trim() : "";
  const Q = t.quality;
  const nm = (x: Lot) => (locale === "bg" && x.name_bg ? x.name_bg : x.name);

  const { waiting, blocked, found } = await withUser(user.id, async (tx) => ({
    waiting: (await tx.query<Lot>(`${LOT_SQL} where l.qc_status = 'quarantine' and i.type = 'finished_good' order by l.created_at`)).rows,
    blocked: (await tx.query<Lot>(`${LOT_SQL} where l.qc_status = 'rejected' or (l.qc_status = 'quarantine' and i.type <> 'finished_good') order by l.updated_at desc`)).rows,
    found: term
      ? (await tx.query<Lot>(
          `${LOT_SQL} where l.qc_status = 'released' and (l.lot_number ilike '%' || $1 || '%' or l.supplier_lot ilike '%' || $1 || '%'
             or i.name ilike '%' || $1 || '%' or i.name_bg ilike '%' || $1 || '%' or i.sku ilike '%' || $1 || '%')
           order by l.created_at desc limit 20`, [term])).rows
      : [],
  }));

  const head = (x: Lot) => (
    <div className="min-w-0 flex-[1_1_240px] text-sm">
      <div className="font-semibold break-words">{nm(x)}</div>
      <div className="text-xs text-ink-2">
        {x.lot_number} · {x.sku} · {formatQty(locale, x.on_hand, x.base_unit)} · {Q.expires} {formatDate(locale, x.expires_on)}
      </div>
      {x.qc_notes && <div className="text-xs text-ink-2 break-words">{x.qc_notes}</div>}
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <Chip tone={qcTone(x.qc_status)}>{t.enums.qcStatus[x.qc_status as "released"]}</Chip>
        <Link href={`/traceability?lot=${x.id}`} className="text-xs font-semibold text-ink">{Q.trace}</Link>
        {x.coa_path && <a href={`/files/coa/${x.id}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-ink">{Q.viewCoa}</a>}
      </div>
    </div>
  );
  const blockForm = (x: Lot) => (
    <ActionForm action={setLotStatus} submitLabel={Q.block} resetOnSuccess={false} className="flex-[1_1_220px]">
      <input type="hidden" name="lot_id" value={x.id} />
      <input type="hidden" name="status" value="quarantine" />
      <label className="field"><span>{Q.reason} *</span><input name="reason" required className="input" /></label>
    </ActionForm>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={Q.title} subtitle={Q.subtitle} />

      <Card title={Q.waiting} id="waiting-h">
        <p className="m-0 text-sm text-ink-2">{Q.waitingNote}</p>
        {waiting.length === 0 && <Empty>{Q.noWaiting}</Empty>}
        {waiting.map((x) => (
          <div key={x.id} className="flex flex-wrap items-start gap-4 border-t border-mist pt-4">
            {head(x)}
            <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-3">
              <ActionForm action={attachCoa} submitLabel={Q.attachCoa} resetOnSuccess={false}>
                <input type="hidden" name="lot_id" value={x.id} />
                <label className="field"><span>{Q.coaFile}</span>
                  <input name="coa" type="file" required accept="application/pdf,image/*" className="input" />
                </label>
              </ActionForm>
              {x.coa_path ? (
                <ActionForm action={setLotStatus} submitLabel={Q.release} resetOnSuccess={false}>
                  <input type="hidden" name="lot_id" value={x.id} />
                  <input type="hidden" name="status" value="released" />
                </ActionForm>
              ) : <p className="m-0 text-sm text-ink-2">{Q.coaNeeded}</p>}
              <ActionForm action={setLotStatus} submitLabel={Q.reject} resetOnSuccess={false}>
                <input type="hidden" name="lot_id" value={x.id} />
                <input type="hidden" name="status" value="rejected" />
                <label className="field"><span>{Q.reason} *</span><input name="reason" required className="input" /></label>
              </ActionForm>
            </div>
          </div>
        ))}
      </Card>

      <Card title={Q.blocked} id="blocked-h">
        <p className="m-0 text-sm text-ink-2">{Q.blockedNote}</p>
        {blocked.length === 0 && <Empty>{Q.noBlocked}</Empty>}
        {blocked.map((x) => (
          <div key={x.id} className="flex flex-wrap items-start gap-4 border-t border-mist pt-4">
            {head(x)}
            {x.item_type !== "finished_good" || x.coa_path ? (
              <ActionForm action={setLotStatus} submitLabel={Q.release} resetOnSuccess={false}>
                <input type="hidden" name="lot_id" value={x.id} />
                <input type="hidden" name="status" value="released" />
              </ActionForm>
            ) : <p className="m-0 text-sm text-ink-2">{Q.coaNeeded}</p>}
          </div>
        ))}
      </Card>

      <Card title={Q.find} id="find-h">
        <form method="get" role="search" className="flex min-w-0">
          <label htmlFor="quality-q" className="sr-only">{Q.find}</label>
          <LiveSearch id="quality-q" defaultValue={term} placeholder={Q.searchPlaceholder} className="input" />
        </form>
        {!term && <Empty>{Q.typeToSearch}</Empty>}
        {term && found.length === 0 && <Empty>{Q.noMatch}</Empty>}
        {found.map((x) => (
          <div key={x.id} className="flex flex-wrap items-start gap-4 border-t border-mist pt-4">
            {head(x)}
            {blockForm(x)}
          </div>
        ))}
      </Card>
    </div>
  );
}
