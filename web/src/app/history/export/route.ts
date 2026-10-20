import { getSession } from "@/lib/session";
import { historyFilter, loadHistory } from "@/lib/history";

// CSV of the change history (one line per changed field); opens in Excel.
export async function GET(request: Request) {
  const { user, t } = await getSession();
  if (user.role !== "admin") return new Response("Forbidden", { status: 403 });
  const f = historyFilter(Object.fromEntries(new URL(request.url).searchParams));
  const rows = await loadHistory(user.id, f, 20000, 0);
  const H = t.history;
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [[H.when, H.user, H.table, H.action, H.record, H.field, H.before, H.after].map(cell).join(";")];
  for (const r of rows) {
    const base = [r.changed_at, r.user_name ?? H.system, t.enums.auditTable[r.table_name as "items"] ?? r.table_name, t.enums.auditAction[r.action], r.label];
    const changes = Object.entries(r.changes ?? {});
    if (changes.length === 0) lines.push([...base, "", "", ""].map(cell).join(";"));
    for (const [k, [a, b]] of changes) lines.push([...base, k, a, b].map(cell).join(";"));
  }
  const name = `nutrikal-history${f.from ? `-${f.from}` : ""}${f.to ? `_${f.to}` : ""}.csv`;
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
