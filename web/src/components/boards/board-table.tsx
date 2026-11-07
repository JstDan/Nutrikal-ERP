"use client";

import { fmt } from "@/lib/i18n";
import { between, type BoardCard } from "@/lib/boards-shared";
import { UserAvatar } from "@/components/user-avatar";
import { DoneTick, DueChip, LabelPills, type BoardCtx } from "@/components/boards/board-view";

/** The cards as one list, by due date: tick, list and due date change right in the row. */
export function BoardTable({ ctx, cards }: { ctx: BoardCtx; cards: BoardCard[] }) {
  const { T, canEdit } = ctx;
  const listOf = new Map(ctx.lists.map((l, i) => [l.id, i]));
  const rows = [...cards].sort((a, b) =>
    (a.done_at ? 1 : 0) - (b.done_at ? 1 : 0) || (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999")
    || (listOf.get(a.list_id) ?? 0) - (listOf.get(b.list_id) ?? 0) || a.position - b.position);
  const grid = "grid-cols-[44px_minmax(0,1fr)] md:grid-cols-[44px_minmax(0,1fr)_170px_150px] lg:grid-cols-[44px_minmax(0,1fr)_170px_110px_170px]";
  const last = (list: string) => ctx.lists.length && Math.max(0, ...cards.filter((c) => c.list_id === list).map((c) => c.position));

  return (
    <div className="rounded-lg border border-line bg-white px-3 pb-2 shadow-sm sm:px-4">
      <div className={`row hide-sm ${grid} items-center border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2`}>
        <span /><span>{T.table.card}</span><span>{T.table.list}</span><span className="hide-md">{T.table.people}</span><span>{T.table.due}</span>
      </div>
      {rows.map((c) => (
        <div key={c.id} className={`row ${grid} items-center border-b border-mist py-1.5 last:border-0 ${c.done_at ? "opacity-70" : ""}`}>
          <DoneTick card={c} ctx={ctx} />
          <div className="flex min-w-0 flex-col gap-1 py-1">
            <button type="button" onClick={() => ctx.open(c.id)} aria-label={fmt(T.openCard, { title: c.title })}
              className={`min-h-9 text-left text-sm font-semibold break-words hover:underline ${c.done_at ? "text-ink-2 line-through" : "text-ink"}`}>{c.title}</button>
            <LabelPills labels={ctx.labelsOf(c)} T={T} />
            {/* Phones: the list and the date under the title */}
            <span className="flex flex-wrap items-center gap-2 text-xs text-ink-2 md:hidden">
              {ctx.lists.find((l) => l.id === c.list_id)?.name}<DueChip card={c} ctx={ctx} />
            </span>
          </div>
          <label className="field hide-sm"><span className="sr-only">{T.table.list}</span>
            <select className="input" value={c.list_id} disabled={!canEdit}
              onChange={(e) => ctx.move(c, e.target.value, between(last(e.target.value) || null, null))}>
              {ctx.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <span className="hide-md flex -space-x-1.5">
            {ctx.peopleOf(c).slice(0, 4).map((p) => <UserAvatar key={p.id} id={p.id} size={28} title={p.name} className="border-2 border-white" />)}
          </span>
          <label className="field hide-sm"><span className="sr-only">{T.table.due}</span>
            <input type="date" className="input" value={c.due_on ?? ""} disabled={!canEdit}
              onChange={(e) => ctx.setDue(c, e.target.value || null)} />
          </label>
        </div>
      ))}
      {rows.length === 0 && <p className="m-0 py-4 text-sm text-ink-2">{T.noCards}</p>}
    </div>
  );
}
