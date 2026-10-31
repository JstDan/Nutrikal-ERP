import type { Tx } from "@/lib/db/engine";
import type { Locale } from "@/lib/i18n";

export type TodoKey = "tasks" | "payment" | "plan" | "purchases" | "batches" | "dispatch" | "balance" | "invoice";
export type TodoGroup = { key: TodoKey; total: number; items: { id: string; title: string; sub: string; href: string }[] };
type Row = { id: string; title: string; sub: string; total: number };

const LIMIT = 5;
const ORDER = `so.id, so.code as title, c.legal_name as sub, count(*) over ()::int as total
  from sales_orders so join clients c on c.id = so.client_id`;

/** Everything waiting for this person, in working order; empty groups are left out. */
export async function loadTodo(tx: Tx, role: string, locale: Locale): Promise<TodoGroup[]> {
  const admin = role === "admin";
  const orderLink = (id: string) => `/orders/${id}`;
  const queries: [TodoKey, string, unknown[], (id: string) => string][] = [
    ["tasks", `select t.id::text || '|' || b.sales_order_id::text as id, case when $1 = 'en' then coalesce(t.title_en, t.title) else t.title end as title,
                      so.code as sub, count(*) over ()::int as total
                 from order_tasks t join order_task_boards b on b.id = t.board_id join sales_orders so on so.id = b.sales_order_id
                where t.assignee_id = auth.uid() and t.status <> 'done' and so.status not in ('cancelled', 'closed')
                order by so.code`, [locale], (id) => { const [task, order] = id.split("|"); return `/orders/${order}?task=${task}`; }],
    ["payment", `select ${ORDER} where so.status = 'unpaid' order by so.created_at`, [], orderLink],
    ...(admin ? [
      ["plan", `select ${ORDER} where so.status = 'confirmed' and exists (
                  select 1 from sales_order_lines l where l.order_id = so.id and l.kind <> 'service'
                     and not exists (select 1 from manufacturing_orders m where m.sales_order_line_id = l.id and m.status <> 'cancelled'))
                order by so.created_at`, [], orderLink],
      ["purchases", `select r.id, case when $1 = 'bg' then coalesce(i.name_bg, i.name) else i.name end as title,
                            r.quantity::float || ' ' || i.base_unit as sub, count(*) over ()::int as total
                       from purchase_requests r join items i on i.id = r.item_id where r.status = 'open' order by r.created_at`,
        [locale], () => "/purchasing"],
      ["batches", `select l.id, case when $1 = 'bg' then coalesce(i.name_bg, i.name) else i.name end as title,
                          l.lot_number as sub, count(*) over ()::int as total
                     from lots l join items i on i.id = l.item_id
                    where l.qc_status = 'quarantine' and i.type = 'finished_good' order by l.created_at`, [locale], () => "/quality"],
      ["dispatch", `select ${ORDER} where so.status = 'ready' order by so.requested_date nulls last`, [], orderLink],
    ] as [TodoKey, string, unknown[], (id: string) => string][] : []),
    ["balance", `select ${ORDER} where so.status in ('in_production', 'ready', 'dispatched') and so.balance_received_on is null
                   and public.order_paid_in_two(so.id) order by so.created_at`, [], orderLink],
    ["invoice", `select ${ORDER} where so.status in ('dispatched', 'closed') and not exists (
                   select 1 from invoices i where i.order_id = so.id and i.kind = 'invoice' and i.purpose in ('full', 'final') and i.status = 'issued')
                 order by so.created_at`, [], orderLink],
  ];
  const groups: TodoGroup[] = [];
  for (const [key, sql, params, link] of queries) {
    const rows = (await tx.query<Row>(`${sql} limit ${LIMIT}`, params)).rows;
    if (rows.length) groups.push({ key, total: rows[0].total, items: rows.map((r) => ({ id: r.id, title: r.title, sub: r.sub, href: link(r.id) })) });
  }
  return groups;
}
