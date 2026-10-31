import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { formatDate, formatPrice } from "@/lib/i18n";
import { Chip, Empty, PageHeader } from "@/components/ui";

type Row = {
  id: string; number: string | null; status: "draft" | "issued"; issue_date: string | null; created_at: string;
  client: string; order_id: string; order_code: string; total: string | null; draft_total: string; currency: string;
  kind: "invoice" | "credit_note" | "debit_note";
};

/** Invoices of paid orders: drafts first, then the issued ones by number (newest first). */
export default async function InvoicesPage() {
  const { user, locale, t } = await requireRole("admin", "sales");
  const I = t.invoices;

  const rows = await withUser(user.id, async (tx) => (await tx.query<Row>(
    `select i.id, i.kind, i.number, i.status, i.issue_date::text, i.created_at::text, i.buyer ->> 'name' as client,
            i.order_id, so.code as order_code, i.total::text, i.currency,
            (select coalesce(sum(l.amount), 0) * (1 + i.vat_pct / 100) from invoice_lines l where l.invoice_id = i.id)::text as draft_total
       from invoices i join sales_orders so on so.id = i.order_id
      order by i.status = 'issued', i.number desc nulls first, i.created_at desc`)).rows);
  const grid = "md:grid-cols-[130px_minmax(0,1fr)_120px_130px] lg:grid-cols-[130px_minmax(0,1fr)_110px_120px_130px_110px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={I.title} subtitle={I.subtitle} />
      <section aria-label={I.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`}>
          <span>{I.number}</span><span>{I.client}</span><span className="hide-md">{I.order}</span>
          <span>{I.date}</span><span className="text-right">{I.total}</span><span className="hide-md">{I.status}</span>
        </div>
        {rows.length === 0 && <div className="py-4"><Empty>{I.empty}</Empty></div>}
        {rows.map((x) => (
          <div key={x.id} className={`row relative grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3.5 text-sm last:border-0 hover:bg-mist/60 ${grid}`}>
            <div className="min-w-0 md:contents">
              <Link href={`/invoices/${x.id}`} className="font-semibold text-ink underline after:absolute after:inset-0 after:content-['']">
                {x.number ?? I.statusDraft}
              </Link>
              <span className="block min-w-0 break-words md:inline">
                {x.client}
                {x.kind !== "invoice" && <span className="block text-xs text-ink-2">{x.kind === "credit_note" ? I.notes.credit : I.notes.debit}</span>}
              </span>
            </div>
            <span className="hide-md">{x.order_code}</span>
            <span className="hide-sm">{formatDate(locale, x.issue_date ?? x.created_at)}</span>
            <span className="text-right font-semibold">{formatPrice(locale, x.total ?? x.draft_total, x.currency)}</span>
            <span className="hide-md">
              <Chip tone={x.status === "issued" ? "green" : "amber"}>{x.status === "issued" ? I.statusIssued : I.statusDraft}</Chip>
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
