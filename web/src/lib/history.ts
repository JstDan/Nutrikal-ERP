// Change history from the audit log (Admin only; the database refuses others).
import { withUser } from "./db/engine";

export type AuditRow = {
  id: string; changed_at: string; table_name: string; action: "INSERT" | "UPDATE" | "DELETE"; row_id: string | null;
  user_name: string | null; label: string | null; changes: Record<string, [unknown, unknown]> | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const PAGE_SIZE = 50;

export function historyFilter(sp: Record<string, string | string[] | undefined>) {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  return {
    table: /^[a-z_]{1,64}$/.test(s("table")) ? s("table") : "",
    from: DATE.test(s("from")) ? s("from") : "",
    to: DATE.test(s("to")) ? s("to") : "",
    page: Math.max(1, Math.min(10000, Number.parseInt(s("page"), 10) || 1)),
  };
}

export async function loadHistory(userId: string, f: ReturnType<typeof historyFilter>, limit: number, offset: number) {
  return withUser(userId, async (tx) =>
    (await tx.query<AuditRow>(
      `select a.id::text, a.changed_at::text, a.table_name, a.action, a.row_id, p.full_name as user_name,
              coalesce(x->>'code', x->>'sku', x->>'lot_number', x->>'invoice_number', x->>'offer_no', x->>'name',
                       x->>'legal_name', x->>'full_name', x->>'key', a.row_id) as label,
              case when a.action = 'UPDATE' then (
                select jsonb_object_agg(k, jsonb_build_array(a.old_data -> k, a.new_data -> k))
                  from jsonb_object_keys(a.new_data) k
                 where k not in ('updated_at') and a.old_data -> k is distinct from a.new_data -> k
              ) end as changes
         from audit_log a
         left join profiles p on p.id = a.changed_by
         cross join lateral (select coalesce(a.new_data, a.old_data) as x) d
        where ($1 = '' or a.table_name = $1)
          and ($2 = '' or a.changed_at >= $2::date)
          and ($3 = '' or a.changed_at < $3::date + 1)
        order by a.changed_at desc, a.id desc
        limit $4 offset $5`,
      [f.table, f.from, f.to, limit, offset],
    )).rows,
  );
}

/** A changed value as short text. */
export function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}
