// Order Task Manager: loads an order's board as the signed-in user
// (row-level security: admin and sales only). Files of tasks live in the
// private bucket "order-task-files" ({order_id}/{task_id}/{uuid}-{name}).
import type { Tx } from "@/lib/db/engine";
import type { BoardData, LinkOption, TemplateOption } from "@/lib/tasks-shared";

export const TASK_BUCKET = "order-task-files";

const linkHref = (type: string, id: string, formulaId: string | null): string | null => {
  switch (type) {
    case "sales_order": return `/orders/${id}`;
    case "manufacturing_order": return `/production/${id}`;
    case "formula_version": return formulaId ? `/formulas/${formulaId}` : "/formulas";
    case "purchase_request": return "/purchasing";
    case "expected_delivery": return "/deliveries";
    case "lot": return "/qc";
    case "invoice": return `/invoices/${id}`;
    default: return null;
  }
};

export async function loadTemplates(tx: Tx): Promise<TemplateOption[]> {
  return (await tx.query<TemplateOption>(
    "select id, name_bg, name_en, is_default from order_task_templates where active order by is_default desc, name_bg")).rows;
}

/** The board of an order, or null when the order has none yet. */
export async function loadBoard(tx: Tx, orderId: string): Promise<BoardData | null> {
  const board = (await tx.query<BoardData["board"]>(
    `select b.id, b.payment_mode, b.template_id, t.name_bg as template_name
       from order_task_boards b left join order_task_templates t on t.id = b.template_id
      where b.sales_order_id = $1`, [orderId])).rows[0];
  if (!board) return null;
  const b = board.id;
  const sub = "select id from order_tasks where board_id = $1";
  const queries: [string, unknown[]?][] = [
    [`select id, system_key, name_bg, name_en, color, position, hidden from order_task_columns where board_id = $1 order by position`, [b]],
    [`select id, column_id, template_key, title, title_en, description, kind, auto_rule, status, assignee_id, position, note,
                     completed_at::text, override, override_reason, created_by
                from order_tasks where board_id = $1`, [b]],
    [`select id, task_id, text, text_en, done, position from order_task_checklist_items where task_id in (${sub}) order by position`, [b]],
    [`select task_id, depends_on_task_id from order_task_dependencies where task_id in (${sub})`, [b]],
    [`select l.id, l.task_id, l.entity_type, l.entity_id, l.label, l.is_auto, v.formula_id
                from order_task_links l left join formula_versions v on l.entity_type = 'formula_version' and v.id = l.entity_id
               where l.task_id in (${sub}) order by l.created_at`, [b]],
    [`select id, task_id, comment_id, name, size::int, mime, uploaded_by, created_at::text
                from order_task_files where deleted_at is null and task_id in (${sub}) order by created_at`, [b]],
    [`select id, task_id, author_id, body, mentions, created_at::text, edited_at::text, deleted_at::text
                from order_task_comments where task_id in (${sub}) order by created_at`, [b]],
    [`select task_id, last_read_at::text from order_task_reads where task_id in (${sub})`, [b]],
    [`select id::text, task_id, actor_id, action, payload, created_at::text from order_task_activity where task_id in (${sub}) order by id`, [b]],
    [`select id, full_name, role from profiles where is_active and role in ('admin', 'sales') order by full_name`],
    [`select id::text, checked_at::text, source, total, ok, lines, recipe_versions from order_task_material_checks
               where board_id = $1 order by id desc limit 12`, [b]],
    [`select 'manufacturing_order' as entity_type, mo.id as entity_id, mo.code as label
                from manufacturing_orders mo join sales_order_lines l on l.id = mo.sales_order_line_id where l.order_id = $1
              union all
              select 'formula_version', v.id, f.code || ' v' || v.version from sales_order_lines l
                join formula_versions v on v.id = l.formula_version_id join formulas f on f.id = v.formula_id where l.order_id = $1
              union all
              select 'invoice', i.id, coalesce(i.number, 'draft') from invoices i where i.order_id = $1
              union all
              select 'purchase_request', pr.id, pr.code from purchase_requests pr
               where pr.sales_order_id = $1 or pr.manufacturing_order_id in
                     (select mo.id from manufacturing_orders mo join sales_order_lines l on l.id = mo.sales_order_line_id where l.order_id = $1)
              union all
              select 'lot', lo.id, lo.lot_number from manufacturing_orders mo join sales_order_lines l on l.id = mo.sales_order_line_id
                join lots lo on lo.id = mo.finished_lot_id where l.order_id = $1`, [orderId]],
  ];
  // One round trip for all of them (the database is ≈100 ms away): each query becomes a JSON array
  // ($1 = the board, $2 = the order)
  const parts = queries.map(([sql, params], i) =>
    `(select coalesce(json_agg(x), '[]'::json) from (${params?.[0] === orderId ? sql.replaceAll("$1", "$2") : sql}) x) as q${i}`);
  const row = (await tx.query<Record<string, unknown[]>>(`select ${parts.join(",\n")}`, [b, orderId])).rows[0];
  const [columns, tasks, checklist, deps, links, files, comments, reads, activity, users, checks, linkOptions] = queries.map((_, i) => row[`q${i}`]);
  type LinkRow = BoardData["links"][number] & { formula_id: string | null };
  const firstVersion = (checks[0] as BoardData["checks"][number] | undefined)?.recipe_versions?.[0];
  const formulaId = firstVersion
    ? (await tx.query<{ formula_id: string }>("select formula_id from formula_versions where id = $1", [firstVersion.id])).rows[0]?.formula_id
    : null;
  return {
    board,
    columns: columns as BoardData["columns"],
    tasks: tasks as BoardData["tasks"],
    checklist: checklist as BoardData["checklist"],
    deps: deps as BoardData["deps"],
    links: (links as LinkRow[]).map(({ formula_id, ...l }) => ({ ...l, href: linkHref(l.entity_type, l.entity_id, formula_id) })),
    files: files as BoardData["files"],
    comments: comments as BoardData["comments"],
    reads: Object.fromEntries((reads as { task_id: string; last_read_at: string }[]).map((r) => [r.task_id, r.last_read_at])),
    activity: activity as BoardData["activity"],
    users: users as BoardData["users"],
    checks: checks as BoardData["checks"],
    linkOptions: linkOptions as LinkOption[],
    formulaHref: formulaId ? `/formulas/${formulaId}` : null,
  };
}
