"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { fmt, formatDate, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { boardOp, deleteBoardPart, type BoardOp } from "@/app/board-actions";
import {
  BOARD_HEX, between, DUE_TONE, dueState, LABEL_HEX,
  type BoardCard, type BoardData, type BoardLabel, type BoardList,
} from "@/lib/boards-shared";
import { UserAvatar } from "@/components/user-avatar";
import { CardPanel } from "@/components/boards/card-panel";
import { BoardSettings } from "@/components/boards/board-settings";
import { BoardCalendar } from "@/components/boards/board-calendar";
import { BoardTable } from "@/components/boards/board-table";

type T = Dict["boards"];
export type FileText = { tooBig: string; type: string; limits: string };
type View = "board" | "list" | "calendar";
type Props = {
  data: BoardData; locale: Locale; userId: string; isAdmin: boolean; canEdit: boolean; T: T; today: string;
  initialCard: string | null; fileText: FileText;
};
/** What the shared views need from the board. */
export type BoardCtx = {
  T: T; locale: Locale; today: string; canEdit: boolean; pending: boolean;
  lists: BoardList[]; labelsOf: (c: BoardCard) => BoardLabel[]; peopleOf: (c: BoardCard) => { id: string; name: string }[];
  open: (id: string) => void; move: (c: BoardCard, list: string, position: number) => void;
  setDue: (c: BoardCard, due: string | null) => void; setDone: (c: BoardCard, on: boolean) => void;
};

/** A click on a card opens it, except on its own buttons, links and menus. */
const fromControl = (target: EventTarget) =>
  target instanceof Element && !!target.closest("button, a, summary, details, form, input, select, textarea, label");
/** A choice in a drop-down menu (details) closes it. */
const closeMenu = (e: { currentTarget: Element }) => e.currentTarget.closest("details")?.removeAttribute("open");
const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && !!e.target.closest("input, textarea, select, [contenteditable]");

export const labelText = (l: BoardLabel, T: T) => l.name || fmt(T.noLabelName, { color: T.colors[l.color] });

