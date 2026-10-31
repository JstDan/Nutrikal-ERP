"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { fmt, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { COLUMN_COLORS, columnName, type BoardColumn, type BoardData, type ColumnColor, type TemplateOption } from "@/lib/tasks-shared";
import { taskOp } from "@/app/task-actions";
import { COLUMN_ACCENT } from "@/components/tasks/board";

type T = Dict["tasks"];
type Props = {
  orderId: string; data: BoardData; T: T; locale: Locale; isAdmin: boolean; templates: TemplateOption[];
  startWithNew: boolean; onClose: () => void;
};

/** Columns of an order's board: order, names, colour, hidden, delete, new column. Admin may also save to the template. */
export function ColumnsDialog({ orderId, data, T, locale, isAdmin, templates, startWithNew, onClose }: Props) {
  const C = T.columnsDialog;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toTemplate, setToTemplate] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const columns = [...data.columns].sort((a, b) => a.position - b.position);
  const template = templates.find((x) => x.id === data.board.template_id);
  const templateName = template ? (locale === "en" ? template.name_en || template.name_bg : template.name_bg) : data.board.template_name;
  const canTemplate = isAdmin && !!data.board.template_id;
  const dispatch = columns.find((c) => c.system_key === "dispatch");

  useEffect(() => {
    (startWithNew ? newRef.current : closeRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, startWithNew]);

  const run = (op: Parameters<typeof taskOp>[1], args: Record<string, unknown>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await taskOp(orderId, op, { template: canTemplate && toTemplate, ...args });
      if (r.error) setError(r.error); else after?.();
    });
  const move = (c: BoardColumn, position: number) => run("moveColumn", { column: c.id, position });

  // new column
  const [bg, setBg] = useState("");
  const [en, setEn] = useState("");
  const [color, setColor] = useState<ColumnColor>("grey");
  const [before, setBefore] = useState(dispatch?.id ?? "");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(0,0,0,0.45)] p-0 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="columns-h" className="flex min-h-full w-full max-w-[720px] flex-col gap-4 bg-white p-4 shadow-2xl sm:min-h-0 sm:rounded-sm sm:p-6">
        <header className="flex items-center justify-between gap-3">
          <h2 id="columns-h" className="m-0 text-lg font-bold">{C.title}</h2>
          <button ref={closeRef} type="button" className="btn btn-outline" onClick={onClose}>{C.close}</button>
        </header>

        {canTemplate && (
          <fieldset className="m-0 flex flex-col gap-1 rounded-sm border border-line p-3">
            <legend className="px-1 text-sm font-semibold">{C.scope}</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="radio" name="scope" className="h-5 w-5 accent-ink" checked={!toTemplate} onChange={() => setToTemplate(false)} />
              {C.scopeOrder}
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="radio" name="scope" className="h-5 w-5 accent-ink" checked={toTemplate} onChange={() => setToTemplate(true)} />
              <span className="min-w-0 break-words">{fmt(C.scopeTemplate, { name: templateName ?? "" })}</span>
            </label>
            {toTemplate && <p className="m-0 text-xs text-ink-2">{C.scopeTemplateHint}</p>}
          </fieldset>
        )}

        {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
        <p className="m-0 text-xs text-ink-2">{C.dragHint}</p>

        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {columns.map((c, i) => (
            <li key={c.id} draggable onDragStart={(e) => { setDragId(c.id); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => { if (dragId && dragId !== c.id) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); const d = columns.find((x) => x.id === dragId); setDragId(null); if (d && d.id !== c.id) move(d, i + 1); }}
              style={{ borderTop: `4px solid ${COLUMN_ACCENT[c.color ?? "grey"]}` }}
              className={`rounded-sm border border-line ${dragId === c.id ? "opacity-50" : ""} ${c.hidden ? "bg-mist" : "bg-white"}`}>
              <ColumnRow key={`${c.id}-${c.name_bg}-${c.name_en}-${c.color}-${c.hidden}`} c={c} i={i} n={columns.length} others={columns.filter((x) => x.id !== c.id)}
                count={data.tasks.filter((t) => t.column_id === c.id).length} T={T} locale={locale} pending={pending}
                onMove={(p) => move(c, p)}
                onSave={(v) => run("updateColumn", { column: c.id, ...v })}
                onDelete={(moveTo) => run("deleteColumn", { column: c.id, moveTo })} />
            </li>
          ))}
        </ol>

        <form className="flex flex-col gap-3 rounded-sm border border-line p-3"
          onSubmit={(e) => { e.preventDefault(); run("addColumn", { board: data.board.id, name_bg: bg, name_en: en, color, before: before || null }, () => { setBg(""); setEn(""); }); }}>
          <h3 className="m-0 text-sm font-bold tracking-[1px] uppercase text-ink-2">{C.newColumn}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="field"><span>{C.nameBg} *</span>
              <input ref={newRef} className="input" value={bg} maxLength={80} required onChange={(e) => setBg(e.target.value)} />
            </label>
            <label className="field"><span>{C.nameEn}</span>
              <input className="input" value={en} maxLength={80} onChange={(e) => setEn(e.target.value)} />
            </label>
            <label className="field"><span>{C.color}</span>
              <select className="input" value={color} onChange={(e) => setColor(e.target.value as ColumnColor)}>
                {COLUMN_COLORS.map((x) => <option key={x} value={x}>{C.colors[x]}</option>)}
              </select>
            </label>
            <label className="field"><span>{C.before}</span>
              <select className="input" value={before} onChange={(e) => setBefore(e.target.value)}>
                {columns.map((x) => <option key={x.id} value={x.id}>{columnName(x, locale)}</option>)}
              </select>
            </label>
          </div>
          <button type="submit" className="btn btn-primary w-fit" disabled={pending || !bg.trim()}>{C.create}</button>
        </form>

        {isAdmin && templates.length > 0 && (
          <section aria-labelledby="columns-templates-h" className="flex flex-col gap-2">
            <h3 id="columns-templates-h" className="m-0 text-sm font-bold tracking-[1px] uppercase text-ink-2">{C.templates}</h3>
            <ul className="m-0 flex list-none flex-col p-0">
              {templates.map((x) => (
                <li key={x.id} className="flex min-h-11 items-center justify-between gap-3 border-b border-mist text-sm last:border-0">
                  <span className="min-w-0 break-words">{locale === "en" ? x.name_en || x.name_bg : x.name_bg}{x.is_default ? ` · ${T.templates.isDefault}` : ""}</span>
                  <a href={`/settings/templates/${x.id}`} className="btn btn-outline shrink-0">{C.edit}</a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function ColumnRow({ c, i, n, others, count, T, locale, pending, onMove, onSave, onDelete }: {
  c: BoardColumn; i: number; n: number; others: BoardColumn[]; count: number; T: T; locale: Locale; pending: boolean;
  onMove: (position: number) => void;
  onSave: (v: { name_bg: string; name_en: string; color: string | null; hidden: boolean }) => void;
  onDelete: (moveTo: string | null) => void;
}) {
  const C = T.columnsDialog;
  const [bg, setBg] = useState(c.name_bg);
  const [en, setEn] = useState(c.name_en ?? "");
  const [color, setColor] = useState<ColumnColor>(c.color ?? "grey");
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? "");
  const system = !!c.system_key;
  const changed = bg.trim() !== c.name_bg || en.trim() !== (c.name_en ?? "") || (!system && color !== (c.color ?? "grey"));
  const name = columnName(c, locale);
  const save = (hidden = c.hidden) => onSave({ name_bg: bg, name_en: en, color: system ? null : color, hidden });

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className="cursor-grab text-ink-2 select-none">⋮⋮</span>
        <span className="min-w-0 flex-1 font-semibold break-words">
          {system && <span role="img" aria-label={C.locked} title={C.locked}>🔒 </span>}
          {name} <span className="text-xs font-normal text-ink-2">· {count}</span>
          {c.hidden && <span className="ml-2 rounded-full bg-neutral-tint px-2 py-0.5 text-xs">{C.hidden}</span>}
        </span>
        <button type="button" aria-label={`${T.moveUp}: ${name}`} disabled={pending || i === 0} className="h-11 w-11 rounded-sm hover:bg-mist disabled:opacity-30" onClick={() => onMove(i)}>↑</button>
        <button type="button" aria-label={`${T.moveDown}: ${name}`} disabled={pending || i === n - 1} className="h-11 w-11 rounded-sm hover:bg-mist disabled:opacity-30" onClick={() => onMove(i + 2)}>↓</button>
        <button type="button" className="btn btn-outline" disabled={pending} onClick={() => save(!c.hidden)}>{c.hidden ? C.show : C.hide}</button>
      </div>
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="field"><span>{C.nameBg}</span>
          <input className="input" value={bg} maxLength={80} required onChange={(e) => setBg(e.target.value)} />
        </label>
        <label className="field"><span>{C.nameEn}</span>
          <input className="input" value={en} maxLength={80} onChange={(e) => setEn(e.target.value)} />
        </label>
        {!system ? (
          <label className="field"><span>{C.color}</span>
            <select className="input" value={color} onChange={(e) => setColor(e.target.value as ColumnColor)}>
              {COLUMN_COLORS.map((x) => <option key={x} value={x}>{C.colors[x]}</option>)}
            </select>
          </label>
        ) : <span className="hidden sm:block" />}
        {changed && <button type="submit" className="btn btn-primary w-fit sm:col-span-3" disabled={pending || !bg.trim()}>{T.panel.save}</button>}
      </form>
      {!system && (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-red-ink">{C.delete}</summary>
          <div className="flex flex-wrap items-end gap-3 pt-2">
            {count > 0 && (
              <label className="field min-w-0 flex-[1_1_200px]"><span>{C.moveTasksTo}</span>
                <select className="input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                  {others.map((x) => <option key={x.id} value={x.id}>{columnName(x, locale)}</option>)}
                </select>
              </label>
            )}
            <button type="button" className="btn btn-outline" disabled={pending} onClick={() => onDelete(count > 0 ? moveTo : null)}>
              {fmt(C.deleteColumn, { name })}
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
