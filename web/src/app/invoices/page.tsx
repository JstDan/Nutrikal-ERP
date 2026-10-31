import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { formatDate, formatPrice } from "@/lib/i18n";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { LiveSearch } from "@/components/live-search";

type Row = {
  id: string; number: string | null; status: "draft" | "issued"; issue_date: string | null; created_at: string;
  client: string; order_id: string | null; order_code: string | null; total: string | null; draft_total: string; currency: string;
  kind: "invoice" | "credit_note" | "debit_note"; due_date: string | null; open: string | null;
};
const FILTERS = ["all", "draft", "unpaid", "overdue", "paid"] as const;

/** All invoices, with and without an order: drafts first, then the issued ones by number (newest first). */
export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const { user, locale, t } = await requireRole("admin", "sales");
  const I = t.invoices;
  const sp = await searchParams;
  const term = typeof sp.q === "string" ? sp.q.trim() : "";
  const filter = FILTERS.find((f) => f === sp.filter) ?? "all";

  const rows = await withUser(user.id, async (tx) => (await tx.query<Row>(
    `select * from (
       select i.id, i.kind, i.number, i.status, i.issue_date::text, i.created_at::text, i.buyer ->> 'name' as client,
              i.order_id, so.code as order_code, i.total::text, i.currency, i.due_date::text,
              (select coalesce(sum(l.amount), 0) * (1 + i.vat_pct / 100) from invoice_lines l where l.invoice_id = i.id)::text as draft_total,
              case when i.status = 'issued' and i.order_id is null and i.kind = 'invoice' then invoice_open_amount(i.id)::text end as open
         from invoices i left join sales_orders so on so.id = i.order_id
        where $1 = '' or i.number ilike '%' || $1 || '%' or i.buyer ->> 'name' ilike '%' || $1 || '%' or so.code ilike '%' || $1 || '%'
     ) x
     where case $2 when 'draft' then status = 'draft'
                   when 'unpaid' then open::numeric > 0
                   when 'overdue' then open::numeric > 0 and due_date::date < current_date
                   when 'paid' then open::numeric <= 0
                   else true end
     order by status = 'issued', number desc nulls first, created_at desc limit 200`, [term, filter])).rows);
  const grid = "md:grid-cols-[130px_minmax(0,1fr)_120px_130px] lg:grid-cols-[130px_minmax(0,1fr)_110px_120px_130px_130px]";
  const payment = (x: Row) => {
    if (x.status === "draft") return <Chip tone="amber">{I.statusDraft}</Chip>;
    if (x.open == null) return <Chip tone="green">{I.statusIssued}</Chip>;
    if (Number(x.open) <= 0) return <Chip tone="green">{I.direct.paid}</Chip>;
    const late = !!x.due_date && x.due_date < new Date().toISOString().slice(0, 10);
    return <Chip tone={late ? "red" : "amber"}>{late ? I.direct.overdue : I.direct.unpaid}</Chip>;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={I.title} subtitle={I.subtitle} actions={<Link href="/invoices/new" className="btn btn-primary">{I.direct.title}</Link>} />
      <div className="flex flex-wrap items-center gap-3">
        <form method="get" role="search" className="flex min-w-0 flex-[1_1_260px]">
          <label htmlFor="inv-search" className="sr-only">{I.direct.search}</label>
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <LiveSearch id="inv-search" defaultValue={term} placeholder={I.direct.search} className="input" />
        </form>
        <nav aria-label={I.status} className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Link key={f} href={`/invoices?${new URLSearchParams({ ...(f !== "all" && { filter: f }), ...(term && { q: term }) })}`}
              aria-current={filter === f ? "page" : undefined}
              className={`flex min-h-11 items-center rounded-full border px-3.5 text-[13px] no-underline ${filter === f ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-white text-ink"}`}>
              {I.direct.filters[f]}
            </Link>
          ))}
        </nav>
      </div>
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
            <span className="hide-md">{x.order_code ?? "—"}</span>
            <span className="hide-sm">{formatDate(locale, x.issue_date ?? x.created_at)}</span>
            <span className="text-right font-semibold">{formatPrice(locale, x.total ?? x.draft_total, x.currency)}</span>
            <span className="hide-md">{payment(x)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
