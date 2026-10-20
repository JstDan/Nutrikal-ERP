import Link from "next/link";
import { requireRole } from "@/lib/session";
import { fmt } from "@/lib/i18n";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { historyFilter, loadHistory, PAGE_SIZE, show } from "@/lib/history";

export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const { user, locale, t } = await requireRole("admin");
  const H = t.history;
  const f = historyFilter(await searchParams);
  const rows = await loadHistory(user.id, f, PAGE_SIZE + 1, (f.page - 1) * PAGE_SIZE);
  const more = rows.length > PAGE_SIZE;
  const tables = Object.keys(t.enums.auditTable) as (keyof typeof t.enums.auditTable)[];
  const tableLabel = (k: string) => t.enums.auditTable[k as "items"] ?? k;
  const filter = { ...(f.table && { table: f.table }), ...(f.from && { from: f.from }), ...(f.to && { to: f.to }) };
  const qs = (page: number) => `/history?${new URLSearchParams({ ...filter, page: String(page) })}`;
  const when = (s: string) =>
    new Intl.DateTimeFormat(locale === "bg" ? "bg-BG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(s));
  const grid = "md:grid-cols-[150px_minmax(0,1fr)_minmax(0,2fr)] lg:grid-cols-[160px_130px_minmax(0,1fr)_minmax(0,2.2fr)]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={H.title}
        subtitle={H.subtitle}
        actions={<a href={`/history/export?${new URLSearchParams(filter)}`} className="btn btn-outline" download>{H.downloadCsv}</a>}
      />
      <form method="get" className="card flex flex-wrap items-end gap-4 p-5">
        <label className="field min-w-0 flex-[2_1_220px]"><span>{H.table}</span>
          <select name="table" defaultValue={f.table} className="input">
            <option value="">{H.allTables}</option>
            {tables.map((k) => <option key={k} value={k}>{tableLabel(k)}</option>)}
          </select>
        </label>
        <label className="field min-w-0 flex-[1_1_150px]"><span>{H.from}</span><input name="from" type="date" defaultValue={f.from} className="input" /></label>
        <label className="field min-w-0 flex-[1_1_150px]"><span>{H.to}</span><input name="to" type="date" defaultValue={f.to} className="input" /></label>
        <button type="submit" className="btn btn-primary">{H.show}</button>
      </form>

      <section aria-label={H.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`}>
          <span>{H.when}</span><span className="hide-md">{H.user}</span><span>{H.record}</span><span>{H.changes}</span>
        </div>
        {rows.length === 0 && <div className="py-4"><Empty>{H.empty}</Empty></div>}
        {rows.slice(0, PAGE_SIZE).map((r) => {
          const changes = Object.entries(r.changes ?? {});
          return (
            <div key={r.id} className={`row border-b border-mist py-3 text-sm last:border-0 ${grid}`}>
              <span className="text-ink-2">
                {when(r.changed_at)}
                <span className="block lg:hidden">{r.user_name ?? H.system}</span>
              </span>
              <span className="hide-md min-w-0 break-words">{r.user_name ?? H.system}</span>
              <span className="min-w-0 break-words">
                <span className="font-semibold">{r.label ?? "—"}</span>
                <span className="block text-xs text-ink-2">{tableLabel(r.table_name)} · {t.enums.auditAction[r.action]}</span>
              </span>
              <span className="min-w-0 break-words text-[13px]">
                {r.action === "INSERT" && <Chip tone="green">{H.created}</Chip>}
                {r.action === "DELETE" && <Chip tone="red">{H.deleted}</Chip>}
                {changes.slice(0, 4).map(([k, [a, b]]) => (
                  <span key={k} className="block">
                    <span className="text-ink-2">{k}:</span> {show(a)} → <strong>{show(b)}</strong>
                  </span>
                ))}
                {changes.length > 4 && <span className="block text-ink-2">{fmt(H.more, { n: changes.length - 4 })}</span>}
              </span>
            </div>
          );
        })}
      </section>
      {(f.page > 1 || more) && (
        <nav className="flex flex-wrap gap-2">
          {f.page > 1 && <Link href={qs(f.page - 1)} className="btn btn-outline">{H.newer}</Link>}
          {more && <Link href={qs(f.page + 1)} className="btn btn-outline">{H.older}</Link>}
        </nav>
      )}
    </div>
  );
}
