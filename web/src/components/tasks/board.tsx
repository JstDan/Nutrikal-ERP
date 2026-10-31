"use client";

import { useEffect, useMemo, useState, useTransition, type DragEvent } from "react";
import type { Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { fmt } from "@/lib/i18n";
import {
  blockersOf, blockingOf, columnName, columnTasks, initials, nextUp, stages, taskTitle, visibleColumns,
  type BoardData, type BoardTask, type TemplateOption,
} from "@/lib/tasks-shared";
import { taskOp } from "@/app/task-actions";
import { TaskPanel } from "@/components/tasks/task-panel";
import { ColumnsDialog } from "@/components/tasks/columns-dialog";

type T = Dict["tasks"];
type Filter = "all" | "mine" | "waiting" | "blocked";

export const COLUMN_ACCENT: Record<string, string> = {
  grey: "#8a93a3", blue: "#3b6fd8", purple: "#8a5cd6", orange: "#e0761a", teal: "#1f9e94",
};

/** The short state of an automatic task shown on its card. */
export function noteText(note: BoardTask["note"], T: T): string | null {
  if (!note) return null;
  const N = T.notes;
  const n = (k: string) => String(note[k] ?? "");
  switch (note.key) {
    case "materials": {
      const short = Number(note.total ?? 0) - Number(note.ok ?? 0);
      return short > 0 ? fmt(N.materials, { ok: n("ok"), total: n("total"), short }) : fmt(N.materialsOk, { total: n("total") });
    }
    case "recipes": case "requests": case "reserved": case "mos":
      return fmt(N[note.key], { n: n("n"), total: n("total") });
    case "materials_unlinked": case "not_planned": case "no_packaging": case "batch_in_production": case "in_quarantine": case "coa_missing":
      return N[note.key];
    default:
      return null;
  }
}

type Props = {
  orderId: string; locale: Locale; userId: string; isAdmin: boolean; data: BoardData; T: T;
  templates: TemplateOption[]; initialTask: string | null; realtime: { url: string; key: string } | null;
};

/** The board of an order: filters, stage progress, columns of tasks (accordion on phones), task panel. */
export function TaskBoard({ orderId, locale, userId, isAdmin, data, T, templates, initialTask, realtime }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [hideDone, setHideDone] = useState(true);
  // Automatic tasks tick themselves: shown on request
  const [showAuto, setShowAuto] = useState(false);
  const [openTask, setOpenTask] = useState<string | null>(initialTask && data.tasks.some((t) => t.id === initialTask) ? initialTask : null);
  const [columnsOpen, setColumnsOpen] = useState<false | "list" | "new">(false);
  const [adding, setAdding] = useState<string | null>(null);   // column id of the inline "+ Task" form, or "top"
  const [dragId, setDragId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const cols = useMemo(() => visibleColumns(data.columns), [data.columns]);
  const blockers = useMemo(() => blockersOf(data), [data]);
  const blocking = useMemo(() => blockingOf(data), [data]);
  const stageList = useMemo(() => stages(data), [data]);
  const next = useMemo(() => nextUp(data), [data]);
  const users = useMemo(() => new Map(data.users.map((u) => [u.id, u])), [data.users]);
  const activeId = stageList.find((s) => s.state === "active")?.column.id ?? null;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => expanded[id] ?? id === activeId;

  // The open task stays in the address (?task=…) so it can be shared and reopened
  useEffect(() => {
    const url = new URL(window.location.href);
    if (openTask) url.searchParams.set("task", openTask); else url.searchParams.delete("task");
    window.history.replaceState(null, "", url);
  }, [openTask]);

  const run = (op: Parameters<typeof taskOp>[1], args: Record<string, unknown>, after?: (id?: string) => void) =>
    start(async () => {
      setError(null);
      const r = await taskOp(orderId, op, args);
      if (r.error) setError(r.error);
      else after?.(r.id);
    });

  const counts = (t: BoardTask) => ({
    check: data.checklist.filter((c) => c.task_id === t.id),
    files: data.files.filter((f) => f.task_id === t.id).length,
    comments: data.comments.filter((c) => c.task_id === t.id && !c.deleted_at),
    unread: data.comments.some((c) => c.task_id === t.id && !c.deleted_at && c.author_id !== userId
      && (!data.reads[t.id] || c.created_at > data.reads[t.id])),
  });

  const shown = (t: BoardTask) => {
    if (!showAuto && t.kind === "auto") return false;
    if (filter === "mine" && t.assignee_id !== userId) return false;
    if (filter === "waiting" && t.status !== "waiting") return false;
    if (filter === "blocked" && !blockers.has(t.id)) return false;
    return true;
  };

  const drop = (e: DragEvent, columnId: string, before: BoardTask | null) => {
    e.preventDefault();
    e.stopPropagation();
    const id = dragId ?? e.dataTransfer.getData("text/plain");
    setDragId(null);
    const task = data.tasks.find((t) => t.id === id);
    if (!task || task.kind === "auto" || task.id === before?.id) return;
    run("moveTask", { task: task.id, column: columnId, position: before ? before.position : null });
  };

  const titleOf = (t: BoardTask) => taskTitle(t, locale);
  // The round tick of a manual task: done <-> to do (the database refuses it while the task is blocked)
  const toggle = (t: BoardTask) => run("setStatus", { task: t.id, status: t.status === "done" ? "todo" : "done" });
  // Automatic tasks: admin marks them by hand with a reason (as in the task panel)
  const override = (t: BoardTask, reason: string) => run("override", { task: t.id, done: t.status !== "done", reason });
  const filters: Filter[] = ["all", "mine", "waiting", "blocked"];
  const current = openTask ? data.tasks.find((t) => t.id === openTask) ?? null : null;

  return (
    <section aria-labelledby="tasks-h" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="tasks-h" className="sr-only">{T.title}</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline" onClick={() => setColumnsOpen("list")}>{T.columns}</button>
          <button type="button" className="btn btn-primary" onClick={() => setAdding("top")}>{T.addTask}</button>
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-sm border border-line bg-white p-3 text-sm">
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
          <strong>{T.next}</strong>
          {next.tasks.length === 0 ? <span>{T.nextNone}</span> : next.tasks.map((t, i) => (
            <span key={t.id} className="inline-flex items-center">
              <button type="button" className="min-h-11 text-left break-words underline" onClick={() => setOpenTask(t.id)}>{titleOf(t)}</button>
              {i < next.tasks.length - 1 && <span aria-hidden="true" className="px-1 text-ink-2">·</span>}
            </span>
          ))}
        </p>
        {next.dispatchBlockers > 0 && <p className="m-0 text-xs font-semibold text-amber-ink">{fmt(T.dispatchBlocked, { n: next.dispatchBlockers })}</p>}
      </div>

      <div role="group" aria-label={T.filtersLabel} className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${filter === f ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink"}`}>
            {T.filters[f]}
          </button>
        ))}
        <button type="button" aria-pressed={hideDone} onClick={() => setHideDone((v) => !v)}
          className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${hideDone ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink"}`}>
          {T.filters.hideDone}
        </button>
        <button type="button" aria-pressed={showAuto} onClick={() => setShowAuto((v) => !v)}
          className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${showAuto ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink"}`}>
          {fmt(T.filters.showAuto, { n: data.tasks.filter((t) => t.kind === "auto").length })}
        </button>
      </div>

      <ol aria-label={T.stagesLabel} className="m-0 flex list-none flex-wrap gap-2 p-0">
        {stageList.map((s) => (
          <li key={s.column.id}>
            <span className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${
              s.state === "done" ? "bg-green-tint text-green-ink" : s.state === "active" ? "bg-ink text-white" : "bg-neutral-tint text-ink-2"}`}>
              {s.state === "done" && <span aria-hidden="true">✓</span>}
              {columnName(s.column, locale)} · {s.done}/{s.total}
              <span className="sr-only">({s.state === "done" ? T.stageDone : s.state === "active" ? T.stageActive : T.stageNotStarted})</span>
            </span>
          </li>
        ))}
      </ol>

      {adding === "top" && (
        <NewTask T={T} columns={cols.map((c) => ({ id: c.id, name: columnName(c, locale) }))} defaultColumn={activeId ?? cols[0]?.id}
          pending={pending} onCancel={() => setAdding(null)}
          onAdd={(column, title) => run("addTask", { column, title }, (id) => { setAdding(null); if (id) setOpenTask(id); })} />
      )}
      {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(264px, 100%), 1fr))" }}>
        {cols.map((c) => {
          const { done, open } = columnTasks(data.tasks, c.id);
          const st = stageList.find((s) => s.column.id === c.id)!;
          const name = columnName(c, locale);
          const openHere = isOpen(c.id);
          const visibleOpen = open.filter(shown);
          const visibleDone = hideDone || filter === "waiting" || filter === "blocked" ? [] : done.filter(shown);
          // Stages with nothing to do by hand stay out of the way (the stage strip above still shows them)
          if (!showAuto && visibleOpen.length === 0 && visibleDone.length === 0 && adding !== c.id) return null;
          return (
            <section key={c.id} aria-label={name}
              className="card flex min-w-0 flex-col gap-2 p-3"
              style={c.color ? { borderTop: `4px solid ${COLUMN_ACCENT[c.color]}` } : undefined}
              onDragOver={(e) => { if (dragId) e.preventDefault(); }}
              onDrop={(e) => drop(e, c.id, null)}>
              {/* Phone: a stage opens and closes; wider screens show every stage */}
              <button type="button" aria-expanded={openHere} onClick={() => setExpanded((x) => ({ ...x, [c.id]: !openHere }))}
                className="flex min-h-11 w-full items-center justify-between gap-2 text-left md:hidden">
                <span className="font-bold break-words">{st.state === "done" && <span aria-hidden="true" className="text-green-ink">✓ </span>}{name}</span>
                <span className="shrink-0 text-xs text-ink-2">{st.done}/{st.total} <span aria-hidden="true">{openHere ? "▴" : "▾"}</span></span>
              </button>
              <h3 className="m-0 hidden items-center justify-between gap-2 text-base font-bold md:flex">
                <span className="min-w-0 break-words">{name}</span>
                <span className="shrink-0 text-xs font-semibold text-ink-2">{st.done}/{st.total}</span>
              </h3>

              <div className={`${openHere ? "flex" : "hidden"} min-w-0 flex-col gap-2 md:flex`}>
                {visibleDone.map((t) => (
                  <div key={t.id} onClick={(e) => { if (!fromControl(e.target)) setOpenTask(t.id); }}
                    className="flex min-h-11 w-full cursor-pointer items-center gap-1 rounded-sm pr-2 text-sm text-ink-2 hover:bg-mist">
                    <Tick task={t} title={titleOf(t)} T={T} blocked={false} pending={pending} isAdmin={isAdmin}
                      onToggle={() => toggle(t)} onOverride={(r) => override(t, r)} />
                    <button type="button" onClick={() => setOpenTask(t.id)} aria-label={fmt(T.open, { title: titleOf(t) })}
                      className="min-h-11 min-w-0 flex-1 text-left break-words line-through decoration-ink-2/40">
                      {titleOf(t)}
                    </button>
                  </div>
                ))}
                {visibleOpen.map((t) => (
                  <TaskCard key={t.id} task={t} T={T} locale={locale} title={titleOf(t)} counts={counts(t)}
                    assignee={t.assignee_id ? users.get(t.assignee_id)?.full_name ?? null : null}
                    links={data.links.filter((l) => l.task_id === t.id).slice(0, 2)}
                    blockers={(blockers.get(t.id) ?? []).map(titleOf)} blocking={(blocking.get(t.id) ?? []).map(titleOf)}
                    columns={cols.filter((x) => x.id !== c.id).map((x) => ({ id: x.id, name: columnName(x, locale) }))}
                    first={open[0]?.id === t.id} last={open[open.length - 1]?.id === t.id}
                    onOpen={() => setOpenTask(t.id)} onToggle={() => toggle(t)} onOverride={(r) => override(t, r)} pending={pending} isAdmin={isAdmin}
                    onDragStart={(e) => { setDragId(t.id); e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => setDragId(null)}
                    onDrop={(e) => drop(e, c.id, t)}
                    onMove={(column) => run("moveTask", { task: t.id, column, position: null })}
                    onShift={(delta) => {
                      const i = open.findIndex((x) => x.id === t.id);
                      const target = open[i + delta];
                      if (target) run("moveTask", { task: t.id, column: c.id, position: target.position });
                    }} />
                ))}
                {visibleOpen.length === 0 && visibleDone.length === 0 && <p className="m-0 px-2 text-sm text-ink-2">{T.emptyColumn}</p>}
                {adding === c.id ? (
                  <NewTask T={T} pending={pending} onCancel={() => setAdding(null)}
                    onAdd={(_, title) => run("addTask", { column: c.id, title }, (id) => { setAdding(null); if (id) setOpenTask(id); })} />
                ) : (
                  <button type="button" onClick={() => setAdding(c.id)}
                    className="flex min-h-11 w-full items-center rounded-sm px-2 text-left text-sm font-semibold text-ink-2 hover:bg-mist">
                    {T.addTask}
                  </button>
                )}
              </div>
            </section>
          );
        })}
        <button type="button" onClick={() => setColumnsOpen("new")}
          className="flex min-h-24 items-center justify-center rounded border-2 border-dashed border-line-strong p-4 text-sm font-semibold text-ink-2 hover:bg-white">
          {T.addColumn}
        </button>
      </div>

      {current && (
        <TaskPanel key={current.id} orderId={orderId} task={current} data={data} T={T} locale={locale} userId={userId} isAdmin={isAdmin}
          realtime={realtime} onClose={() => setOpenTask(null)} onOpenTask={setOpenTask} />
      )}
      {columnsOpen && (
        <ColumnsDialog orderId={orderId} data={data} T={T} locale={locale} isAdmin={isAdmin} templates={templates}
          startWithNew={columnsOpen === "new"} onClose={() => setColumnsOpen(false)} />
      )}
    </section>
  );
}

function NewTask({ T, columns, defaultColumn, pending, onAdd, onCancel }: {
  T: T; columns?: { id: string; name: string }[]; defaultColumn?: string; pending: boolean;
  onAdd: (column: string, title: string) => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [column, setColumn] = useState(defaultColumn ?? "");
  return (
    <form className="flex flex-col gap-2 rounded-sm border border-line p-2"
      onSubmit={(e) => { e.preventDefault(); if (title.trim()) onAdd(column, title.trim()); }}>
      {columns && (
        <label className="field"><span>{T.column}</span>
          <select className="input" value={column} onChange={(e) => setColumn(e.target.value)}>
            {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      <label className="field"><span>{T.taskTitle}</span>
        <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300}
          onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending || !title.trim()}>{T.add}</button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>{T.cancel}</button>
      </div>
    </form>
  );
}

type CardProps = {
  task: BoardTask; T: T; locale: Locale; title: string; assignee: string | null;
  counts: { check: { done: boolean }[]; files: number; comments: unknown[]; unread: boolean };
  links: { id: string; label: string; href: string | null; entity_type: string }[];
  blockers: string[]; blocking: string[]; columns: { id: string; name: string }[]; first: boolean; last: boolean;
  onOpen: () => void; onToggle: () => void; onOverride: (reason: string) => void; pending: boolean; isAdmin: boolean;
  onDragStart: (e: DragEvent) => void; onDragEnd: () => void; onDrop: (e: DragEvent) => void;
  onMove: (column: string) => void; onShift: (delta: number) => void;
};

/** A click on a card opens the task, except on its own buttons, links and menus. */
const fromControl = (target: EventTarget) =>
  target instanceof Element && !!target.closest("button, a, summary, details, form, input, select, textarea, label");

/**
 * Round tick: grey ring while open, green when done. Manual tasks toggle with it. Automatic ones tick
 * themselves: admin marks them by hand with a reason (the guard against a misclick); others only see it.
 */
function Tick({ task: t, title, T, blocked, pending, isAdmin, onToggle, onOverride }: {
  task: BoardTask; title: string; T: T; blocked: boolean; pending: boolean; isAdmin: boolean;
  onToggle: () => void; onOverride: (reason: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const done = t.status === "done";
  const circle = (
    <span aria-hidden="true" className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-[13px] leading-none font-bold ${
      done ? "border-green bg-green text-white" : "border-[#8a93a3] bg-paper text-transparent"}`}>✓</span>
  );
  if (t.kind === "auto") {
    const rule = `${t.auto_rule ? T.rules[t.auto_rule as keyof T["rules"]] : T.auto} (${T.status[t.status]})`;
    if (!isAdmin) return <span role="img" aria-label={rule} title={rule} className="flex h-11 w-11 shrink-0 items-center justify-center">{circle}</span>;
    const label = fmt(done ? T.tickUndo : T.tickDone, { title });
    return (
      <span className="relative shrink-0">
        <button type="button" role="checkbox" aria-checked={done} aria-label={label} title={rule} aria-expanded={asking}
          disabled={pending} onClick={() => setAsking((v) => !v)}
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full hover:bg-mist disabled:opacity-60">
          {circle}
        </button>
        {asking && (
          <form className="absolute left-0 z-20 mt-1 flex w-64 max-w-[calc(100vw-48px)] cursor-default flex-col gap-2 rounded-sm border border-line bg-white p-3 shadow-lg"
            onSubmit={(e) => { e.preventDefault(); if (reason.trim()) { onOverride(reason.trim()); setAsking(false); setReason(""); } }}>
            <p className="m-0 text-xs text-ink-2">{T.panel.overrideHint}</p>
            <label className="field"><span>{T.panel.overrideReason} *</span>
              <input className="input" autoFocus required value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setAsking(false); }} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn btn-primary" disabled={!reason.trim()}>{done ? T.panel.markNotDone : T.panel.markDone}</button>
              <button type="button" className="btn btn-outline" onClick={() => setAsking(false)}>{T.cancel}</button>
            </div>
          </form>
        )}
      </span>
    );
  }
  const label = blocked && !done ? fmt(T.tickBlocked, { title }) : fmt(done ? T.tickUndo : T.tickDone, { title });
  return (
    <button type="button" role="checkbox" aria-checked={done} aria-label={label} title={label}
      disabled={pending || (blocked && !done)} onClick={onToggle}
      className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-mist disabled:cursor-not-allowed disabled:opacity-60">
      {circle}
    </button>
  );
}

function TaskCard({ task: t, T, title, assignee, counts, links, blockers, blocking, columns, first, last, onOpen, onToggle, onOverride, pending, isAdmin, onDragStart, onDragEnd, onDrop, onMove, onShift }: CardProps) {
  const manual = t.kind === "manual";
  const note = noteText(t.note, T);
  const tone = t.status === "waiting" ? "bg-amber-tint text-amber-ink" : t.status === "in_progress" ? "bg-ink text-white" : "bg-neutral-tint text-ink";
  const checked = counts.check.filter((c) => c.done).length;
  return (
    <article draggable={manual} onDragStart={manual ? onDragStart : undefined} onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
      onClick={(e) => { if (!fromControl(e.target)) onOpen(); }}
      className={`flex min-w-0 cursor-pointer flex-col gap-2 rounded-sm border bg-white p-3 hover:border-line-strong ${blockers.length ? "border-red-line" : "border-line"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {!manual && <span title={T.auto} aria-label={T.auto} className="text-amber">⚡</span>}
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{T.status[t.status]}</span>
        {counts.unread && <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-ink"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-red" />{T.unread}</span>}
      </div>
      <div className="-ml-2 flex min-w-0 items-start gap-1">
        <Tick task={t} title={title} T={T} blocked={blockers.length > 0} pending={pending} isAdmin={isAdmin}
          onToggle={onToggle} onOverride={onOverride} />
        <button type="button" onClick={onOpen} aria-label={fmt(T.open, { title })}
          className="min-h-11 min-w-0 flex-1 text-left text-sm font-semibold break-words text-ink hover:underline">
          {title}
        </button>
      </div>
      {links.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {links.map((l) => (
            <span key={l.id} className="inline-flex rounded-full bg-neutral-tint px-2 py-0.5 text-xs font-semibold break-all">{l.label}</span>
          ))}
        </div>
      )}
      {note && <p className="m-0 text-xs text-ink-2">{note}</p>}
      {blockers.length > 0 && <p className="m-0 text-xs font-semibold text-red-ink">{fmt(T.blockedBy, { list: blockers.join(", ") })}</p>}
      {blocking.length > 0 && <p className="m-0 text-xs font-semibold text-red-ink">{fmt(T.blocks, { list: blocking.join(", ") })}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
        {assignee ? (
          <span title={fmt(T.assignedTo, { name: assignee })} className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">
            <span aria-hidden="true">{initials(assignee)}</span><span className="sr-only">{fmt(T.assignedTo, { name: assignee })}</span>
          </span>
        ) : null}
        {counts.check.length > 0 && <span aria-label={fmt(T.checklistCount, { done: checked, total: counts.check.length })}>☑ {checked}/{counts.check.length}</span>}
        {counts.files > 0 && <span aria-label={fmt(T.filesCount, { n: counts.files })}>📎 {counts.files}</span>}
        {counts.comments.length > 0 && <span aria-label={fmt(T.commentsCount, { n: counts.comments.length })}>💬 {counts.comments.length}</span>}
        {manual && (
          <details className="relative ml-auto">
            <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-sm px-2 text-xs font-semibold text-ink hover:bg-mist">{T.moveTo}</summary>
            <div className="absolute right-0 z-20 mt-1 flex w-56 max-w-[calc(100vw-48px)] flex-col rounded-sm border border-line bg-white p-1 shadow-lg">
              {!first && <button type="button" className="min-h-11 rounded-sm px-3 text-left text-sm hover:bg-mist" onClick={() => onShift(-1)}>{T.moveUp}</button>}
              {!last && <button type="button" className="min-h-11 rounded-sm px-3 text-left text-sm hover:bg-mist" onClick={() => onShift(1)}>{T.moveDown}</button>}
              {columns.map((c) => (
                <button key={c.id} type="button" className="min-h-11 rounded-sm px-3 text-left text-sm break-words hover:bg-mist" onClick={() => onMove(c.id)}>
                  {fmt(T.moveToColumn, { column: c.name })}
                </button>
              ))}
            </div>
          </details>
        )}
      </div>
    </article>
  );
}
