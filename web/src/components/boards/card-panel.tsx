"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { fmt, formatDate, formatNumber, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { boardOp, deleteBoardFile, deleteBoardPart, uploadBoardFile, type BoardOp } from "@/app/board-actions";
import { between, LABEL_COLORS, LABEL_HEX, type BoardCard, type BoardData, type LabelColor } from "@/lib/boards-shared";
import { fileExt, linkParts, TASK_FILE_MAX, TASK_FILE_TYPES } from "@/lib/tasks-shared";
import { SearchSelect } from "@/components/search-select";
import { useSeen } from "@/components/notifications-seen";
import { labelText, type FileText } from "@/components/boards/board-view";
import { UserAvatar } from "@/components/user-avatar";

type T = Dict["boards"];
type Props = {
  card: BoardCard; data: BoardData; T: T; locale: Locale; userId: string; isAdmin: boolean; canEdit: boolean; today: string;
  fileText: FileText; onClose: () => void;
};

const time = (l: Locale, d: string) => formatDate(l, d, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const size = (l: Locale, n: number) => (n >= 1048576 ? `${formatNumber(l, n / 1048576, 1)} MB` : `${formatNumber(l, Math.max(1, Math.round(n / 1024)))} KB`);

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 border-t border-mist pt-4">
      <h3 id={id} className="m-0 text-sm font-bold tracking-[1px] uppercase text-ink-2">{title}</h3>
      {children}
    </section>
  );
}

function Linked({ text }: { text: string }) {
  return <>{linkParts(text).map((p, i) => (p.href ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="break-all text-ink underline">{p.text}</a> : <span key={i}>{p.text}</span>))}</>;
}

