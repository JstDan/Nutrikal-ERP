import Link from "next/link";
import { Card, Empty, PageHeader } from "@/components/ui";
import { QualityTabs } from "@/components/quality-tabs";
import { q } from "@/lib/db/engine";
import { fmt, formatPrice, formatQty } from "@/lib/i18n";
import { requireRole } from "@/lib/session";

type Row = { product: string; product_bg: string | null; item: string; item_bg: string | null; base_unit: string; reason: string; batches: number; quantity: string; value: string };
const PERIODS = [3, 6, 12] as const;

/** How much material goes above plan, and why: scrap above all. */
export default async function LossesPage({ searchParams }: PageProps<"/quality/losses">) {
  const { user, locale, t } = await requireRole("admin");
  const L = t.losses;
  const R = { ...t.factory.order.reasons, other: t.factory.order.reasonOther, none: L.none };
  const sp = await searchParams;
  const months = PERIODS.find((m) => String(m) === sp.months) ?? 12;
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - months);
  const rows = await q<Row>(user.id, "select product, product_bg, item, item_bg, base_unit, reason, batches, quantity::text, value::text from mo_loss_report($1, $2)",
    [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)]);
  const bg = locale === "bg";
  const total = rows.reduce((a, x) => a + Number(x.value), 0);
  const byReason = [...rows.reduce((m, x) => m.set(x.reason, (m.get(x.reason) ?? 0) + Number(x.value)), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const byProduct = [...rows.reduce((m, x) => {
    const name = bg && x.product_bg ? x.product_bg : x.product;
    return m.set(name, (m.get(name) ?? 0) + Number(x.value));
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const share = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const line = (key: string, label: string, value: number) => (
    <div key={key} className="flex flex-col gap-1 border-b border-mist py-2 text-sm last:border-0">
      <span className="flex justify-between gap-3"><span className="min-w-0 break-words font-semibold">{label}</span><span className="text-right">{formatPrice(locale, value)} · {share(value)} %</span></span>
      <span aria-hidden="true" className="p-bar !mt-0"><span style={{ width: `${share(value)}%` }} /></span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={L.title} subtitle={L.subtitle} />
      <QualityTabs t={t} active="losses" show />
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((m) => <Link key={m} href={`/quality/losses?months=${m}`} aria-current={m === months ? "page" : undefined} className={`btn ${m === months ? "btn-primary" : "btn-outline"}`}>{fmt(L.months, { n: m })}</Link>)}
      </div>
      {rows.length === 0 ? <Card><Empty>{L.empty}</Empty></Card> : (
        <>
          <Card title={fmt(L.total, { value: formatPrice(locale, total) })}>
            <div className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-2">
              <section className="min-w-0"><h3 className="label m-0 pb-1">{L.byReason}</h3>{byReason.map(([k, v]) => line(k, R[k as keyof typeof R] ?? k, v))}</section>
              <section className="min-w-0"><h3 className="label m-0 pb-1">{L.byProduct}</h3>{byProduct.map(([k, v]) => line(k, k, v))}</section>
            </div>
          </Card>
          <Card title={L.details}>
            {rows.map((x, i) => (
              <div key={i} className="row grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-mist py-2 text-sm last:border-0">
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold break-words">{bg && x.item_bg ? x.item_bg : x.item}</span>
                  <span className="text-xs text-ink-2 break-words">{bg && x.product_bg ? x.product_bg : x.product} · {R[x.reason as keyof typeof R] ?? x.reason} · {fmt(L.batches, { n: x.batches })}</span>
                </span>
                <span className="flex flex-col items-end text-right"><span className="font-semibold">{formatPrice(locale, x.value)}</span><span className="text-xs text-ink-2">{formatQty(locale, x.quantity, x.base_unit)}</span></span>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
