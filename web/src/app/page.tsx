import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { fmt, formatDate, formatNumber, formatQty } from "@/lib/i18n";
import { Card, Chip, Dot, Empty, PageHeader, TextLink } from "@/components/ui";
import { completeTask } from "./actions";
import { orderTone } from "@/lib/status";
import { loadTodo } from "@/lib/todo";

/** Open orders by status, in order. */
const PIPELINE = ["unpaid", "draft", "confirmed", "in_production", "ready", "dispatched"] as const;

export default async function Dashboard() {
  const { user, locale, t } = await requireStaff();

  const data = await withUser(user.id, async (tx) => {
    const clients = (await tx.query<{ status: string; n: number }>("select status, count(*)::int as n from clients group by status")).rows;
    // Orders (the overview has no prices and shows nothing to Production)
    const pipeline = (await tx.query<{ status: string; n: number }>("select status::text, count(*)::int as n from sales_order_overview group by status")).rows;
    const production = (await tx.query<{ id: string; code: string; status: string; client: string; client_id: string; total_packs: number; requested_date: string | null }>(
      `select id, code, status::text, client, client_id, total_packs, requested_date::text
         from sales_order_overview
        where status in ('confirmed', 'in_production', 'ready')
        order by (status = 'in_production') desc, requested_date nulls last, code`,
    )).rows;
    const low = (await tx.query<{ item_id: string; name: string; available: string; reorder_level: string; base_unit: string }>(
      `select s.item_id, case when $1 = 'bg' then coalesce(i.name_bg, s.name) else s.name end as name, s.available, s.reorder_level, s.base_unit
         from item_stock_summary s join items i on i.id = s.item_id where s.below_reorder_level order by 2`,
      [locale],
    )).rows;
    const expiring = (await tx.query<{ lot_id: string; lot_number: string; item_name: string; days_left: number; quantity: string; base_unit: string }>(
      `select e.lot_id, e.lot_number, case when $1 = 'bg' then coalesce(i.name_bg, e.item_name) else e.item_name end as item_name,
              e.days_left, e.quantity, i.base_unit
         from expiring_lots e join items i on i.id = e.item_id order by e.days_left`,
      [locale],
    )).rows;
    const quarantine = (await tx.query<{ n: number }>("select count(distinct lot_id)::int as n from stock_balances where qc_status = 'quarantine'")).rows[0].n;
    const adjustments = (await tx.query<{ n: number }>("select count(*)::int as n from stock_adjustment_requests where status = 'pending'")).rows[0].n;
    const tasks = (await tx.query<{ id: string; subject: string; due_at: string | null; client: string; client_id: string }>(
      `select a.id, a.subject, a.due_at::text, c.legal_name as client, c.id as client_id
         from activities a join clients c on c.id = a.client_id
        where a.type = 'task' and a.done_at is null and a.assigned_to = auth.uid()
        order by a.due_at nulls last limit 8`,
    )).rows;
    const todo = await loadTodo(tx, user.role, locale);
    return { clients, pipeline, production, low, expiring, quarantine, adjustments, tasks, todo };
  });

  const T = t.dashboard.todo;
  const count = (rows: { status: string; n: number }[], s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  const openOrders = PIPELINE.reduce((a, s) => a + count(data.pipeline, s), 0);
  const maxStage = Math.max(1, ...PIPELINE.map((s) => count(data.pipeline, s)));
  const alertTotal = data.low.length + data.expiring.length + data.quarantine;

  const kpis = [
    { label: t.dashboard.activeClients, value: count(data.clients, "active"), note: `${count(data.clients, "lead")} ${t.dashboard.leads}`, href: "/clients" },
    { label: t.dashboard.openOrders, value: openOrders, note: fmt(t.dashboard.ordersDraft, { n: count(data.pipeline, "unpaid") }), href: "/orders" },
    { label: t.dashboard.inProduction, value: count(data.pipeline, "in_production"), note: fmt(t.dashboard.ordersReady, { n: count(data.pipeline, "ready") }), href: "/orders?status=in_production" },
    { label: t.dashboard.stockAlerts, value: alertTotal, note: fmt(t.dashboard.alertsBreakdown, { low: data.low.length, exp: data.expiring.length, quar: data.quarantine }), href: "/inventory" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.dashboard.title}
        subtitle={`${formatDate(locale, new Date(), { weekday: "long", day: "numeric", month: "long" })} · ${t.dashboard.subtitle}`}
      />

      <Card title={T.title} id="todo-h">
        {data.todo.length === 0 && <Empty>{T.empty}</Empty>}
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
          {data.todo.map((g) => (
            <section key={g.key} aria-label={T.groups[g.key]} className="flex min-w-0 flex-col">
              <h3 className="m-0 flex items-baseline justify-between gap-3 border-b border-mist pb-2 text-sm font-bold">
                <span className="min-w-0 break-words">{T.groups[g.key]}</span><span>{g.total}</span>
              </h3>
              {g.items.map((x) => (
                <Link key={x.id + x.title} href={x.href} className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-2 border-b border-mist py-1 text-sm text-ink no-underline last:border-0 hover:underline">
                  <span className="font-semibold break-words">{x.title}</span><span className="min-w-0 break-words text-ink-2">{g.key === "reorder" ? fmt(T.reorderBy, { date: formatDate(locale, x.sub) }) : x.sub}</span>
                </Link>
              ))}
              {g.total > g.items.length && <span className="pt-1 text-xs text-ink-2">{fmt(T.more, { n: g.total - g.items.length })}</span>}
            </section>
          ))}
        </div>
      </Card>

      <section aria-label={t.dashboard.title} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="card flex flex-col gap-1.5 p-5 text-ink no-underline hover:border-line-strong">
            <span className="label">{k.label}</span>
            <span className="text-[30px] font-bold leading-tight">{k.value}</span>
            <span className="text-[13px] text-ink-2">{k.note}</span>
          </Link>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title={t.dashboard.production} id="prod-h" action={<TextLink href="/orders">{t.nav.orders} →</TextLink>}>
          {data.production.length === 0 ? (
            <Empty>{t.dashboard.noProduction}</Empty>
          ) : (
            <div className="flex flex-col">
              <div className="row hide-sm md:grid-cols-[100px_minmax(0,1.5fr)_100px_140px] lg:grid-cols-[100px_minmax(0,1.5fr)_100px_110px_140px] border-b border-mist pb-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2">
                <span>{t.orders.code}</span><span>{t.orders.client}</span><span>{t.orders.packs}</span><span className="hide-md">{t.orders.requested}</span><span>{t.orders.status}</span>
              </div>
              {data.production.map((o) => (
                <div key={o.id} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 md:grid-cols-[100px_minmax(0,1.5fr)_100px_140px] lg:grid-cols-[100px_minmax(0,1.5fr)_100px_110px_140px]">
                  <div className="min-w-0 md:contents">
                    <Link href={`/orders/${o.id}`} className="font-semibold text-ink">{o.code}</Link>
                    <Link href={`/clients/${o.client_id}`} className="block min-w-0 break-words text-ink md:inline">{o.client}</Link>
                  </div>
                  <span className="hide-sm">{formatNumber(locale, o.total_packs)}</span>
                  <span className="hide-sm hide-md">{formatDate(locale, o.requested_date)}</span>
                  <Chip tone={orderTone(o.status)}>{t.enums.orderStatus[o.status as "draft"]}</Chip>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={t.dashboard.alerts} id="alerts-h" action={<TextLink href="/inventory">{t.dashboard.toInventory} →</TextLink>}>
          {alertTotal === 0 && data.adjustments === 0 && <Empty>{t.dashboard.noAlerts}</Empty>}
          {data.low.map((a) => (
            <div key={a.item_id} className="flex gap-3 text-sm">
              <Dot tone="amber" />
              <div className="min-w-0">
                <div className="font-semibold">{a.name}</div>
                <div className="text-ink-2">{fmt(t.dashboard.belowReorder, { avail: formatQty(locale, a.available, a.base_unit), level: formatQty(locale, a.reorder_level, a.base_unit) })}</div>
              </div>
            </div>
          ))}
          {data.expiring.map((e) => (
            <div key={e.lot_id} className="flex gap-3 text-sm">
              <Dot tone={e.days_left < 0 ? "red" : "amber"} />
              <div className="min-w-0">
                <div className="font-semibold">{e.lot_number} · {e.item_name}</div>
                <div className="text-ink-2">{e.days_left < 0 ? t.inventory.flags.expired : fmt(t.dashboard.expiresIn, { days: e.days_left, qty: formatQty(locale, e.quantity, e.base_unit) })}</div>
              </div>
            </div>
          ))}
          {data.quarantine > 0 && (
            <div className="flex gap-3 text-sm">
              <Dot tone="neutral" />
              <div><div className="font-semibold">{fmt(t.dashboard.quarantine, { count: data.quarantine })}</div><div className="text-ink-2">{t.dashboard.quarantineNote}</div></div>
            </div>
          )}
          {data.adjustments > 0 && (
            <div className="flex gap-3 text-sm">
              <Dot tone="neutral" />
              <div><div className="font-semibold">{fmt(t.dashboard.pendingAdjustments, { count: data.adjustments })}</div><div className="text-ink-2">{t.dashboard.pendingAdjustmentsNote}</div></div>
            </div>
          )}
          {(data.quarantine > 0 || data.adjustments > 0) && <Link href="/inventory" className="btn btn-outline self-start">{t.dashboard.toInventory}</Link>}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title={t.dashboard.pipeline} id="pipe-h">
          <div className="grid grid-cols-[minmax(90px,130px)_minmax(0,1fr)_32px] items-center gap-3 text-sm">
            {PIPELINE.map((s) => {
              const n = count(data.pipeline, s);
              return (
                <div key={s} className="contents">
                  <Link href={`/orders?status=${s}`} className="text-ink">{t.enums.orderStatus[s]}</Link>
                  <span className="h-3 rounded-sm bg-mist" aria-hidden="true">
                    <span className={`block h-3 rounded-sm ${s === "in_production" ? "bg-green" : s === "confirmed" ? "bg-ink" : "bg-[#8a93a3]"}`} style={{ width: `${(n / maxStage) * 100}%` }} />
                  </span>
                  <span className="text-right font-semibold">{n}</span>
                </div>
              );
            })}
          </div>
          <p className="m-0 text-[13px] text-ink-2">{t.dashboard.pipelineNote}</p>
        </Card>

        <Card title={t.dashboard.tasks} id="tasks-h">
          {data.tasks.length === 0 && <Empty>{t.dashboard.noTasks}</Empty>}
          {data.tasks.map((task) => (
            <form key={task.id} action={completeTask} className="flex items-start gap-3 text-sm">
              <input type="hidden" name="id" value={task.id} />
              <button type="submit" aria-label={`✓ ${task.subject}`} className="mt-0.5 h-6 w-6 shrink-0 rounded-sm border border-line-strong bg-white hover:border-ink" />
              <span className="min-w-0">
                <span className="font-semibold">{task.subject}</span>
                <br />
                <Link href={`/clients/${task.client_id}`} className="text-ink-2">{task.client}</Link>
                <span className="text-ink-2">{task.due_at ? ` · ${formatDate(locale, task.due_at, { day: "numeric", month: "short" })}` : ""}</span>
              </span>
            </form>
          ))}
        </Card>
      </div>
    </div>
  );
}
