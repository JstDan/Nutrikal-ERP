"use client";

import { useEffect, useMemo, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { fmt, formatDate, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { boardOp, deleteBoardPart, type BoardOp } from "@/app/board-actions";
import {
  BOARD_HEX, between, DUE_TONE, dueState, LABEL_HEX,
  type BoardCard, type BoardData, type BoardLabel, type BoardList,
} from "@/lib/boards-shared";
import { CardPanel } from "@/components/boards/card-panel";
import { BoardSettings } from "@/components/boards/board-settings";
import { UserAvatar } from "@/components/user-avatar";

type T = Dict["boards"];
export type FileText = { tooBig: string; type: string; limits: string };
type Props = {
  data: BoardData; locale: Locale; userId: string; isAdmin: boolean; canEdit: boolean; T: T; today: string;
  initialCard: string | null; fileText: FileText;
};

/** A click on a card opens it, except on its own buttons, links and menus. */
const fromControl = (target: EventTarget) =>
  target instanceof Element && !!target.closest("button, a, summary, details, form, input, select, textarea, label");

export const labelText = (l: BoardLabel, T: T) => l.name || fmt(T.noLabelName, { color: T.colors[l.color] });

/** A board: filters, lists of cards side by side (wrapping, never sideways), the open card. */
export function BoardView({ data, locale, userId, isAdmin, canEdit, T, today, initialCard, fileText }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [mine, setMine] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [label, setLabel] = useState("");
  const [openCard, setOpenCard] = useState<string | null>(initialCard);
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);   // list id of the "+ card" form, or "list"
  const [drag, setDrag] = useState<{ kind: "card" | "list"; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The open card stays in the address (?card=…) so it can be shared and reopened
  useEffect(() => {
    const url = new URL(window.location.href);
    if (openCard) url.searchParams.set("card", openCard); else url.searchParams.delete("card");
    window.history.replaceState(null, "", url);
  }, [openCard]);

  // Others work on the board too: fresh data when the tab comes back
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [router]);

  const run = (op: BoardOp, args: Record<string, unknown>, after?: (id?: string) => void) =>
    start(async () => {
      setError(null);
      const r = await boardOp(data.board.id, op, args);
      if (r.error) setError(r.error); else after?.(r.id);
    });

  const names = useMemo(() => new Map([...data.people.map((p) => [p.id, p.full_name] as const), ...data.members.map((m) => [m.user_id, m.full_name] as const)]), [data]);
  const lists = data.lists.filter((l) => !l.archived_at);
  const cardsOf = (listId: string) => data.cards.filter((c) => c.list_id === listId && !c.archived_at).sort((a, b) => a.position - b.position);
  const peopleOf = (c: BoardCard) => data.cardMembers.filter((m) => m.card_id === c.id).map((m) => m.user_id);
  const labelsOf = (c: BoardCard) => data.cardLabels.filter((x) => x.card_id === c.id).map((x) => data.labels.find((l) => l.id === x.label_id)).filter(Boolean) as BoardLabel[];
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (c: BoardCard) => {
    if (hideDone && c.done_at) return false;
    if (mine && !peopleOf(c).includes(userId)) return false;
    if (label && !data.cardLabels.some((x) => x.card_id === c.id && x.label_id === label)) return false;
    const hay = `${c.title} ${c.description} ${c.client ?? ""} ${c.sales_order ?? ""} ${c.project ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };

  // ---- dragging: a card before another card or at the end of a list; a list before another list
  const dropCard = (e: DragEvent, list: BoardList, before: BoardCard | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (!drag || drag.kind !== "card") return;
    const id = drag.id;
    setDrag(null);
    if (before?.id === id) return;
    const rest = cardsOf(list.id).filter((c) => c.id !== id);
    const i = before ? rest.findIndex((c) => c.id === before.id) : rest.length;
    run("moveCard", { card: id, list: list.id, position: between(rest[i - 1]?.position, rest[i]?.position) });
  };
  const dropList = (e: DragEvent, before: BoardList) => {
    if (!drag || drag.kind !== "list") return;
    e.preventDefault();
    e.stopPropagation();
    const id = drag.id;
    setDrag(null);
    if (id === before.id) return;
    const rest = lists.filter((l) => l.id !== id);
    const i = rest.findIndex((l) => l.id === before.id);
    run("moveList", { list: id, position: between(rest[i - 1]?.position, rest[i]?.position) });
  };
  const shiftList = (l: BoardList, delta: -1 | 1) => {
    const rest = lists.filter((x) => x.id !== l.id);
    const i = lists.findIndex((x) => x.id === l.id) + delta;
    run("moveList", { list: l.id, position: between(rest[i - 1]?.position, rest[i]?.position) });
  };
  const shiftCard = (c: BoardCard, delta: -1 | 1) => {
    const all = cardsOf(c.list_id);
    const rest = all.filter((x) => x.id !== c.id);
    const i = all.findIndex((x) => x.id === c.id) + delta;
    run("moveCard", { card: c.id, list: c.list_id, position: between(rest[i - 1]?.position, rest[i]?.position) });
  };
  const toList = (c: BoardCard, list: string) => run("moveCard", { card: c.id, list, position: between(cardsOf(list).at(-1)?.position, null) });

  const archivedLists = data.lists.filter((l) => l.archived_at);
  const archivedCards = data.cards.filter((c) => c.archived_at);
  const current = openCard ? data.cards.find((c) => c.id === openCard) ?? null : null;
  const hex = BOARD_HEX[data.board.color] ?? BOARD_HEX.blue;

  return (
    <section aria-labelledby="board-h" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-sm p-4 text-white" style={{ background: hex }}>
        <div className="min-w-0">
          <h1 id="board-h" className="m-0 text-xl font-bold break-words">{data.board.name}</h1>
          {data.board.archived_at && <p className="m-0 text-sm font-semibold">{T.archived}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex -space-x-1.5" aria-label={fmt(T.onCard, { names: data.members.map((m) => m.full_name).join(", ") })}>
            {data.members.slice(0, 8).map((m) => (
              <UserAvatar key={m.user_id} id={m.user_id} size={32} title={m.full_name} className="border-2 border-white" />
            ))}
          </span>
          {canEdit && <button type="button" className="btn bg-white text-ink" onClick={() => setSettings(true)}>{T.settings}</button>}
        </div>
      </header>

      {!canEdit && <p className="m-0 text-sm text-ink-2">{T.readOnly}</p>}

      <div role="group" aria-label={T.filtersLabel} className="flex flex-wrap items-end gap-2">
        <label className="field min-w-0 flex-[1_1_220px]"><span className="sr-only">{T.search}</span>
          <input type="search" className="input" placeholder={T.search} value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="field min-w-0 flex-[0_1_200px]"><span className="sr-only">{T.labelFilter}</span>
          <select className="input" value={label} onChange={(e) => setLabel(e.target.value)}>
            <option value="">{T.anyLabel}</option>
            {data.labels.map((l) => <option key={l.id} value={l.id}>{labelText(l, T)}</option>)}
          </select>
        </label>
        {([["mine", mine, setMine, T.onlyMine], ["done", hideDone, setHideDone, T.hideDone]] as const).map(([k, on, set, text]) => (
          <button key={k} type="button" aria-pressed={on} onClick={() => set(!on)}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink"}`}>
            {text}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}

      <div className="grid items-start gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(272px, 100%), 1fr))" }}>
        {lists.map((l, li) => {
          const all = cardsOf(l.id);
          const visible = all.filter(shown);
          return (
            <section key={l.id} aria-label={l.name}
              className={`card flex min-w-0 flex-col gap-2 bg-canvas p-3 ${drag ? "outline-dashed outline-1 outline-line-strong" : ""}`}
              onDragOver={(e) => { if (drag) e.preventDefault(); }}
              onDrop={(e) => (drag?.kind === "list" ? dropList(e, l) : dropCard(e, l, null))}>
              <ListHead list={l} count={all.length} T={T} canEdit={canEdit} first={li === 0} last={li === lists.length - 1} pending={pending}
                onDragStart={(e) => { setDrag({ kind: "list", id: l.id }); e.dataTransfer.setData("text/plain", l.id); e.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => setDrag(null)}
                onRename={(name) => run("renameList", { list: l.id, name })}
                onShift={(d) => shiftList(l, d)}
                onArchive={() => run("archiveList", { list: l.id, on: true })}
                onDelete={() => start(async () => { const r = await deleteBoardPart(data.board.id, "list", l.id); if (r.error) setError(r.error); })} />
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {visible.map((c) => (
                  <li key={c.id}>
                    <CardFace card={c} T={T} locale={locale} today={today} canEdit={canEdit} pending={pending}
                      labels={labelsOf(c)} people={peopleOf(c).map((id) => ({ id, name: names.get(id) ?? "—" }))}
                      checks={data.checklist.filter((i) => i.card_id === c.id)}
                      comments={data.comments.filter((m) => m.card_id === c.id).length}
                      files={data.files.filter((f) => f.card_id === c.id).length}
                      lists={lists.filter((x) => x.id !== l.id)} first={all[0]?.id === c.id} last={all.at(-1)?.id === c.id}
                      onOpen={() => setOpenCard(c.id)}
                      onDone={() => run("setDone", { card: c.id, on: !c.done_at })}
                      onDragStart={(e) => { setDrag({ kind: "card", id: c.id }); e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => setDrag(null)}
                      onDrop={(e) => dropCard(e, l, c)}
                      onShift={(d) => shiftCard(c, d)} onMove={(list) => toList(c, list)} />
                  </li>
                ))}
              </ol>
              {visible.length === 0 && <p className="m-0 px-1 text-sm text-ink-2">{T.emptyList}</p>}
              {canEdit && (adding === l.id ? (
                <OneField label={T.cardTitle} submit={T.add} cancel={T.cancel} max={300} pending={pending} multiline
                  onCancel={() => setAdding(null)}
                  onSave={(title) => run("addCard", { list: l.id, title, position: between(all.at(-1)?.position, null) })} />
              ) : (
                <button type="button" onClick={() => setAdding(l.id)}
                  className="flex min-h-11 w-full items-center rounded-sm px-2 text-left text-sm font-semibold text-ink-2 hover:bg-white">
                  + {T.addCard}
                </button>
              ))}
            </section>
          );
        })}
        {canEdit && (adding === "list" ? (
          <div className="card p-3">
            <OneField label={T.listName} submit={T.add} cancel={T.cancel} max={100} pending={pending} onCancel={() => setAdding(null)}
              onSave={(name) => run("addList", { name, position: between(lists.at(-1)?.position, null) }, () => setAdding(null))} />
          </div>
        ) : (
          <button type="button" onClick={() => setAdding("list")}
            className="flex min-h-24 items-center justify-center rounded border-2 border-dashed border-line-strong p-4 text-sm font-semibold text-ink-2 hover:bg-white">
            + {T.addList}
          </button>
        ))}
      </div>

      {(archivedLists.length > 0 || archivedCards.length > 0) && (
        <details className="card p-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold">{fmt(T.archivedItems, { n: archivedLists.length + archivedCards.length })}</summary>
          <div className="flex flex-col gap-4 pt-2">
            {archivedLists.length > 0 && (
              <Archived title={T.archivedLists} T={T} canEdit={canEdit} pending={pending}
                rows={archivedLists.map((l) => ({ id: l.id, name: l.name }))}
                onRestore={(id) => run("archiveList", { list: id, on: false })}
                onDelete={(id) => start(async () => { const r = await deleteBoardPart(data.board.id, "list", id); if (r.error) setError(r.error); })} />
            )}
            {archivedCards.length > 0 && (
              <Archived title={T.archivedCards} T={T} canEdit={canEdit} pending={pending}
                rows={archivedCards.map((c) => ({ id: c.id, name: c.title }))} onOpen={setOpenCard}
                onRestore={(id) => run("archiveCard", { card: id, on: false })}
                onDelete={(id) => start(async () => { const r = await deleteBoardPart(data.board.id, "card", id); if (r.error) setError(r.error); })} />
            )}
          </div>
        </details>
      )}

      {current && (
        <CardPanel key={current.id} card={current} data={data} T={T} locale={locale} userId={userId} isAdmin={isAdmin} canEdit={canEdit}
          today={today} fileText={fileText} onClose={() => setOpenCard(null)} />
      )}
      {settings && <BoardSettings data={data} T={T} userId={userId} isAdmin={isAdmin} onClose={() => setSettings(false)} />}
    </section>
  );
}