/** A card: right-side panel on wide screens, full screen on phones. */
export function CardPanel({ card: c, data, T, locale, userId, isAdmin, canEdit, fileText, onClose }: Props) {
  const C = T.card;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const names = useMemo(() => new Map([...data.people.map((p) => [p.id, p.full_name] as const), ...data.members.map((m) => [m.user_id, m.full_name] as const)]), [data]);
  const nameOf = (id: string) => names.get(id) ?? "—";
  const boardId = data.board.id;
  useSeen(`/boards/${boardId}?card=${c.id}`);

  const run = (op: BoardOp, args: Record<string, unknown>, after?: (id?: string) => void) =>
    new Promise<boolean>((resolve) => start(async () => {
      setError(null); setMessage(null);
      const r = await boardOp(boardId, op, { card: c.id, ...args }).catch((): { error: string; id?: string } => ({ error: T.stale }));
      if (r.error) { setError(r.error); resolve(false); } else { after?.(r.id); resolve(true); }
    }));

  // Escape closes; focus starts on the close button; comments of others arrive while it is open
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 20000);
    return () => { window.removeEventListener("keydown", onKey); window.clearInterval(timer); };
  }, [onClose, router]);

  // ---- title and description
  const [title, setTitle] = useState(c.title);
  const [description, setDescription] = useState(c.description);
  const [editingDescription, setEditingDescription] = useState(false);
  const saveText = () => run("saveCard", { title, description }, () => { setEditingDescription(false); setMessage(C.saved); });

  // ---- people, labels, links
  const people = data.cardMembers.filter((m) => m.card_id === c.id).map((m) => m.user_id);
  const labels = data.cardLabels.filter((x) => x.card_id === c.id).map((x) => x.label_id);
  const [editLabels, setEditLabels] = useState(false);
  const [newLabel, setNewLabel] = useState<{ name: string; color: LabelColor }>({ name: "", color: "green" });

  // ---- checklist
  const items = data.checklist.filter((i) => i.card_id === c.id).sort((a, b) => a.position - b.position);
  const [newItem, setNewItem] = useState("");
  // A tick shows at once; the saved state follows from the server
  const [ticks, setTicks] = useState<Record<string, boolean>>({});

  // ---- files
  const files = data.files.filter((f) => f.card_id === c.id);
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const upload = async (list: File[]) => {
    setError(null);
    for (const f of list) {
      if (f.size > TASK_FILE_MAX) { setError(fmt(fileText.tooBig, { name: f.name })); continue; }
      if (!TASK_FILE_TYPES.includes(fileExt(f.name))) { setError(fmt(fileText.type, { name: f.name })); continue; }
      setUploading(f.name);
      const fd = new FormData();
      fd.set("board_id", boardId); fd.set("card_id", c.id); fd.set("file", f);
      const r = await uploadBoardFile(fd).catch((): { error: string; id?: string } => ({ error: T.stale }));
      if (r.error) setError(r.error);
    }
    setUploading(null);
    router.refresh();
  };

  // ---- comments with @mentions of the board's people
  const comments = data.comments.filter((m) => m.card_id === c.id);
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const mentionable = data.members.filter((m) => m.user_id !== userId
    && (mentionQuery == null || m.full_name.toLowerCase().includes(mentionQuery.toLowerCase())));
  const pickMention = (m: { user_id: string; full_name: string }) => {
    const el = composer.current;
    const caret = el?.selectionStart ?? body.length;
    setBody(body.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${m.full_name} `) + body.slice(caret));
    setMentions((x) => (x.includes(m.user_id) ? x : [...x, m.user_id]));
    setMentionQuery(null);
    el?.focus();
  };
  const send = async () => {
    if (!body.trim()) return;
    const used = mentions.filter((id) => body.includes(`@${nameOf(id)}`));
    if (await run("postComment", { body, mentions: used }, () => { setBody(""); setMentions([]); })) composer.current?.focus();
  };

  // ---- moving to another board, archive and delete
  const [target, setTarget] = useState({ board: "", list: "" });
  const targetLists = data.moveTargets.find((b) => b.id === target.board)?.lists ?? [];
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lists = data.lists.filter((l) => !l.archived_at || l.id === c.list_id);
  const listCards = (id: string) => data.cards.filter((x) => x.list_id === id && !x.archived_at && x.id !== c.id).sort((a, b) => a.position - b.position);

  const toggle = (on: boolean) => `inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm font-semibold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink"}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(0,0,0,0.45)]" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="card-panel-h"
        className={`flex h-full w-full max-w-[640px] flex-col bg-white shadow-2xl ${dragOver ? "outline-4 -outline-offset-4 outline-dashed outline-ink-2" : ""}`}
        onDragOver={(e) => { if (canEdit && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { if (canEdit && e.dataTransfer.files.length) { e.preventDefault(); setDragOver(false); void upload(Array.from(e.dataTransfer.files)); } }}>
        <header className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div className="min-w-0">
            <p className="m-0 text-xs text-ink-2">{data.board.name} · {data.lists.find((l) => l.id === c.list_id)?.name}</p>
            <h2 id="card-panel-h" className={`m-0 text-lg font-bold break-words ${c.done_at ? "text-ink-2 line-through" : ""}`}>{c.title}</h2>
            <p className="m-0 text-xs text-ink-2">{fmt(C.created, { name: nameOf(c.created_by), date: time(locale, c.created_at) })}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="btn btn-outline shrink-0">{T.close}</button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {(error || message || uploading) && (
            <p role="status" aria-live="polite" className="m-0 text-sm font-semibold">
              {error && <span className="text-red-ink">{error}</span>}
              {!error && message && <span className="text-green-ink">{message}</span>}
              {uploading && <span className="text-ink-2"> {fmt(C.uploading, { name: uploading })}</span>}
            </p>
          )}
          {c.archived_at && (
            <div className="flex flex-wrap items-center gap-3 rounded-sm bg-amber-tint p-3 text-sm text-amber-ink">
              <span className="font-semibold">{C.archivedNote}</span>
              {canEdit && <button type="button" className="btn btn-outline" disabled={pending} onClick={() => void run("archiveCard", { on: false })}>{T.restore}</button>}
            </div>
          )}

          {canEdit && (
            <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) void saveText(); }}>
              <label className="field"><span>{T.cardTitle}</span>
                <input className="input" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
              </label>
              {title.trim() !== c.title && <button type="submit" className="btn btn-primary w-fit" disabled={pending || !title.trim()}>{T.save}</button>}
            </form>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="field"><span>{C.list}</span>
              <select className="input" value={c.list_id} disabled={!canEdit || pending}
                onChange={(e) => void run("moveCard", { list: e.target.value, position: between(listCards(e.target.value).at(-1)?.position, null) })}>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="field"><span>{C.due}</span>
              <span className="flex gap-2">
                <input type="date" className="input min-w-0 flex-1" value={c.due_on ?? ""} disabled={!canEdit || pending}
                  onChange={(e) => void run("setDue", { due: e.target.value || null })} />
                {c.due_on && canEdit && <button type="button" className="btn btn-outline shrink-0" aria-label={C.clearDue} title={C.clearDue}
                  onClick={() => void run("setDue", { due: null })}>×</button>}
              </span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
              <input type="checkbox" className="h-5 w-5 accent-ink" checked={!!c.done_at} disabled={!canEdit || pending}
                onChange={(e) => void run("setDone", { on: e.target.checked })} />
              {C.done}
            </label>
          </div>

          <Section title={C.people} id="card-people">
            <div className="flex flex-wrap gap-2">
              {data.members.map((m) => {
                const on = people.includes(m.user_id);
                return (
                  <button key={m.user_id} type="button" aria-pressed={on} disabled={!canEdit || pending} className={toggle(on)}
                    onClick={() => void run("cardMember", { user: m.user_id, on: !on })}>
                    <UserAvatar id={m.user_id} size={26} />
                    {m.full_name}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title={C.labels} id="card-labels">
            <div className="flex flex-wrap gap-2">
              {data.labels.map((l) => {
                const on = labels.includes(l.id);
                return (
                  <button key={l.id} type="button" aria-pressed={on} disabled={!canEdit || pending} onClick={() => void run("cardLabel", { label: l.id, on: !on })}
                    className={`inline-flex min-h-11 items-center gap-1 rounded-sm px-3 text-sm font-semibold ${on ? "ring-2 ring-ink ring-offset-2" : ""}`}
                    style={{ background: LABEL_HEX[l.color].bg, color: LABEL_HEX[l.color].fg }}>
                    {on && <span aria-hidden="true">✓</span>}{labelText(l, T)}
                  </button>
                );
              })}
            </div>
            {canEdit && (
              <details open={editLabels} onToggle={(e) => setEditLabels((e.target as HTMLDetailsElement).open)}>
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{C.editLabels}</summary>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {data.labels.map((l) => (
                    <li key={l.id}><LabelRow label={l} T={T} pending={pending}
                      onSave={(name, color) => void run("saveLabel", { label: l.id, name, color })}
                      onDelete={() => void run("deleteLabel", { label: l.id })} /></li>
                  ))}
                </ul>
                <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run("addLabel", newLabel, () => setNewLabel({ name: "", color: newLabel.color })); }}>
                  <label className="field min-w-0 flex-[1_1_160px]"><span>{C.newLabel}</span>
                    <input className="input" value={newLabel.name} maxLength={40} placeholder={C.labelName} onChange={(e) => setNewLabel({ ...newLabel, name: e.target.value })} />
                  </label>
                  <ColorPick value={newLabel.color} T={T} onChange={(color) => setNewLabel({ ...newLabel, color })} />
                  <button type="submit" className="btn btn-outline" disabled={pending}>{T.add}</button>
                </form>
              </details>
            )}
          </Section>

          <Section title={C.links} id="card-links">
            <form className="flex flex-col gap-3"
              onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); void run("linkCard", { client: fd.get("client"), project: fd.get("project"), order: fd.get("order") }, () => setMessage(C.saved)); }}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {([["client", data.options.clients, c.client_id, C.client], ["project", data.options.projects, c.project_id, C.project],
                   ["order", data.options.orders, c.sales_order_id, C.order]] as const).map(([name, options, value, text]) => (
                  <div key={name} className="field min-w-0"><span id={`card-link-${name}`}>{text}</span>
                    {canEdit ? (
                      <SearchSelect name={name} id={`card-link-${name}-input`} options={options.map((o) => ({ value: o.id, label: o.label }))}
                        defaultValue={value ?? ""} emptyLabel={C.none} placeholder={C.searchPlaceholder} noResults={C.searchNoResults} />
                    ) : <span className="text-sm">{(name === "client" ? c.client : name === "project" ? c.project : c.sales_order) ?? C.none}</span>}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                {c.sales_order_id && c.sales_order && <a className="text-ink underline" href={`/orders/${c.sales_order_id}`}>{c.sales_order}</a>}
                {c.client_id && c.client && <a className="text-ink underline" href={`/clients/${c.client_id}`}>{c.client}</a>}
                {c.project_id && c.project && <a className="text-ink underline" href="/projects">{c.project}</a>}
              </div>
              {canEdit && <button type="submit" className="btn btn-outline w-fit" disabled={pending}>{C.saveLinks}</button>}
            </form>
          </Section>

          <Section title={C.description} id="card-desc">
            {editingDescription ? (
              <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void saveText(); }}>
                <label className="sr-only" htmlFor="card-description">{C.description}</label>
                <textarea id="card-description" className="input" rows={6} autoFocus value={description} maxLength={10000}
                  placeholder={C.descriptionPlaceholder} onChange={(e) => setDescription(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className="btn btn-primary" disabled={pending}>{T.save}</button>
                  <button type="button" className="btn btn-outline" onClick={() => { setDescription(c.description); setEditingDescription(false); }}>{T.cancel}</button>
                </div>
              </form>
            ) : (
              <>
                {c.description ? <p className="m-0 text-sm break-words whitespace-pre-line"><Linked text={c.description} /></p>
                  : <p className="m-0 text-sm text-ink-2">{C.descriptionPlaceholder}</p>}
                {canEdit && <button type="button" className="btn btn-outline w-fit" onClick={() => setEditingDescription(true)}>{C.edit}</button>}
              </>
            )}
          </Section>

          <Section title={`${C.checklist}${items.length ? ` · ${items.filter((i) => i.done).length}/${items.length}` : ""}`} id="card-check">
            {items.length > 0 && (
              <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-mist">
                <div className="h-full bg-green" style={{ width: `${(items.filter((i) => i.done).length / items.length) * 100}%` }} />
              </div>
            )}
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {items.map((i, n) => (
                <li key={i.id} className="flex items-center gap-1">
                  <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm">
                    <input type="checkbox" className="h-5 w-5 shrink-0 accent-ink" checked={ticks[i.id] ?? i.done} disabled={!canEdit}
                      onChange={(e) => { const done = e.target.checked; setTicks((x) => ({ ...x, [i.id]: done })); void run("updateItem", { item: i.id, done }); }} />
                    <span className={`min-w-0 break-words ${(ticks[i.id] ?? i.done) ? "text-ink-2 line-through" : ""}`}>{i.text}</span>
                  </label>
                  {canEdit && n > 0 && <button type="button" aria-label={T.moveUp} className="h-11 w-11 shrink-0 rounded-sm hover:bg-mist"
                    onClick={() => void run("updateItem", { item: i.id, position: between(items[n - 2]?.position, items[n - 1].position) })}>↑</button>}
                  {canEdit && n < items.length - 1 && <button type="button" aria-label={T.moveDown} className="h-11 w-11 shrink-0 rounded-sm hover:bg-mist"
                    onClick={() => void run("updateItem", { item: i.id, position: between(items[n + 1].position, items[n + 2]?.position) })}>↓</button>}
                  {canEdit && <button type="button" aria-label={fmt(C.deleteItem, { text: i.text })} className="h-11 w-11 shrink-0 rounded-sm text-red-ink hover:bg-mist"
                    onClick={() => void run("deleteItem", { item: i.id })}>×</button>}
                </li>
              ))}
            </ul>
            {canEdit && (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newItem.trim()) void run("addItem", { text: newItem, position: between(items.at(-1)?.position, null) }, () => setNewItem("")); }}>
                <label className="sr-only" htmlFor="card-new-item">{C.itemPlaceholder}</label>
                <input id="card-new-item" className="input min-w-0" value={newItem} placeholder={C.itemPlaceholder} maxLength={500} onChange={(e) => setNewItem(e.target.value)} />
                <button type="submit" className="btn btn-outline shrink-0" disabled={pending || !newItem.trim()}>{T.add}</button>
              </form>
            )}
          </Section>

          <Section title={`${C.files}${files.length ? ` · ${files.length}` : ""}`} id="card-files">
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {files.map((f) => {
                const image = /^image\/(png|jpeg|webp)$/.test(f.mime ?? "");
                return (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 border-b border-mist pb-2 text-sm last:border-0">
                    {image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/files/board/${f.id}`} alt="" className="h-14 w-14 shrink-0 rounded-sm border border-line object-cover" />
                    )}
                    <span className="min-w-0 flex-[1_1_200px]">
                      <a href={`/files/board/${f.id}`} target="_blank" rel="noopener noreferrer" className="font-semibold break-all text-ink underline">{f.name}</a>
                      <span className="block text-xs text-ink-2">{size(locale, f.size)} · {nameOf(f.uploaded_by)} · {time(locale, f.created_at)}</span>
                    </span>
                    {canEdit && (f.uploaded_by === userId || isAdmin) && (
                      <button type="button" className="btn btn-outline" aria-label={fmt(C.deleteFile, { name: f.name })}
                        onClick={() => start(async () => { const r = await deleteBoardFile(boardId, f.id).catch((): { error: string; id?: string } => ({ error: T.stale })); if (r.error) setError(r.error); })}>
                        {T.delete}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {canEdit && (
              <>
                <label className="btn btn-outline w-fit cursor-pointer">
                  {C.upload}
                  <input type="file" multiple className="sr-only" accept={TASK_FILE_TYPES.map((x) => `.${x}`).join(",")}
                    onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ""; void upload(l); }} />
                </label>
                <p className="m-0 text-xs text-ink-2">{C.dropHint} · {fileText.limits}</p>
              </>
            )}
          </Section>

          <Section title={`${C.comments}${comments.length ? ` · ${comments.length}` : ""}`} id="card-comments">
            {comments.length === 0 && <p className="m-0 text-sm text-ink-2">{C.noComments}</p>}
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {comments.map((m) => (
                <li key={m.id} className="flex gap-2">
                  <UserAvatar id={m.author_id} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-xs"><span className="font-semibold">{nameOf(m.author_id)}</span> <span className="text-ink-2">{time(locale, m.created_at)}{m.edited_at ? ` · ${C.edited}` : ""}</span></p>
                    {editing?.id === m.id ? (
                      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void run("editComment", { comment: m.id, body: editing.body }, () => setEditing(null)); }}>
                        <label className="sr-only" htmlFor={`edit-${m.id}`}>{C.composerLabel}</label>
                        <textarea id={`edit-${m.id}`} className="input" value={editing.body} maxLength={5000} onChange={(e) => setEditing({ id: m.id, body: e.target.value })} />
                        <div className="flex gap-2">
                          <button type="submit" className="btn btn-primary" disabled={pending || !editing.body.trim()}>{T.save}</button>
                          <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>{T.cancel}</button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <p className="m-0 text-sm break-words whitespace-pre-line"><Linked text={m.body} /></p>
                        {canEdit && (m.author_id === userId || isAdmin) && (
                          <span className="flex gap-1">
                            {m.author_id === userId && <button type="button" className="min-h-11 px-2 text-xs font-semibold text-ink-2 hover:text-ink" onClick={() => setEditing({ id: m.id, body: m.body })}>{C.edit}</button>}
                            <button type="button" className="min-h-11 px-2 text-xs font-semibold text-ink-2 hover:text-red-ink" onClick={() => void run("deleteComment", { comment: m.id })}>{C.deleteComment}</button>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          {canEdit && (
            <div className="flex flex-col gap-3 border-t border-mist pt-4">
              {data.moveTargets.length > 0 && (
                <details>
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{C.moveTo}</summary>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="field min-w-0 flex-[1_1_180px]"><span>{C.board}</span>
                      <select className="input" value={target.board} onChange={(e) => setTarget({ board: e.target.value, list: "" })}>
                        <option value="">—</option>
                        {data.moveTargets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </label>
                    <label className="field min-w-0 flex-[1_1_180px]"><span>{C.list}</span>
                      <select className="input" value={target.list} disabled={!target.board} onChange={(e) => setTarget({ ...target, list: e.target.value })}>
                        <option value="">—</option>
                        {targetLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </label>
                    <button type="button" className="btn btn-primary" disabled={pending || !target.list}
                      onClick={() => void run("moveCard", { list: target.list, position: Date.now() / 1e6 }, () => onClose())}>{C.move}</button>
                  </div>
                </details>
              )}
              <div className="flex flex-wrap gap-2">
                {!c.archived_at && <button type="button" className="btn btn-outline" disabled={pending} onClick={() => void run("archiveCard", { on: true }, () => onClose())}>{C.archive}</button>}
                {confirmDelete ? (
                  <span className="flex flex-col gap-2">
                    <span className="text-sm font-semibold">{C.deleteCardConfirm}</span>
                    <span className="flex flex-wrap gap-2">
                      <button type="button" className="btn btn-primary" disabled={pending}
                        onClick={() => start(async () => { const r = await deleteBoardPart(boardId, "card", c.id).catch((): { error: string; id?: string } => ({ error: T.stale })); if (r.error) setError(r.error); else onClose(); })}>{C.deleteCard}</button>
                      <button type="button" className="btn btn-outline" onClick={() => setConfirmDelete(false)}>{T.cancel}</button>
                    </span>
                  </span>
                ) : <button type="button" className="btn btn-outline text-red-ink" onClick={() => setConfirmDelete(true)}>{C.deleteCard}</button>}
              </div>
            </div>
          )}
        </div>

        {canEdit && (
          <form className="relative flex flex-col gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            {mentionQuery != null && mentionable.length > 0 && (
              <ul role="listbox" aria-label={C.composerLabel} className="absolute bottom-full left-3 z-10 m-0 mb-1 flex max-h-56 w-64 max-w-[calc(100%-24px)] list-none flex-col overflow-y-auto rounded-sm border border-line bg-white p-1 shadow-lg">
                {mentionable.map((m) => (
                  <li key={m.user_id} role="option" aria-selected="false">
                    <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-mist"
                      aria-label={fmt(C.mention, { name: m.full_name })} onMouseDown={(e) => { e.preventDefault(); pickMention(m); }}>
                      <UserAvatar id={m.user_id} size={28} />
                      {m.full_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="sr-only" htmlFor="card-composer">{C.composerLabel}</label>
            <textarea id="card-composer" ref={composer} className="input min-h-[52px]" rows={2} value={body} maxLength={5000} placeholder={C.composer}
              onChange={(e) => {
                setBody(e.target.value);
                const m = e.target.value.slice(0, e.target.selectionStart).match(/(?:^|\s)@([^\s@]{0,30})$/);
                setMentionQuery(m ? m[1] : null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && mentionQuery != null) { e.stopPropagation(); setMentionQuery(null); return; }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (mentionQuery != null && mentionable[0]) pickMention(mentionable[0]); else void send();
                }
              }} />
            <button type="submit" className="btn btn-primary w-fit" disabled={pending || !body.trim()}>{C.send}</button>
          </form>
        )}
      </div>
    </div>
  );
}

function ColorPick({ value, T, onChange }: { value: LabelColor; T: T; onChange: (c: LabelColor) => void }) {
  return (
    <span role="radiogroup" aria-label={T.color} className="flex flex-wrap gap-1">
      {LABEL_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={T.colors[c]} title={T.colors[c]} onClick={() => onChange(c)}
          className={`h-11 w-11 rounded-sm ${value === c ? "ring-2 ring-ink ring-offset-2" : ""}`} style={{ background: LABEL_HEX[c].bg }} />
      ))}
    </span>
  );
}

function LabelRow({ label, T, pending, onSave, onDelete }: {
  label: BoardData["labels"][number]; T: T; pending: boolean; onSave: (name: string, color: LabelColor) => void; onDelete: () => void;
}) {
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState<LabelColor>(label.color);
  const changed = name.trim() !== label.name || color !== label.color;
  return (
    <form className="flex flex-wrap items-end gap-2 border-b border-mist pb-2" onSubmit={(e) => { e.preventDefault(); onSave(name, color); }}>
      <label className="field min-w-0 flex-[1_1_140px]"><span className="sr-only">{T.card.labelName}</span>
        <input className="input" value={name} maxLength={40} placeholder={labelText(label, T)} onChange={(e) => setName(e.target.value)} />
      </label>
      <ColorPick value={color} T={T} onChange={setColor} />
      {changed && <button type="submit" className="btn btn-primary" disabled={pending}>{T.save}</button>}
      <button type="button" className="btn btn-outline text-red-ink" disabled={pending} onClick={onDelete}>{T.card.deleteLabel}</button>
    </form>
  );
}
