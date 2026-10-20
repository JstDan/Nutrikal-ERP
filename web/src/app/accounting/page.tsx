import { requireRole } from "@/lib/session";
import { fmt, formatPrice } from "@/lib/i18n";
import { Card, PageHeader } from "@/components/ui";
import { loadAccounting, period } from "@/lib/accounting";

export default async function AccountingPage({ searchParams }: PageProps<"/accounting">) {
  const { user, locale, t } = await requireRole("admin", "inventory");
  const A = t.accounting;
  const { from, to } = period(await searchParams);
  const data = await loadAccounting(user.id, from, to);
  const money = (n: number) => formatPrice(locale, n, "EUR", 2);
  const tiles = [
    { label: A.movements, value: String(data.movements.length) },
    { label: A.receivedValue, value: money(data.totals.received) },
    { label: A.consumedValue, value: money(data.totals.consumed) },
    { label: A.stockValue, value: money(data.totals.stock) },
    { label: A.openDeliveries, value: money(data.totals.commitments) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={A.title} subtitle={A.subtitle} />
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-4">
          <label className="field min-w-0 flex-[1_1_160px]"><span>{A.from}</span><input name="from" type="date" defaultValue={from} required className="input" /></label>
          <label className="field min-w-0 flex-[1_1_160px]"><span>{A.to}</span><input name="to" type="date" defaultValue={to} required className="input" /></label>
          <button type="submit" className="btn btn-outline">{A.show}</button>
          <a href={`/accounting/export?from=${from}&to=${to}`} className="btn btn-primary" download>{A.download}</a>
        </form>
      </Card>
      <section aria-label={A.title} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((x) => (
          <div key={x.label} className="card flex min-w-0 flex-col gap-1 p-5">
            <span className="text-xs font-semibold tracking-[1px] uppercase text-ink-2">{x.label}</span>
            <span className="text-2xl font-extrabold break-words">{x.value}</span>
          </div>
        ))}
      </section>
      <p className="m-0 text-[13px] text-ink-2">
        {A.sheetNote}
        {data.totals.noCost > 0 && <> {fmt(A.noCost, { n: data.totals.noCost })}</>}
      </p>
    </div>
  );
}
