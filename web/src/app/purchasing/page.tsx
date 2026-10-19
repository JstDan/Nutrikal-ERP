import Link from "next/link";
import { q } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { formatDate, formatQty } from "@/lib/i18n";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { purchaseTone } from "@/lib/status";
import { setPurchaseRequestStatus } from "@/app/actions";

type Row = {
  id: string; code: string; status: string; quantity: string; needed_by: string | null; sku: string; name: string; name_bg: string | null;
  base_unit: string; mo_id: string | null; mo_code: string | null;
};
const TABS = ["open", "ordered", "received", "cancelled"] as const;

export default async function PurchasingPage({ searchParams }: PageProps<"/purchasing">) {
  const { user, locale, t } = await requireStaff();
  const sp = await searchParams;
  const tab = typeof sp.status === "string" && (TABS as readonly string[]).includes(sp.status) ? sp.status : "open";
  const canEdit = user.role === "admin" || user.role === "inventory";
  const P = t.purchasing;

  const rows = await q<Row>(
    user.id,
    `select pr.id, pr.code, pr.status, pr.quantity::text, pr.needed_by::text, i.sku, i.name, i.name_bg, i.base_unit,
            mo.id as mo_id, mo.code as mo_code
       from purchase_requests pr join items i on i.id = pr.item_id
       left join manufacturing_orders mo on mo.id = pr.manufacturing_order_id
      where pr.status::text = $1
      order by pr.needed_by nulls last, pr.code`,
    [tab],
  );
  const grid = "md:grid-cols-[100px_minmax(0,1.4fr)_130px_minmax(0,1fr)] lg:grid-cols-[100px_minmax(0,1.4fr)_130px_120px_110px_minmax(0,1fr)]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={P.title} subtitle={P.subtitle} />
      {!canEdit && <p className="m-0 text-sm text-ink-2">{P.readOnly}</p>}
      <nav aria-label={P.status} className="flex flex-wrap gap-1">
        {TABS.map((s) => (
          <Link
            key={s}
            href={s === "open" ? "/purchasing" : `/purchasing?status=${s}`}
            aria-current={tab === s ? "page" : undefined}
            className={`flex min-h-10 items-center rounded-full border px-3.5 text-[13px] no-underline ${tab === s ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-white text-ink"}`}
          >
            {t.enums.purchaseStatus[s]}
          </Link>
        ))}
      </nav>

      <section aria-label={P.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`}>
          <span>{P.code}</span><span>{P.item}</span><span>{P.quantity}</span>
          <span className="hide-md">{P.neededBy}</span><span className="hide-md">{P.production}</span><span>{P.status}</span>
        </div>
        {rows.length === 0 && <div className="py-4"><Empty>{P.empty}</Empty></div>}
        {rows.map((r) => (
          <div key={r.id} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3.5 text-sm last:border-0 ${grid}`}>
            <div className="min-w-0 md:contents">
              <span className="font-semibold">{r.code}</span>
              <span className="block min-w-0 break-words md:inline">{locale === "bg" && r.name_bg ? r.name_bg : r.name} <span className="text-ink-2">· {r.sku}</span></span>
            </div>
            <span className="font-semibold">{formatQty(locale, r.quantity, r.base_unit)}</span>
            <span className="hide-md">{formatDate(locale, r.needed_by)}</span>
            <span className="hide-md">{r.mo_id ? <Link href={`/production/${r.mo_id}`} className="text-ink">{r.mo_code}</Link> : "—"}</span>
            {canEdit ? (
              <form action={setPurchaseRequestStatus} className="col-span-2 flex flex-wrap gap-2 md:col-span-1">
                <input type="hidden" name="request_id" value={r.id} />
                <label className="sr-only" htmlFor={`st-${r.id}`}>{P.setStatus}</label>
                <select id={`st-${r.id}`} name="status" defaultValue={r.status} className="input min-w-0 flex-[1_1_120px]">
                  {TABS.map((s) => <option key={s} value={s}>{t.enums.purchaseStatus[s]}</option>)}
                </select>
                <button type="submit" className="btn btn-outline">{t.common.save}</button>
              </form>
            ) : (
              <Chip tone={purchaseTone(r.status)}>{t.enums.purchaseStatus[r.status as "open"]}</Chip>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
