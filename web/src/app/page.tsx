import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { fmt, formatDate, formatQty } from "@/lib/i18n";
import { Card, Chip, Dot, Empty, PageHeader, TextLink } from "@/components/ui";
import { completeTask } from "./actions";
import { projectTone } from "@/lib/status";

const PIPELINE = ["inquiry", "formulation", "offer", "order", "production"] as const;

export default async function Dashboard() {
  const { user, locale, t } = await requireStaff();

  const data = await withUser(user.id, async (tx) => {
    const clients = (await tx.query<{ status: string; n: number }>("select status, count(*)::int as n from clients group by status")).rows;
    const pipeline = (await tx.query<{ status: string; n: number }>("select status, count(*)::int as n from projects group by status")).rows;
    const production = (await tx.query<{ id: string; code: string; name: string; status: string; client: string; client_id: string; expected_units: number | null; target_date: string | null }>(
      `select p.id, p.code, p.name, p.status, c.legal_name as client, c.id as client_id, p.expected_units, p.target_date::text
         from projects p join clients c on c.id = p.client_id
        where p.status in ('order', 'production')
        order by (p.status = 'production') desc, p.target_date nulls last`,
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
    return { clients, pipeline, production, low, expiring, quarantine, adjustments, tasks };
  });

  const count = (rows: { status: string; n: number }[], s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  const openProjects = PIPELINE.reduce((a, s) => a + count(data.pipeline, s), 0);
  const maxStage = Math.max(1, ...PIPELINE.map((s) => count(data.pipeline, s)));
  const alertTotal = data.low.length + data.expiring.length + data.quarantine;

  const kpis = [
    { label: t.dashboard.activeClients, value: count(data.clients, "active"), note: `${count(data.clients, "lead")} ${t.dashboard.leads}`, href: "/clients" },
    { label: t.dashboard.openProjects, value: openProjects, note: t.dashboard.inPipeline, href: "/projects" },
    { label: t.dashboard.inProduction, value: count(data.pipeline, "production"), note: `${count(data.pipeline, "order")} ${t.dashboard.ordersWaiting}`, href: "/projects" },
    { label: t.dashboard.stockAlerts, value: alertTotal, note: fmt(t.dashboard.alertsBreakdown, { low: data.low.length, exp: data.expiring.length, quar: data.quarantine }), href: "/inventory" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.dashboard.title}
        subtitle={`${formatDate(locale, new Date(), { weekday: "long", day: "numeric", month: "long" })} · ${t.dashboard.subtitle}`}
      />

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
        <Card title={t.dashboard.production} id="prod-h" action={<TextLink href="/projects">{t.nav.projects} →</TextLink>}>
          {data.production.length === 0 ? (
            <Empty>{t.dashboard.noProduction}</Empty>
          ) : (
            <div className="flex flex-col">
              <div className="row hide-sm md:grid-cols-[96px_minmax(0,1.5fr)_110px_130px] lg:grid-cols-[96px_minmax(0,1.5fr)_minmax(0,1fr)_110px_130px] border-b border-mist pb-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2">
                <span>{t.projects.code}</span><span>{t.projects.name}</span><span className="hide-md">{t.projects.client}</span><span>{t.projects.units}</span><span>{t.projects.status}</span>
              </div>
              {data.production.map((p) => (
                <div key={p.id} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 md:grid-cols-[96px_minmax(0,1.5fr)_110px_130px] lg:grid-cols-[96px_minmax(0,1.5fr)_minmax(0,1fr)_110px_130px]">
                  <Link href={`/clients/${p.client_id}`} className="font-semibold text-ink">{p.code}</Link>
                  <span className="hide-sm min-w-0 break-words">{p.name}</span>
                  <span className="hide-sm hide-md min-w-0 break-words">{p.client}</span>
                  <span className="hide-sm">{p.expected_units ? `${p.expected_units.toLocaleString(locale === "bg" ? "bg-BG" : "en-GB")}` : "—"}</span>
                  <Chip tone={projectTone(p.status)}>{t.enums.projectStatus[p.status as keyof typeof t.enums.projectStatus]}</Chip>
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
          {(data.quarantine > 0 || data.adjustments > 0) && <Link href="/qc" className="btn btn-outline self-start">{t.dashboard.toQc}</Link>}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title={t.dashboard.pipeline} id="pipe-h">
          <div className="grid grid-cols-[minmax(90px,130px)_minmax(0,1fr)_32px] items-center gap-3 text-sm">
            {PIPELINE.map((s) => {
              const n = count(data.pipeline, s);
              return (
                <div key={s} className="contents">
                  <span>{t.enums.projectStatus[s]}</span>
                  <span className="h-3 rounded-sm bg-mist" aria-hidden="true">
                    <span className={`block h-3 rounded-sm ${s === "production" ? "bg-green" : s === "offer" ? "bg-ink" : "bg-[#8a93a3]"}`} style={{ width: `${(n / maxStage) * 100}%` }} />
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