/** A board: header, filters, three views (lists of cards, a table, a calendar of due dates) and the open card. */
export function BoardView({ data, locale, userId, isAdmin, canEdit, T, today, initialCard, fileText }: Props) {
  const router = useRouter();
  const [view, setView] = useState<View>("board");
  const [search, setSearch] = useState("");
  const [mine, setMine] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [label, setLabel] = useState("");
  const [openCard, setOpenCard] = useState<string | null>(initialCard);
  const [settings, setSettings] = useState(false);
  // A phone: the label, Mine and Hide done behind one Filters button (owner, Nov 2026: fewer buttons on the phone)
  const [moreFilters, setMoreFilters] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);   // list id of the "+ card" form, or "list"
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  // Changes show at once; the server's answer follows (a refusal puts the board back as it was)
  const [cards, setCards] = useState(data.cards);
  const [lists, setLists] = useState(data.lists);
  useEffect(() => { setCards(data.cards); }, [data.cards]);
  useEffect(() => { setLists(data.lists); }, [data.lists]);

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

  const openLists = useMemo(() => lists.filter((l) => !l.archived_at).sort((a, b) => a.position - b.position), [lists]);

  // Keys: "/" searches, "N" adds a card to the first list
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey || openCard || settings) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      if (["n", "N", "н", "Н"].includes(e.key) && canEdit && openLists[0]) {
        e.preventDefault(); setView("board"); setAdding(openLists[0].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCard, settings, canEdit, openLists]);

  const run = (op: BoardOp, args: Record<string, unknown>, after?: (id?: string) => void) =>
    start(async () => {
      setError(null);
      const r = await boardOp(data.board.id, op, args).catch((): { error: string; id?: string } => ({ error: T.stale }));
      if (r.error) { setError(r.error); setCards(data.cards); setLists(data.lists); } else after?.(r.id);
    });

  const names = useMemo(() => new Map([...data.people.map((p) => [p.id, p.full_name] as const), ...data.members.map((m) => [m.user_id, m.full_name] as const)]), [data]);
  const cardsOf = (listId: string) => cards.filter((c) => c.list_id === listId && !c.archived_at).sort((a, b) => a.position - b.position);
  const peopleIds = (c: BoardCard) => data.cardMembers.filter((m) => m.card_id === c.id).map((m) => m.user_id);
  const ctx: BoardCtx = {
    T, locale, today, canEdit, pending, lists: openLists,
    labelsOf: (c) => data.cardLabels.filter((x) => x.card_id === c.id).map((x) => data.labels.find((l) => l.id === x.label_id)).filter(Boolean) as BoardLabel[],
    peopleOf: (c) => peopleIds(c).map((id) => ({ id, name: names.get(id) ?? "—" })),
    open: setOpenCard,
    move: (c, list, position) => {
      setCards((xs) => xs.map((x) => (x.id === c.id ? { ...x, list_id: list, position } : x)));
      run("moveCard", { card: c.id, list, position });
    },
    setDue: (c, due) => {
      setCards((xs) => xs.map((x) => (x.id === c.id ? { ...x, due_on: due } : x)));
      run("setDue", { card: c.id, due });
    },
    setDone: (c, on) => {
      setCards((xs) => xs.map((x) => (x.id === c.id ? { ...x, done_at: on ? new Date().toISOString() : null } : x)));
      run("setDone", { card: c.id, on });
    },
  };

  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (c: BoardCard) => {
    if (c.archived_at) return false;
    if (hideDone && c.done_at) return false;
    if (mine && !peopleIds(c).includes(userId)) return false;
    if (label && !data.cardLabels.some((x) => x.card_id === c.id && x.label_id === label)) return false;
    const hay = `${c.title} ${c.description} ${c.client ?? ""} ${c.sales_order ?? ""} ${c.project ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const visible = cards.filter((c) => shown(c) && openLists.some((l) => l.id === c.list_id));

  const archivedLists = lists.filter((l) => l.archived_at);
  const archivedCards = cards.filter((c) => c.archived_at);
  const current = openCard ? cards.find((c) => c.id === openCard) ?? null : null;
  const hex = BOARD_HEX[data.board.color] ?? BOARD_HEX.blue;
  const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink hover:border-ink"}`;
  const filtered = !!(search || mine || hideDone || label);
  const removePart = (part: "list" | "card", id: string) =>
    start(async () => { const r = await deleteBoardPart(data.board.id, part, id).catch((): { error: string } => ({ error: T.stale })); if (r.error) setError(r.error); });

  return (
    <section aria-labelledby="board-h" className="flex min-w-0 flex-col gap-4 rounded-lg p-3 sm:p-4"
      style={{ background: `linear-gradient(180deg, ${hex}24 0, ${hex}0d 380px, transparent 760px)` }}>
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg p-4 text-white shadow-sm sm:p-5"
        style={{ background: `linear-gradient(135deg, ${hex}, ${hex}d9)` }}>
        <div className="min-w-0 flex-[1_1_260px]">
          {renaming ? (
            <form onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get("name"); if (typeof v === "string" && v.trim()) run("renameBoard", { name: v.trim() }, () => setRenaming(false)); }}>
              <label className="sr-only" htmlFor="board-name">{T.renameBoard}</label>
              <input id="board-name" name="name" autoFocus defaultValue={data.board.name} maxLength={100}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== data.board.name) run("renameBoard", { name: v }); setRenaming(false); }}
                onKeyDown={(e) => { if (e.key === "Escape") setRenaming(false); }}
                className="w-full rounded-sm border-0 bg-white/20 px-2 py-1 text-xl font-bold text-white outline-2 outline-white" />
            </form>
          ) : (
            <h1 id="board-h" className="m-0 text-xl font-bold break-words sm:text-2xl">
              {canEdit ? (
                <button type="button" title={T.renameBoard} onClick={() => setRenaming(true)}
                  className="min-h-11 rounded-sm px-1 text-left hover:bg-white/15">{data.board.name}</button>
              ) : data.board.name}
            </h1>
          )}
          {data.board.archived_at && <p className="m-0 text-sm font-semibold">{T.archived}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex -space-x-2" aria-label={fmt(T.onCard, { names: data.members.map((m) => m.full_name).join(", ") })}>
            {data.members.slice(0, 8).map((m) => (
              <UserAvatar key={m.user_id} id={m.user_id} size={34} title={m.full_name} className="border-2 border-white" />
            ))}
          </span>
          {canEdit && (
            <button type="button" onClick={() => setSettings(true)} aria-label={T.addMember} title={T.addMember}
              className="hidden h-11 w-11 items-center justify-center rounded-full border-2 border-dashed border-white/80 text-lg font-bold hover:bg-white/15 sm:flex">+</button>
          )}
          {canEdit && (
            <>
              {/* A phone: the gear only; a computer: the button with its name */}
              <button type="button" onClick={() => setSettings(true)} aria-label={T.settings} title={T.settings}
                className="grid h-11 w-11 place-items-center rounded-full bg-white text-ink hover:bg-white/90 sm:hidden">
                <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
              </button>
              <span className="hidden sm:contents"><button type="button" className="btn border-white bg-white text-ink hover:bg-white/90" onClick={() => setSettings(true)}>{T.settings}</button></span>
            </>
          )}
        </div>
      </header>

      {!canEdit && <p className="m-0 text-sm text-ink-2">{T.readOnly}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={T.viewsLabel} className="inline-flex rounded-full border border-line-strong bg-white p-1 shadow-sm">
          {(["board", "list", "calendar"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`min-h-9 rounded-full px-4 text-sm font-semibold transition-colors ${view === v ? "bg-ink text-white" : "text-ink hover:bg-mist"}`}>
              {T.views[v]}
            </button>
          ))}
        </div>
        <p className="m-0 hidden text-xs text-ink-2 md:block">{T.keysHint}</p>
      </div>

      <div role="group" aria-label={T.filtersLabel} className="flex flex-wrap items-end gap-2">
        <label className="field min-w-0 flex-[1_1_220px]"><span className="sr-only">{T.search}</span>
          <input ref={searchRef} type="search" className="input" placeholder={`${T.search}  /`} value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setSearch(""); e.currentTarget.blur(); } }} />
        </label>
        <button type="button" aria-expanded={moreFilters} onClick={() => setMoreFilters(!moreFilters)} className={`${chip(moreFilters || !!(mine || hideDone || label))} sm:hidden`}>
          {T.filters}{(mine || hideDone || label) ? ` · ${[mine, hideDone, label].filter(Boolean).length}` : ""}
        </button>
        <div className={`${moreFilters ? "flex" : "hidden"} w-full flex-wrap items-end gap-2 sm:contents`}>
        <label className="field min-w-0 flex-[0_1_200px]"><span className="sr-only">{T.labelFilter}</span>
          <select className="input" value={label} onChange={(e) => setLabel(e.target.value)}>
            <option value="">{T.anyLabel}</option>
            {data.labels.map((l) => <option key={l.id} value={l.id}>{labelText(l, T)}</option>)}
          </select>
        </label>
        <button type="button" aria-pressed={mine} onClick={() => setMine(!mine)} className={chip(mine)}>{T.onlyMine}</button>
        <button type="button" aria-pressed={hideDone} onClick={() => setHideDone(!hideDone)} className={chip(hideDone)}>{T.hideDone}</button>
        </div>
      </div>
      {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
      {filtered && visible.length === 0 && <p className="m-0 text-sm text-ink-2">{T.noCards}</p>}

      {view === "board" && (
        <Kanban ctx={ctx} lists={openLists} cardsOf={cardsOf} shown={shown} adding={adding} setAdding={setAdding} run={run}
          comments={(c) => data.comments.filter((m) => m.card_id === c.id).length}
          files={(c) => data.files.filter((f) => f.card_id === c.id).length}
          checks={(c) => data.checklist.filter((i) => i.card_id === c.id)}
          onDeleteList={(l) => removePart("list", l.id)}
          onArchiveList={(l) => { setLists((xs) => xs.map((x) => (x.id === l.id ? { ...x, archived_at: new Date().toISOString() } : x))); run("archiveList", { list: l.id, on: true }); }}
          onMoveList={(l, position) => { setLists((xs) => xs.map((x) => (x.id === l.id ? { ...x, position } : x))); run("moveList", { list: l.id, position }); }} />
      )}
      {view === "list" && <BoardTable ctx={ctx} cards={visible} />}
      {view === "calendar" && <BoardCalendar ctx={ctx} cards={visible} />}

      {(archivedLists.length > 0 || archivedCards.length > 0) && (
        <details className="card p-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold">{fmt(T.archivedItems, { n: archivedLists.length + archivedCards.length })}</summary>
          <div className="flex flex-col gap-4 pt-2">
            {archivedLists.length > 0 && (
              <Archived title={T.archivedLists} T={T} canEdit={canEdit} pending={pending}
                rows={archivedLists.map((l) => ({ id: l.id, name: l.name }))}
                onRestore={(id) => run("archiveList", { list: id, on: false })} onDelete={(id) => removePart("list", id)} />
            )}
            {archivedCards.length > 0 && (
              <Archived title={T.archivedCards} T={T} canEdit={canEdit} pending={pending}
                rows={archivedCards.map((c) => ({ id: c.id, name: c.title }))} onOpen={setOpenCard}
                onRestore={(id) => run("archiveCard", { card: id, on: false })} onDelete={(id) => removePart("card", id)} />
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

type Over = { list: string; index: number } | null;

/** Lists of cards side by side (they wrap, never scroll sideways); dragging shows where a card will land. */
function Kanban({ ctx, lists, cardsOf, shown, adding, setAdding, run, comments, files, checks, onDeleteList, onArchiveList, onMoveList }: {
  ctx: BoardCtx; lists: BoardList[]; cardsOf: (id: string) => BoardCard[]; shown: (c: BoardCard) => boolean;
  adding: string | null; setAdding: (v: string | null) => void; run: (op: BoardOp, args: Record<string, unknown>, after?: (id?: string) => void) => void;
  comments: (c: BoardCard) => number; files: (c: BoardCard) => number; checks: (c: BoardCard) => { done: boolean }[];
  onDeleteList: (l: BoardList) => void; onArchiveList: (l: BoardList) => void; onMoveList: (l: BoardList, position: number) => void;
}) {
  const { T, canEdit, pending } = ctx;
  const [drag, setDrag] = useState<{ kind: "card" | "list"; id: string } | null>(null);
  const [over, setOver] = useState<Over>(null);
  const [overList, setOverList] = useState<string | null>(null);

  const endDrag = () => { setDrag(null); setOver(null); setOverList(null); };
  const dropCard = (e: DragEvent, list: BoardList) => {
    e.preventDefault();
    if (!drag || drag.kind !== "card") return endDrag();
    const card = lists.flatMap((l) => cardsOf(l.id)).find((c) => c.id === drag.id);
    const rest = cardsOf(list.id).filter((c) => c.id !== drag.id && shown(c));
    const i = over?.list === list.id ? Math.min(over.index, rest.length) : rest.length;
    if (card) ctx.move(card, list.id, between(rest[i - 1]?.position, rest[i]?.position));
    endDrag();
  };
  const dropList = (e: DragEvent, before: BoardList) => {
    e.preventDefault();
    if (!drag || drag.kind !== "list" || drag.id === before.id) return endDrag();
    const moving = lists.find((l) => l.id === drag.id);
    const rest = lists.filter((l) => l.id !== drag.id);
    const i = rest.findIndex((l) => l.id === before.id);
    if (moving) onMoveList(moving, between(rest[i - 1]?.position, rest[i]?.position));
    endDrag();
  };
  const shiftList = (l: BoardList, delta: -1 | 1) => {
    const rest = lists.filter((x) => x.id !== l.id);
    const i = lists.findIndex((x) => x.id === l.id) + delta;
    onMoveList(l, between(rest[i - 1]?.position, rest[i]?.position));
  };
  const shiftCard = (c: BoardCard, delta: -1 | 1) => {
    const all = cardsOf(c.list_id);
    const rest = all.filter((x) => x.id !== c.id);
    const i = all.findIndex((x) => x.id === c.id) + delta;
    ctx.move(c, c.list_id, between(rest[i - 1]?.position, rest[i]?.position));
  };

  return (
    <div className="grid items-start gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))" }}>
      {lists.map((l, li) => {
        const all = cardsOf(l.id);
        // While a card is dragged it leaves its place; the dashed slot shows where it will land
        const vis = all.filter((c) => shown(c) && !(drag?.kind === "card" && drag.id === c.id && over));
        const slot = drag?.kind === "card" && over?.list === l.id ? Math.min(over.index, vis.length) : -1;
        return (
          <section key={l.id} aria-label={l.name}
            className={`flex min-w-0 flex-col gap-2 rounded-lg border bg-white/85 p-3 shadow-sm transition-[box-shadow,border-color,opacity] ${
              overList === l.id || slot >= 0 ? "border-ink/60 shadow-md" : "border-line"} ${drag?.kind === "list" && drag.id === l.id ? "opacity-40" : ""}`}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              if (drag.kind === "list") { setOverList(l.id); return; }
              // Over the free space of a list (not a card): the end of it
              if (!(e.target instanceof Element) || !e.target.closest("article")) setOver({ list: l.id, index: vis.length });
            }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverList(null); }}
            onDrop={(e) => (drag?.kind === "list" ? dropList(e, l) : dropCard(e, l))}>
            <ListHead list={l} count={all.length} T={T} canEdit={canEdit} first={li === 0} last={li === lists.length - 1} pending={pending}
              onDragStart={(e) => { setDrag({ kind: "list", id: l.id }); e.dataTransfer.setData("text/plain", l.id); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={endDrag}
              onRename={(name) => run("renameList", { list: l.id, name })}
              onShift={(d) => shiftList(l, d)} onArchive={() => onArchiveList(l)} onDelete={() => onDeleteList(l)} />
            <ol className="m-0 flex min-h-2 list-none flex-col gap-2 p-0">
              {vis.map((c, i) => (
                <li key={c.id} className="flex flex-col gap-2">
                  {slot === i && <Placeholder />}
                  <CardFace card={c} ctx={ctx} labels={ctx.labelsOf(c)} people={ctx.peopleOf(c)} checks={checks(c)} comments={comments(c)} files={files(c)}
                    dragging={drag?.id === c.id} lists={lists.filter((x) => x.id !== l.id)} first={all[0]?.id === c.id} last={all.at(-1)?.id === c.id}
                    onDragStart={(e) => { setDrag({ kind: "card", id: c.id }); e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={endDrag}
                    onDragOver={(e) => {
                      if (drag?.kind !== "card") return;
                      e.preventDefault();
                      e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      setOver({ list: l.id, index: e.clientY > r.top + r.height / 2 ? i + 1 : i });
                    }}
                    onShift={(d) => shiftCard(c, d)}
                    onMove={(list) => ctx.move(c, list, between(cardsOf(list).at(-1)?.position, null))} />
                </li>
              ))}
              {slot === vis.length && <li><Placeholder /></li>}
            </ol>
            {vis.length === 0 && slot < 0 && <p className="m-0 px-1 text-sm text-ink-2">{T.emptyList}</p>}
            {canEdit && (adding === l.id ? (
              <OneField label={T.cardTitle} submit={T.add} cancel={T.cancel} max={300} pending={pending} multiline
                onCancel={() => setAdding(null)}
                onSave={(title) => run("addCard", { list: l.id, title, position: between(all.at(-1)?.position, null) })} />
            ) : (
              <button type="button" onClick={() => setAdding(l.id)}
                className="flex min-h-11 w-full items-center rounded-md px-2 text-left text-sm font-semibold text-ink-2 transition-colors hover:bg-mist hover:text-ink">
                + {T.addCard}
              </button>
            ))}
          </section>
        );
      })}
      {canEdit && (adding === "list" ? (
        <div className="rounded-lg border border-line bg-white p-3 shadow-sm">
          <OneField label={T.listName} submit={T.add} cancel={T.cancel} max={100} pending={pending} onCancel={() => setAdding(null)}
            onSave={(name) => run("addList", { name, position: between(lists.at(-1)?.position, null) }, () => setAdding(null))} />
        </div>
      ) : (
        <button type="button" onClick={() => setAdding("list")}
          className="flex min-h-24 items-center justify-center rounded-lg border-2 border-dashed border-line-strong bg-white/50 p-4 text-sm font-semibold text-ink-2 transition-colors hover:border-ink hover:bg-white hover:text-ink">
          + {T.addList}
        </button>
      ))}
    </div>
  );
}

function Placeholder() {
  return <div aria-hidden="true" className="h-14 rounded-md border-2 border-dashed border-ink/40 bg-ink/5" />;
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
      <h2 className={`m-0 flex min-w-0 items-center gap-2 pt-2 text-base font-bold break-words ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
        onDoubleClick={() => canEdit && setRenaming(true)}>
        {list.name}
        <span className="inline-flex min-w-6 justify-center rounded-full bg-mist px-1.5 text-xs font-semibold text-ink-2">{count}</span>
      </h2>
      {canEdit && (
        <details className="relative shrink-0">
          <summary aria-label={fmt(T.listActions, { name: list.name })}
            className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-md text-lg font-bold hover:bg-mist">⋯</summary>
          <div className="absolute right-0 z-20 mt-1 flex w-60 max-w-[calc(100vw-48px)] flex-col rounded-md border border-line bg-white p-1 shadow-lg">
            <button type="button" className={item} onClick={(e) => { closeMenu(e); setRenaming(true); }}>{T.renameList}</button>
            {!first && <button type="button" className={item} onClick={(e) => { closeMenu(e); onShift(-1); }}>{T.moveLeft}</button>}
            {!last && <button type="button" className={item} onClick={(e) => { closeMenu(e); onShift(1); }}>{T.moveRight}</button>}
            <button type="button" className={item} onClick={(e) => { closeMenu(e); onArchive(); }}>{T.archiveList}</button>
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

/** Labels of a card as small coloured pills. */
export function LabelPills({ labels, T }: { labels: BoardLabel[]; T: T }) {
  if (!labels.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {labels.map((l) => (
        <span key={l.id} className="inline-flex min-h-5 items-center rounded-full px-2 text-[11px] font-semibold break-all"
          style={{ background: LABEL_HEX[l.color].bg, color: LABEL_HEX[l.color].fg }}>{labelText(l, T)}</span>
      ))}
    </span>
  );
}

/** The round tick of a card: done or not. */
export function DoneTick({ card: c, ctx }: { card: BoardCard; ctx: BoardCtx }) {
  const label = fmt(c.done_at ? ctx.T.markNotDone : ctx.T.markDone, { title: c.title });
  return (
    <button type="button" role="checkbox" aria-checked={!!c.done_at} aria-label={label} title={label}
      disabled={!ctx.canEdit} onClick={() => ctx.setDone(c, !c.done_at)}
      className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-mist disabled:cursor-default">
      <span aria-hidden="true" className={`flex h-5 w-5 items-center justify-center rounded-full border-2 text-[11px] leading-none font-bold transition-colors ${
        c.done_at ? "border-green bg-green text-white" : "border-[#8a93a3] bg-paper text-transparent group-hover:text-[#8a93a3]"}`}>✓</span>
    </button>
  );
}

/** The due date as a coloured chip (overdue, today, soon, later, done). */
export function DueChip({ card: c, ctx }: { card: BoardCard; ctx: BoardCtx }) {
  const due = dueState(c.due_on, !!c.done_at, ctx.today);
  if (!due || !c.due_on) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${DUE_TONE[due]}`}>
      <span aria-hidden="true">◷</span>{ctx.T.due[due]} · {formatDate(ctx.locale, c.due_on)}
    </span>
  );
}

function CardFace({ card: c, ctx, labels, people, checks, comments, files, dragging, lists, first, last,
  onDragStart, onDragEnd, onDragOver, onShift, onMove }: {
  card: BoardCard; ctx: BoardCtx; labels: BoardLabel[]; people: { id: string; name: string }[];
  checks: { done: boolean }[]; comments: number; files: number; dragging: boolean; lists: BoardList[]; first: boolean; last: boolean;
  onDragStart: (e: DragEvent) => void; onDragEnd: () => void; onDragOver: (e: DragEvent) => void;
  onShift: (d: -1 | 1) => void; onMove: (list: string) => void;
}) {
  const { T, canEdit } = ctx;
  const checked = checks.filter((x) => x.done).length;
  const cover = labels[0] ? LABEL_HEX[labels[0].color].bg : null;
  return (
    <article draggable={canEdit} onDragStart={canEdit ? onDragStart : undefined} onDragEnd={onDragEnd} onDragOver={onDragOver}
      onClick={(e) => { if (!fromControl(e.target)) ctx.open(c.id); }}
      className={`group/card relative flex min-w-0 cursor-pointer flex-col gap-2 overflow-hidden rounded-md border border-line p-3 pt-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-[transform,box-shadow,opacity] duration-150 hover:-translate-y-px hover:shadow-md ${
        dragging ? "opacity-40" : ""} ${c.done_at ? "bg-paper" : "bg-white"}`}>
      {cover && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1" style={{ background: cover }} />}
      <LabelPills labels={labels} T={T} />
      <div className="-ml-2 flex min-w-0 items-start gap-1">
        <DoneTick card={c} ctx={ctx} />
        <button type="button" onClick={() => ctx.open(c.id)} aria-label={fmt(T.openCard, { title: c.title })}
          className={`min-h-11 min-w-0 flex-1 py-2.5 text-left text-sm font-semibold break-words ${c.done_at ? "text-ink-2 line-through" : "text-ink"}`}>
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
        <DueChip card={c} ctx={ctx} />
        {c.description && <span title={T.hasDescription} aria-label={T.hasDescription}>≡</span>}
        {checks.length > 0 && <span aria-label={fmt(T.checklistCount, { done: checked, total: checks.length })}
          className={`rounded-full px-1.5 py-0.5 ${checked === checks.length ? "bg-green-tint font-semibold text-green-ink" : ""}`}>☑ {checked}/{checks.length}</span>}
        {comments > 0 && <span aria-label={fmt(T.commentsCount, { n: comments })}>💬 {comments}</span>}
        {files > 0 && <span aria-label={fmt(T.filesCount, { n: files })}>📎 {files}</span>}
        {people.length > 0 && (
          <span className="ml-auto flex -space-x-1.5" aria-label={fmt(T.onCard, { names: people.map((p) => p.name).join(", ") })}>
            {people.slice(0, 4).map((p) => <UserAvatar key={p.id} id={p.id} size={26} title={p.name} className="border-2 border-white" />)}
          </span>
        )}
        {canEdit && (
          <details className={`relative ${people.length ? "" : "ml-auto"}`}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md px-2 text-xs font-semibold text-ink hover:bg-mist">{T.moveCard}</summary>
            <div className="absolute right-0 z-20 mt-1 flex w-56 max-w-[calc(100vw-48px)] flex-col rounded-md border border-line bg-white p-1 shadow-lg" onClick={closeMenu}>
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