/** One text field with Add / Cancel (new card, new list, renaming). */
export function OneField({ label, submit, cancel, max, pending, initial = "", multiline, onSave, onCancel }: {
  label: string; submit: string; cancel: string; max: number; pending: boolean; initial?: string; multiline?: boolean;
  onSave: (v: string) => void; onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const save = () => { if (v.trim()) { onSave(v.trim()); setV(""); } };
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <label className="field"><span className="sr-only">{label}</span>
        {multiline ? (
          <textarea className="input" rows={2} autoFocus value={v} maxLength={max} placeholder={label} onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(); }
            }} />
        ) : (
          <input className="input" autoFocus value={v} maxLength={max} placeholder={label} onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }} />
        )}
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending || !v.trim()}>{submit}</button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>{cancel}</button>
      </div>
    </form>
  );
}

function ListHead({ list, count, T, canEdit, first, last, pending, onDragStart, onDragEnd, onRename, onShift, onArchive, onDelete }: {
  list: BoardList; count: number; T: T; canEdit: boolean; first: boolean; last: boolean; pending: boolean;
  onDragStart: (e: DragEvent) => void; onDragEnd: () => void; onRename: (name: string) => void; onShift: (d: -1 | 1) => void;
  onArchive: () => void; onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (renaming) {
    return <OneField label={T.listName} submit={T.save} cancel={T.cancel} max={100} pending={pending} initial={list.name}
      onCancel={() => setRenaming(false)} onSave={(n) => { onRename(n); setRenaming(false); }} />;
  }
  const item = "min-h-11 rounded-sm px-3 text-left text-sm hover:bg-mist";
  return (
    <div className="flex items-start justify-between gap-2" draggable={canEdit} onDragStart={canEdit ? onDragStart : undefined} onDragEnd={onDragEnd}>
      <h2 className={`m-0 min-w-0 pt-2.5 text-base font-bold break-words ${canEdit ? "cursor-grab" : ""}`}>
        {list.name} <span className="text-xs font-semibold text-ink-2">{count}</span>
      </h2>
      {canEdit && (
        <details className="relative shrink-0">
          <summary aria-label={fmt(T.listActions, { name: list.name })}
            className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-sm text-lg font-bold hover:bg-white">⋯</summary>
          <div className="absolute right-0 z-20 mt-1 flex w-60 max-w-[calc(100vw-48px)] flex-col rounded-sm border border-line bg-white p-1 shadow-lg">
            <button type="button" className={item} onClick={() => setRenaming(true)}>{T.renameList}</button>
            {!first && <button type="button" className={item} onClick={() => onShift(-1)}>{T.moveLeft}</button>}
            {!last && <button type="button" className={item} onClick={() => onShift(1)}>{T.moveRight}</button>}
            <button type="button" className={item} onClick={onArchive}>{T.archiveList}</button>
            {confirm ? (
              <div className="flex flex-col gap-2 p-2">
                <p className="m-0 text-sm font-semibold">{fmt(T.deleteListConfirm, { name: list.name })}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary" disabled={pending} onClick={onDelete}>{T.delete}</button>
                  <button type="button" className="btn btn-outline" onClick={() => setConfirm(false)}>{T.cancel}</button>
                </div>
              </div>
            ) : <button type="button" className={`${item} text-red-ink`} onClick={() => setConfirm(true)}>{T.deleteList}</button>}
          </div>
        </details>
      )}
    </div>
  );
}

function CardFace({ card: c, T, locale, today, canEdit, pending, labels, people, checks, comments, files, lists, first, last,
  onOpen, onDone, onDragStart, onDragEnd, onDrop, onShift, onMove }: {
  card: BoardCard; T: T; locale: Locale; today: string; canEdit: boolean; pending: boolean; labels: BoardLabel[]; people: { id: string; name: string }[];
  checks: { done: boolean }[]; comments: number; files: number; lists: BoardList[]; first: boolean; last: boolean;
  onOpen: () => void; onDone: () => void; onDragStart: (e: DragEvent) => void; onDragEnd: () => void; onDrop: (e: DragEvent) => void;
  onShift: (d: -1 | 1) => void; onMove: (list: string) => void;
}) {
  const due = dueState(c.due_on, !!c.done_at, today);
  const checked = checks.filter((x) => x.done).length;
  const doneLabel = fmt(c.done_at ? T.markNotDone : T.markDone, { title: c.title });
  return (
    <article draggable={canEdit} onDragStart={canEdit ? onDragStart : undefined} onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
      onClick={(e) => { if (!fromControl(e.target)) onOpen(); }}
      className="flex min-w-0 cursor-pointer flex-col gap-2 rounded-sm border border-line bg-white p-3 shadow-[0_1px_0_rgba(0,0,0,0.06)] hover:border-line-strong">
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {labels.map((l) => (
            <span key={l.id} className="inline-flex min-h-5 items-center rounded-full px-2 text-[11px] font-semibold break-all"
              style={{ background: LABEL_HEX[l.color].bg, color: LABEL_HEX[l.color].fg }}>
              {labelText(l, T)}
            </span>
          ))}
        </div>
      )}
      <div className="-ml-2 flex min-w-0 items-start gap-1">
        <button type="button" role="checkbox" aria-checked={!!c.done_at} aria-label={doneLabel} title={doneLabel}
          disabled={!canEdit || pending} onClick={onDone}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-mist disabled:cursor-default">
          <span aria-hidden="true" className={`flex h-5 w-5 items-center justify-center rounded-full border-2 text-[11px] leading-none font-bold ${
            c.done_at ? "border-green bg-green text-white" : "border-[#8a93a3] bg-paper text-transparent"}`}>✓</span>
        </button>
        <button type="button" onClick={onOpen} aria-label={fmt(T.openCard, { title: c.title })}
          className={`min-h-11 min-w-0 flex-1 py-2.5 text-left text-sm font-semibold break-words hover:underline ${c.done_at ? "text-ink-2 line-through" : "text-ink"}`}>
          {c.title}
        </button>
      </div>
      {(c.client || c.sales_order || c.project) && (
        <div className="flex flex-wrap gap-1.5">
          {[c.sales_order, c.client, c.project].filter(Boolean).map((x) => (
            <span key={x} className="inline-flex rounded-full bg-neutral-tint px-2 py-0.5 text-xs font-semibold break-all">{x}</span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
        {due && c.due_on && (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${DUE_TONE[due]}`}>
            {T.due[due]} · {formatDate(locale, c.due_on)}
          </span>
        )}
        {c.description && <span title={T.hasDescription} aria-label={T.hasDescription}>≡</span>}
        {checks.length > 0 && <span aria-label={fmt(T.checklistCount, { done: checked, total: checks.length })}
          className={checked === checks.length ? "font-semibold text-green-ink" : ""}>☑ {checked}/{checks.length}</span>}
        {comments > 0 && <span aria-label={fmt(T.commentsCount, { n: comments })}>💬 {comments}</span>}
        {files > 0 && <span aria-label={fmt(T.filesCount, { n: files })}>📎 {files}</span>}
        {people.length > 0 && (
          <span className="ml-auto flex -space-x-1" aria-label={fmt(T.onCard, { names: people.map((p) => p.name).join(", ") })}>
            {people.slice(0, 4).map((p) => <UserAvatar key={p.id} id={p.id} size={28} title={p.name} className="border-2 border-white" />)}
          </span>
        )}
        {canEdit && (
          <details className={`relative ${people.length ? "" : "ml-auto"}`}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-sm px-2 text-xs font-semibold text-ink hover:bg-mist">{T.moveCard}</summary>
            <div className="absolute right-0 z-20 mt-1 flex w-56 max-w-[calc(100vw-48px)] flex-col rounded-sm border border-line bg-white p-1 shadow-lg">
              {!first && <button type="button" className="min-h-11 rounded-sm px-3 text-left text-sm hover:bg-mist" onClick={() => onShift(-1)}>{T.moveUp}</button>}
              {!last && <button type="button" className="min-h-11 rounded-sm px-3 text-left text-sm hover:bg-mist" onClick={() => onShift(1)}>{T.moveDown}</button>}
              {lists.map((l) => (
                <button key={l.id} type="button" className="min-h-11 rounded-sm px-3 text-left text-sm break-words hover:bg-mist" onClick={() => onMove(l.id)}>
                  {fmt(T.moveToList, { list: l.name })}
                </button>
              ))}
            </div>
          </details>
        )}
      </div>
    </article>
  );
}

function Archived({ title, rows, T, canEdit, pending, onOpen, onRestore, onDelete }: {
  title: string; rows: { id: string; name: string }[]; T: T; canEdit: boolean; pending: boolean;
  onOpen?: (id: string) => void; onRestore: (id: string) => void; onDelete: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <h3 className="m-0 text-sm font-bold tracking-[1px] uppercase text-ink-2">{title}</h3>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 border-b border-mist py-1 last:border-0">
            {onOpen ? <button type="button" className="min-h-11 min-w-0 flex-[1_1_180px] text-left text-sm break-words underline" onClick={() => onOpen(r.id)}>{r.name}</button>
              : <span className="min-w-0 flex-[1_1_180px] text-sm break-words">{r.name}</span>}
            {canEdit && (confirm === r.id ? (
              <span className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" disabled={pending} onClick={() => onDelete(r.id)}>{T.delete}</button>
                <button type="button" className="btn btn-outline" onClick={() => setConfirm(null)}>{T.cancel}</button>
              </span>
            ) : (
              <span className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-outline" disabled={pending} onClick={() => onRestore(r.id)}>{T.restore}</button>
                <button type="button" className="btn btn-outline text-red-ink" onClick={() => setConfirm(r.id)}>{T.delete}</button>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
