"use client";

import { useMemo, useState, type DragEvent } from "react";
import { fmt, formatDate } from "@/lib/i18n";
import { DUE_TONE, dueState, LABEL_HEX, type BoardCard } from "@/lib/boards-shared";
import { DueChip, LabelPills, type BoardCtx } from "@/components/boards/board-view";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const MAX_IN_DAY = 3;

/**
 * Due dates on a month: a card dragged onto a day takes that date (also from "No due date").
 * Phones get the same month as a list of days (seven columns would not fit).
 */
export function BoardCalendar({ ctx, cards }: { ctx: BoardCtx; cards: BoardCard[] }) {
  const { T, locale, today, canEdit } = ctx;
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;                 // Monday first
  const days = useMemo(() => Array.from({ length: Math.ceil((lead + new Date(y, m, 0).getDate()) / 7) * 7 },
    (_, i) => iso(new Date(y, m - 1, 1 - lead + i))), [y, m, lead]);
  const byDay = useMemo(() => {
    const map = new Map<string, BoardCard[]>();
    for (const c of cards) if (c.due_on) map.set(c.due_on, [...(map.get(c.due_on) ?? []), c]);
    return map;
  }, [cards]);
  const noDate = cards.filter((c) => !c.due_on && !c.done_at);
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale === "bg" ? "bg-BG" : "en-GB", { weekday: "short" }).format(new Date(2026, 10, 2 + i)));
  const title = new Intl.DateTimeFormat(locale === "bg" ? "bg-BG" : "en-GB", { month: "long", year: "numeric" }).format(first);
  const shift = (d: number) => setMonth(iso(new Date(y, m - 1 + d, 1)).slice(0, 7));
  const inMonth = (d: string) => d.startsWith(month);
  const drop = (e: DragEvent, day: string | null) => {
    e.preventDefault();
    const c = cards.find((x) => x.id === (dragId ?? e.dataTransfer.getData("text/plain")));
    setDragId(null); setOverDay(null);
    if (c && c.due_on !== day) ctx.setDue(c, day);
  };
  const chipFor = (c: BoardCard) => {
    const st = dueState(c.due_on, !!c.done_at, today);
    const cover = ctx.labelsOf(c)[0];
    return (
      <button key={c.id} type="button" draggable={canEdit} onClick={() => ctx.open(c.id)} aria-label={fmt(T.openCard, { title: c.title })}
        onDragStart={(e) => { setDragId(c.id); e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { setDragId(null); setOverDay(null); }}
        className={`flex min-h-7 w-full min-w-0 items-center gap-1 rounded px-1.5 text-left text-xs font-semibold shadow-[0_1px_1px_rgba(0,0,0,0.08)] transition-opacity ${
          st ? DUE_TONE[st] : "bg-white text-ink"} ${dragId === c.id ? "opacity-40" : ""} ${c.done_at ? "line-through" : ""}`}>
        {cover && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: LABEL_HEX[cover.color].bg }} />}
        <span className="min-w-0 truncate">{c.title}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-outline" aria-label={T.cal.prev} onClick={() => shift(-1)}>←</button>
        <button type="button" className="btn btn-outline" onClick={() => setMonth(today.slice(0, 7))}>{T.cal.today}</button>
        <button type="button" className="btn btn-outline" aria-label={T.cal.next} onClick={() => shift(1)}>→</button>
        <h2 className="m-0 ml-1 text-lg font-bold first-letter:uppercase">{title}</h2>
      </div>
      {canEdit && <p className="m-0 hidden text-xs text-ink-2 md:block">{T.cal.dropHint}</p>}

      {noDate.length > 0 && (
        <div className={`rounded-lg border border-dashed p-3 transition-colors ${overDay === "none" ? "border-ink bg-white" : "border-line-strong bg-white/60"}`}
          onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverDay("none"); } }} onDrop={(e) => drop(e, null)}>
          <h3 className="m-0 mb-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2">{T.cal.noDate} · {noDate.length}</h3>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(180px, 100%), 1fr))" }}>{noDate.map(chipFor)}</div>
        </div>
      )}

      {/* Wide screens: the month */}
      <div className="hidden overflow-hidden rounded-lg border border-line bg-white shadow-sm md:block">
        <div className="grid grid-cols-7 border-b border-line bg-mist/60">
          {weekdays.map((w) => <span key={w} className="px-2 py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2">{w}</span>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const many = list.length > MAX_IN_DAY && openDay !== d;
            return (
              <div key={d} onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverDay(d); } }} onDrop={(e) => drop(e, d)}
                className={`flex min-h-28 min-w-0 flex-col gap-1 border-r border-b border-mist p-1.5 transition-colors [&:nth-child(7n)]:border-r-0 ${
                  overDay === d ? "bg-ink/10" : inMonth(d) ? "bg-white" : "bg-canvas"}`}>
                <span className={`flex h-6 w-6 items-center justify-center self-end rounded-full text-xs font-semibold ${
                  d === today ? "bg-ink text-white" : inMonth(d) ? "text-ink" : "text-ink-2/60"}`}>{Number(d.slice(8))}</span>
                {(many ? list.slice(0, MAX_IN_DAY) : list).map(chipFor)}
                {many && (
                  <button type="button" className="min-h-6 rounded px-1 text-left text-xs font-semibold text-ink-2 hover:bg-mist" onClick={() => setOpenDay(d)}>
                    {fmt(T.cal.more, { n: list.length - MAX_IN_DAY })}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Phones: the days of the month that have cards */}
      <div className="flex flex-col gap-2 md:hidden">
        {days.filter((d) => inMonth(d) && byDay.get(d)?.length).map((d) => (
          <section key={d} className="rounded-lg border border-line bg-white p-3 shadow-sm">
            <h3 className={`m-0 mb-2 text-sm font-bold ${d === today ? "text-ink" : "text-ink-2"}`}>{formatDate(locale, d, { weekday: "long", day: "numeric", month: "long" })}</h3>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {byDay.get(d)!.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => ctx.open(c.id)} className="flex w-full min-w-0 flex-col gap-1 rounded-md border border-line p-2 text-left">
                    <span className={`text-sm font-semibold break-words ${c.done_at ? "line-through" : ""}`}>{c.title}</span>
                    <span className="flex flex-wrap items-center gap-2"><LabelPills labels={ctx.labelsOf(c)} T={T} /><DueChip card={c} ctx={ctx} /></span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!days.some((d) => inMonth(d) && byDay.get(d)?.length) && <p className="m-0 text-sm text-ink-2">{T.cal.empty}</p>}
      </div>
    </div>
  );
}
