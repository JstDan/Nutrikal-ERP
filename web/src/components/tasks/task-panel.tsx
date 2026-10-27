"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { fmt, formatDate, formatNumber, formatQty, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import {
  blockersOf, blockingOf, columnName, fileExt, initials, itemText, linkParts, taskTitle, TASK_FILE_MAX, TASK_FILE_TYPES, TASK_STATUSES,
  type BoardData, type BoardTask, type MaterialLine, type TaskStatus,
} from "@/lib/tasks-shared";
import { deleteTaskFile, taskOp, uploadTaskFile } from "@/app/task-actions";
import { noteText } from "@/components/tasks/board";

type T = Dict["tasks"];
type Props = {
  orderId: string; task: BoardTask; data: BoardData; T: T; locale: Locale; userId: string; isAdmin: boolean;
  realtime: { url: string; key: string } | null; onClose: () => void; onOpenTask: (id: string) => void;
};

const time = (l: Locale, d: string) => formatDate(l, d, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const size = (l: Locale, n: number) => (n >= 1048576 ? `${formatNumber(l, n / 1048576, 1)} MB` : `${formatNumber(l, Math.max(1, Math.round(n / 1024)))} KB`);

function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
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

/** A task: right-side panel on wide screens, full screen on phones. */
export function TaskPanel({ orderId, task: t, data, T, locale, userId, isAdmin, realtime, onClose, onOpenTask }: Props) {
  const P = T.panel;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const users = useMemo(() => new Map(data.users.map((u) => [u.id, u])), [data.users]);
  const nameOf = (id: string | null) => (id ? users.get(id)?.full_name ?? "—" : P.system);
  const title = taskTitle(t, locale);
  const manual = t.kind === "manual";
  const column = data.columns.find((c) => c.id === t.column_id);

  const run = (op: Parameters<typeof taskOp>[1], args: Record<string, unknown>, after?: (r: { id?: string; n?: number }) => void) =>
    new Promise<boolean>((resolve) => start(async () => {
      setError(null); setMessage(null);
      const r = await taskOp(orderId, op, { task: t.id, ...args });
      if (r.error) { setError(r.error); resolve(false); } else { after?.(r); resolve(true); }
    }));

  // Escape closes; focus starts on the close button
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Opened = read; again when new messages arrive while it is open
  const comments = data.comments.filter((c) => c.task_id === t.id);
  useEffect(() => { void taskOp(orderId, "markRead", { task: t.id }); }, [orderId, t.id, comments.length]);

  // Live chat: Supabase Realtime when configured, otherwise a gentle refresh while open
  useEffect(() => {
    if (!realtime) {
      const timer = window.setInterval(() => router.refresh(), 15000);
      return () => window.clearInterval(timer);
    }
    const client = createBrowserClient(realtime.url, realtime.key);
    const channel = client.channel(`task-${t.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_task_comments", filter: `task_id=eq.${t.id}` }, () => router.refresh())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [realtime, t.id, router]);

  // ---- details
  const [editTitle, setEditTitle] = useState(t.title);
  const [description, setDescription] = useState(t.description);
  const [editingDescription, setEditingDescription] = useState(false);
  const saveDetails = (assignee: string | null = t.assignee_id) =>
    run("saveTask", { title: editTitle, description, assignee }, () => { setEditingDescription(false); setMessage(P.saved); });

  // ---- checklist
  const items = data.checklist.filter((c) => c.task_id === t.id).sort((a, b) => a.position - b.position);
  const [newItem, setNewItem] = useState("");

  // ---- dependencies and links
  const blockers = blockersOf(data);
  const blocking = blockingOf(data);
  const waitsFor = data.deps.filter((d) => d.task_id === t.id).map((d) => data.tasks.find((x) => x.id === d.depends_on_task_id)).filter(Boolean) as BoardTask[];
  const blocks = data.deps.filter((d) => d.depends_on_task_id === t.id).map((d) => data.tasks.find((x) => x.id === d.task_id)).filter(Boolean) as BoardTask[];
  const others = data.tasks.filter((x) => x.id !== t.id && !waitsFor.some((w) => w.id === x.id));
  const links = data.links.filter((l) => l.task_id === t.id);
  const linkChoices = data.linkOptions.filter((o) => !links.some((l) => l.entity_type === o.entity_type && l.entity_id === o.entity_id));

  // ---- files
  const files = data.files.filter((f) => f.task_id === t.id);
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const upload = async (list: File[], commentId?: string) => {
    setError(null);
    for (const f of list) {
      if (f.size > TASK_FILE_MAX) { setError(fmt(P.fileTooBig, { name: f.name })); continue; }
      if (!TASK_FILE_TYPES.includes(fileExt(f.name))) { setError(fmt(P.fileType, { name: f.name })); continue; }
      setUploading(f.name);
      const fd = new FormData();
      fd.set("order_id", orderId); fd.set("task_id", t.id); fd.set("file", f);
      if (commentId) fd.set("comment_id", commentId);
      const r = await uploadTaskFile(fd);
      if (r.error) setError(r.error);
    }
    setUploading(null);
    router.refresh();
  };

  // ---- chat
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [attach, setAttach] = useState<File[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "nearest" }); }, [comments.length]);
  const mentionable = data.users.filter((u) => u.id !== userId && (mentionQuery == null || u.full_name.toLowerCase().includes(mentionQuery.toLowerCase())));
  const onBodyChange = (v: string, caret: number) => {
    setBody(v);
    const m = v.slice(0, caret).match(/(?:^|\s)@([^\s@]{0,30})$/);
    setMentionQuery(m ? m[1] : null);
  };
  const pickMention = (u: { id: string; full_name: string }) => {
    const el = composer.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${u.full_name} `);
    setBody(before + body.slice(caret));
    setMentions((m) => (m.includes(u.id) ? m : [...m, u.id]));
    setMentionQuery(null);
    el?.focus();
  };
  const send = async () => {
    if (!body.trim() && attach.length === 0) return;
    const used = mentions.filter((id) => body.includes(`@${users.get(id)?.full_name ?? ""}`));
    const files = attach;
    const ok = await run("postComment", { body, mentions: used }, (r) => {
      setBody(""); setMentions([]); setAttach([]);
      if (files.length && r.id) void upload(files, r.id);
    });
    if (ok) composer.current?.focus();
  };

  // ---- automatic tasks: the rule in words, override by admin
  const [reason, setReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isMaterials = t.auto_rule === "materials_available";
  const note = noteText(t.note, T);

  const statusOptions = TASK_STATUSES;
  const activity = data.activity.filter((a) => a.task_id === t.id);
  const sourceText = (s: unknown) => (typeof s === "string" ? (T.sources as Record<string, string>)[s] ?? s : "");
  const activityText = (a: BoardData["activity"][number]) => {
    const p = a.payload as Record<string, unknown>;
    const A = T.activity as Record<string, string>;
    const s = (k: string) => (p[k] == null ? "" : String(p[k]));
    switch (a.action) {
      case "status": return fmt(A.status, { from: T.status[s("from") as TaskStatus] ?? s("from"), to: T.status[s("to") as TaskStatus] ?? s("to") });
      case "assigned": return p.to ? fmt(A.assigned, { to: s("to") }) : A.unassigned;
      case "override": return fmt(A.override, { done: p.done ? A.doneWord : A.notDoneWord, reason: s("reason") });
      case "auto_done": case "auto_undone": return fmt(A[a.action], { source: sourceText(p.source) });
      default: return A[a.action] ? fmt(A[a.action], Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v ?? "")]))) : a.action;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(0,0,0,0.45)]" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="task-panel-h"
        className={`flex h-full w-full max-w-[600px] flex-col bg-white shadow-2xl ${dragOver ? "outline-4 -outline-offset-4 outline-dashed outline-ink-2" : ""}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragOver(false); void upload(Array.from(e.dataTransfer.files)); } }}>
        <header className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div className="min-w-0">
            <p className="m-0 text-xs text-ink-2">{column ? columnName(column, locale) : ""}</p>
            <h2 id="task-panel-h" className="m-0 text-lg font-bold break-words">{!manual && <span aria-label={T.auto} className="text-amber-ink">⚡ </span>}{title}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="btn btn-outline shrink-0">{P.close}</button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {(error || message || uploading) && (
            <p role="status" aria-live="polite" className="m-0 text-sm font-semibold">
              {error && <span className="text-red-ink">{error}</span>}
              {!error && message && <span className="text-green-ink">{message}</span>}
              {uploading && <span className="text-ink-2"> {fmt(P.uploading, { name: uploading })}</span>}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="field">
              <span>{P.kind}</span>
              <p className="m-0 text-sm">{manual ? T.manual : <>{T.auto} — {(T.rules as Record<string, string>)[t.auto_rule ?? ""]}</>}</p>
            </div>
            <label className="field">
              <span>{P.status}</span>
              {manual ? (
                <select className="input" value={t.status} disabled={pending}
                  onChange={(e) => void run("setStatus", { status: e.target.value })}>
                  {statusOptions.map((s) => <option key={s} value={s}>{T.status[s]}</option>)}
                </select>
              ) : <span className="text-sm font-semibold">{T.status[t.status]}{note ? ` · ${note}` : ""}</span>}
            </label>
            {manual && (
              <label className="field">
                <span>{P.column}</span>
                <select className="input" value={t.column_id} disabled={pending}
                  onChange={(e) => void run("moveTask", { column: e.target.value, position: null })}>
                  {data.columns.filter((c) => !c.hidden || c.id === t.column_id).sort((a, b) => a.position - b.position)
                    .map((c) => <option key={c.id} value={c.id}>{columnName(c, locale)}</option>)}
                </select>
              </label>
            )}
            <label className="field">
              <span>{P.assignee}</span>
              <select className="input" value={t.assignee_id ?? ""} disabled={pending}
                onChange={(e) => void saveDetails(e.target.value || null)}>
                <option value="">{P.nobody}</option>
                {data.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </label>
          </div>

          {manual && (
            <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void saveDetails(); }}>
              <label className="field"><span>{P.titleLabel}</span>
                <input className="input" value={editTitle} maxLength={300} onChange={(e) => setEditTitle(e.target.value)} />
              </label>
              {editTitle.trim() !== t.title && <button type="submit" className="btn btn-primary w-fit" disabled={pending || !editTitle.trim()}>{P.save}</button>}
            </form>
          )}

          {!manual && t.override && (
            <p className="m-0 rounded-sm bg-amber-tint p-3 text-sm text-amber-ink">{fmt(P.overridden, { reason: t.override_reason ?? "" })}</p>
          )}
          {!manual && isAdmin && (
            <details className="rounded-sm border border-line p-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{P.override}</summary>
              <div className="flex flex-col gap-3 pt-2">
                <p className="m-0 text-xs text-ink-2">{P.overrideHint}</p>
                <label className="field"><span>{P.overrideReason} *</span>
                  <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary" disabled={pending || !reason.trim()}
                    onClick={() => void run("override", { done: t.status !== "done", reason }, () => setReason(""))}>
                    {t.status === "done" ? P.markNotDone : P.markDone}
                  </button>
                  {t.override && <button type="button" className="btn btn-outline" disabled={pending} onClick={() => void run("clearOverride", {})}>{P.clearOverride}</button>}
                </div>
              </div>
            </details>
          )}

          <Section title={P.description} id="task-desc">
            {editingDescription ? (
              <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void saveDetails(); }}>
                <label className="sr-only" htmlFor="task-description">{P.description}</label>
                <textarea id="task-description" className="input" rows={5} value={description} placeholder={P.descriptionPlaceholder}
                  onChange={(e) => setDescription(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className="btn btn-primary" disabled={pending}>{P.save}</button>
                  <button type="button" className="btn btn-outline" onClick={() => { setDescription(t.description); setEditingDescription(false); }}>{T.cancel}</button>
                </div>
              </form>
            ) : (
              <>
                {t.description ? <p className="m-0 text-sm break-words whitespace-pre-line"><Linked text={t.description} /></p>
                  : <p className="m-0 text-sm text-ink-2">{P.descriptionPlaceholder}</p>}
                <button type="button" className="btn btn-outline w-fit" onClick={() => setEditingDescription(true)}>{P.edit}</button>
              </>
            )}
          </Section>

          {isMaterials && <Materials orderId={orderId} data={data} T={T} locale={locale} />}

          <Section title={`${P.checklist}${items.length ? ` · ${items.filter((i) => i.done).length}/${items.length}` : ""}`} id="task-check">
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {items.map((i, n) => (
                <li key={i.id} className="flex items-center gap-2">
                  <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm">
                    <input type="checkbox" className="h-5 w-5 shrink-0 accent-ink" checked={i.done} disabled={pending}
                      onChange={(e) => void run("updateItem", { item: i.id, done: e.target.checked })} />
                    <span className={`min-w-0 break-words ${i.done ? "text-ink-2 line-through" : ""}`}>{itemText(i, locale)}</span>
                  </label>
                  {n > 0 && <button type="button" aria-label={T.moveUp} className="h-11 w-11 shrink-0 rounded-sm hover:bg-mist" onClick={() => void run("updateItem", { item: i.id, position: n })}>↑</button>}
                  {n < items.length - 1 && <button type="button" aria-label={T.moveDown} className="h-11 w-11 shrink-0 rounded-sm hover:bg-mist" onClick={() => void run("updateItem", { item: i.id, position: n + 2 })}>↓</button>}
                  <button type="button" aria-label={fmt(P.deleteItem, { text: itemText(i, locale) })} className="h-11 w-11 shrink-0 rounded-sm text-red-ink hover:bg-mist"
                    onClick={() => void run("deleteItem", { item: i.id })}>×</button>
                </li>
              ))}
            </ul>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newItem.trim()) void run("addItem", { text: newItem }, () => setNewItem("")); }}>
              <label className="sr-only" htmlFor="task-new-item">{P.itemPlaceholder}</label>
              <input id="task-new-item" className="input" value={newItem} placeholder={P.itemPlaceholder} maxLength={500} onChange={(e) => setNewItem(e.target.value)} />
              <button type="submit" className="btn btn-outline shrink-0" disabled={pending || !newItem.trim()}>{P.addItem}</button>
            </form>
          </Section>

          <Section title={P.dependencies} id="task-deps">
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">{P.waitsFor}</span>
              {waitsFor.length === 0 && <span className="text-ink-2">{P.none}</span>}
              {waitsFor.map((w) => (
                <span key={w.id} className="flex items-center gap-2">
                  <button type="button" className={`min-h-11 min-w-0 flex-1 text-left break-words underline ${w.status === "done" ? "text-ink-2" : "font-semibold text-red-ink"}`} onClick={() => onOpenTask(w.id)}>
                    {w.status === "done" ? "✓ " : ""}{taskTitle(w, locale)}
                  </button>
                  <button type="button" aria-label={fmt(P.removeDependency, { title: taskTitle(w, locale) })} className="h-11 w-11 shrink-0 rounded-sm hover:bg-mist"
                    onClick={() => void run("setDependency", { on: w.id, add: false })}>×</button>
                </span>
              ))}
              <label className="sr-only" htmlFor="task-add-dep">{P.addDependency}</label>
              <select id="task-add-dep" className="input" value="" disabled={pending} onChange={(e) => e.target.value && void run("setDependency", { on: e.target.value, add: true })}>
                <option value="">{P.addDependency}</option>
                {others.map((x) => <option key={x.id} value={x.id}>{taskTitle(x, locale)}</option>)}
              </select>
              <span className="mt-2 font-semibold">{P.blocks}</span>
              {blocks.length === 0 && <span className="text-ink-2">{P.none}</span>}
              {blocks.map((b) => (
                <button key={b.id} type="button" className="min-h-11 text-left break-words underline" onClick={() => onOpenTask(b.id)}>
                  {taskTitle(b, locale)}{blockers.get(b.id)?.length ? ` · ${fmt(T.blockedN, { n: blockers.get(b.id)!.length })}` : ""}
                </button>
              ))}
              {blocking.get(t.id)?.length ? null : null}
            </div>
          </Section>

          <Section title={P.links} id="task-links">
            <div className="flex flex-wrap gap-2">
              {links.length === 0 && <span className="text-sm text-ink-2">{P.none}</span>}
              {links.map((l) => (
                <span key={l.id} className="inline-flex items-center gap-1 rounded-full bg-neutral-tint pl-3 text-xs font-semibold">
                  {l.href ? <a href={l.href} className="flex min-h-11 items-center text-ink">{(T.linkTypes as Record<string, string>)[l.entity_type]} {l.label}</a>
                    : <span className="flex min-h-11 items-center">{l.label}</span>}
                  {!l.is_auto ? (
                    <button type="button" aria-label={fmt(P.removeLink, { label: l.label })} className="h-11 w-11 rounded-full hover:bg-mist"
                      onClick={() => void run("removeLink", { link: l.id })}>×</button>
                  ) : <span className="w-3" />}
                </span>
              ))}
            </div>
            {linkChoices.length > 0 && (
              <>
                <label className="sr-only" htmlFor="task-add-link">{P.addLink}</label>
                <select id="task-add-link" className="input" value="" disabled={pending}
                  onChange={(e) => { const [type, entity] = e.target.value.split("|"); if (entity) void run("addLink", { type, entity }); }}>
                  <option value="">{P.addLink}</option>
                  {linkChoices.map((o) => (
                    <option key={o.entity_type + o.entity_id} value={`${o.entity_type}|${o.entity_id}`}>
                      {(T.linkTypes as Record<string, string>)[o.entity_type]} · {o.label}
                    </option>
                  ))}
                </select>
              </>
            )}
          </Section>

          <Section title={`${P.files}${files.length ? ` · ${files.length}` : ""}`} id="task-files">
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {files.map((f) => {
                const image = /^image\/(png|jpeg|webp)$/.test(f.mime ?? "");
                return (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 border-b border-mist pb-2 text-sm last:border-0">
                    {image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/files/task/${f.id}`} alt="" className="h-14 w-14 shrink-0 rounded-sm border border-line object-cover" />
                    )}
                    <span className="min-w-0 flex-[1_1_200px]">
                      <a href={`/files/task/${f.id}`} target="_blank" rel="noopener noreferrer" className="font-semibold break-all text-ink underline">{f.name}</a>
                      <span className="block text-xs text-ink-2">{size(locale, f.size)} · {nameOf(f.uploaded_by)} · {time(locale, f.created_at)}</span>
                    </span>
                    {(f.uploaded_by === userId || isAdmin) && (
                      <button type="button" className="btn btn-outline" aria-label={fmt(P.deleteFile, { name: f.name })}
                        onClick={() => start(async () => { const r = await deleteTaskFile(orderId, f.id); if (r.error) setError(r.error); })}>
                        {P.deleteMessage}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <label className="btn btn-outline w-fit cursor-pointer">
              {P.upload}
              <input type="file" multiple className="sr-only" accept={TASK_FILE_TYPES.map((x) => `.${x}`).join(",")}
                onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ""; void upload(l); }} />
            </label>
            <p className="m-0 text-xs text-ink-2">{P.dropHint} · {P.fileLimits}</p>
          </Section>

          <details className="border-t border-mist pt-4">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold tracking-[1px] uppercase text-ink-2">{P.activity} · {activity.length}</summary>
            <ol className="m-0 flex list-none flex-col gap-2 p-0 pt-2 text-sm">
              {activity.length === 0 && <li className="text-ink-2">{P.noActivity}</li>}
              {activity.map((a) => (
                <li key={a.id} className="break-words">
                  <span className="font-semibold">{a.actor_id ? nameOf(a.actor_id) : `⚡ ${P.system}`}</span> {activityText(a)}
                  <span className="block text-xs text-ink-2">{time(locale, a.created_at)}</span>
                </li>
              ))}
            </ol>
          </details>

          <Section title={`${P.comments}${comments.length ? ` · ${comments.filter((c) => !c.deleted_at).length}` : ""}`} id="task-chat">
            <div className="flex max-h-[50vh] min-h-24 flex-col gap-3 overflow-y-auto pr-1">
              {comments.length === 0 && <p className="m-0 text-sm text-ink-2">{P.noComments}</p>}
              {comments.map((c, i) => {
                const own = c.author_id === userId;
                const grouped = i > 0 && comments[i - 1].author_id === c.author_id
                  && new Date(c.created_at).getTime() - new Date(comments[i - 1].created_at).getTime() < 10 * 60000;
                const attached = files.filter((f) => f.comment_id === c.id);
                return (
                  <div key={c.id} className={`flex gap-2 ${grouped ? "-mt-2" : ""}`}>
                    <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${grouped ? "invisible" : "bg-ink text-white"}`}>
                      {initials(nameOf(c.author_id))}
                    </span>
                    <div className="min-w-0 flex-1">
                      {!grouped && <p className="m-0 text-xs"><span className="font-semibold">{nameOf(c.author_id)}</span> <span className="text-ink-2">{time(locale, c.created_at)}</span></p>}
                      {c.deleted_at ? <p className="m-0 text-sm text-ink-2 italic">{P.deleted}</p> : editing?.id === c.id ? (
                        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void run("editComment", { comment: c.id, body: editing.body }, () => setEditing(null)); }}>
                          <label className="sr-only" htmlFor={`edit-${c.id}`}>{P.composerLabel}</label>
                          <textarea id={`edit-${c.id}`} className="input" value={editing.body} onChange={(e) => setEditing({ id: c.id, body: e.target.value })} />
                          <div className="flex gap-2">
                            <button type="submit" className="btn btn-primary" disabled={pending || !editing.body.trim()}>{P.editSave}</button>
                            <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>{T.cancel}</button>
                          </div>
                        </form>
                      ) : (
                        <>
                          {c.body && <p className="m-0 text-sm break-words whitespace-pre-line"><Linked text={c.body} />{c.edited_at && <span className="text-xs text-ink-2"> ({P.edited})</span>}</p>}
                          {attached.map((f) => <a key={f.id} href={`/files/task/${f.id}`} target="_blank" rel="noopener noreferrer" className="block text-xs font-semibold break-all text-ink underline">📎 {f.name}</a>)}
                          {(own || isAdmin) && (
                            <span className="flex gap-1">
                              {own && <button type="button" className="min-h-11 px-2 text-xs font-semibold text-ink-2 hover:text-ink" onClick={() => setEditing({ id: c.id, body: c.body })}>{P.edit}</button>}
                              <button type="button" className="min-h-11 px-2 text-xs font-semibold text-ink-2 hover:text-red-ink" onClick={() => void run("deleteComment", { comment: c.id })}>{P.deleteMessage}</button>
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={chatEnd} />
            </div>
          </Section>

          {/* Admin deletes any task of this order (the template stays as it is); others only the tasks they added */}
          {(isAdmin || (manual && !t.template_key && t.created_by === userId)) && (
            <div className="flex flex-col gap-2 border-t border-mist pt-4">
              {confirmDelete ? (
                <>
                  <p className="m-0 text-sm font-semibold">{P.deleteConfirm}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn btn-primary" disabled={pending}
                      onClick={() => void run("deleteTask", {}, () => onClose())}>{P.deleteTask}</button>
                    <button type="button" className="btn btn-outline" onClick={() => setConfirmDelete(false)}>{T.cancel}</button>
                  </div>
                </>
              ) : (
                <button type="button" className="btn btn-outline w-fit" onClick={() => setConfirmDelete(true)}>{P.deleteTask}</button>
              )}
            </div>
          )}
        </div>

        <form className="relative flex flex-col gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          {mentionQuery != null && mentionable.length > 0 && (
            <ul role="listbox" aria-label={P.composerLabel} className="absolute bottom-full left-3 z-10 m-0 mb-1 flex max-h-56 w-64 max-w-[calc(100%-24px)] list-none flex-col overflow-y-auto rounded-sm border border-line bg-white p-1 shadow-lg">
              {mentionable.map((u) => (
                <li key={u.id} role="option" aria-selected="false">
                  <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-mist"
                    aria-label={fmt(P.mention, { name: u.full_name })} onMouseDown={(e) => { e.preventDefault(); pickMention(u); }}>
                    <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">{initials(u.full_name)}</span>
                    {u.full_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="sr-only" htmlFor="task-composer">{P.composerLabel}</label>
          <textarea id="task-composer" ref={composer} className="input min-h-[52px]" rows={2} value={body} placeholder={P.composer}
            onChange={(e) => onBodyChange(e.target.value, e.target.selectionStart)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && mentionQuery != null) { e.stopPropagation(); setMentionQuery(null); return; }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (mentionQuery != null && mentionable[0]) pickMention(mentionable[0]); else void send();
              }
            }} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn btn-primary" disabled={pending || (!body.trim() && attach.length === 0)}>{P.send}</button>
            <label className="btn btn-outline cursor-pointer">
              {P.attach}
              <input type="file" multiple className="sr-only" accept={TASK_FILE_TYPES.map((x) => `.${x}`).join(",")}
                onChange={(e) => { setAttach(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
            </label>
            {attach.length > 0 && <span className="text-xs text-ink-2">{fmt(P.attached, { n: attach.length })}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

/** Raw-material availability of the order: missing without an order first, then incoming, then the rest (collapsed). */
function Materials({ orderId, data, T, locale }: { orderId: string; data: BoardData; T: T; locale: Locale }) {
  const M = T.materials;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const check = data.checks[0];
  const order = ["short_no_order", "short_incoming", "ok"];
  const lines = [...(check?.lines ?? [])].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  const short = lines.filter((l) => l.status !== "ok");
  const ok = lines.filter((l) => l.status === "ok");
  const run = (op: "refreshMaterials" | "requestMissing") => start(async () => {
    const r = await taskOp(orderId, op, {});
    setMsg(r.error ? { ok: false, text: r.error } : op === "requestMissing" ? { ok: true, text: r.n ? fmt(M.requested, { n: r.n }) : M.nothingToRequest } : null);
  });
  const name = (l: MaterialLine) => (locale === "bg" && l.name_bg ? l.name_bg : l.name);
  const row = (l: MaterialLine) => (
    <li key={l.item_id} className="flex flex-col gap-1 border-b border-mist py-2 text-sm last:border-0">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 font-semibold break-words">{name(l)} <span className="text-xs font-normal text-ink-2">{l.sku} · {(M.kind as Record<string, string>)[l.kind] ?? l.kind}</span></span>
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${l.status === "ok" ? "bg-green-tint text-green-ink" : l.status === "short_incoming" ? "bg-amber-tint text-amber-ink" : "bg-red-tint text-red-ink"}`}>
          {M.status[l.status]}
        </span>
      </span>
      <span className="text-xs text-ink-2">
        {M.required}: {formatQty(locale, l.required, l.unit)} · {M.reserved}: {formatQty(locale, l.reserved, l.unit)} · {M.free}: {formatQty(locale, l.free, l.unit)}
        {l.incoming > 0 && <> · {M.incoming}: {fmt(M.incomingOn, { qty: formatQty(locale, l.incoming, l.unit), date: formatDate(locale, l.incoming_on) })}{l.incoming_ref ? ` (${l.incoming_ref})` : ""}</>}
      </span>
    </li>
  );
  return (
    <Section title={T.panel.materials} id="task-materials">
      {!check ? <p className="m-0 text-sm text-ink-2">{M.noCheck}</p> : (
        <>
          <p className="m-0 text-sm">
            <strong>{fmt(M.summary, { ok: check.ok, total: check.total })}</strong>
            <span className="text-ink-2"> · {fmt(M.checked, { date: time(locale, check.checked_at) })}</span>
          </p>
          {check.recipe_versions.length > 0 && <p className="m-0 text-xs text-ink-2">{fmt(M.recipes, { list: check.recipe_versions.map((v) => `${v.code} v${v.version}`).join(", ") })}</p>}
          <ul className="m-0 list-none p-0">{short.map(row)}</ul>
          {ok.length > 0 && (
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{fmt(M.moreOk, { n: ok.length })}</summary>
              <ul className="m-0 list-none p-0">{ok.map(row)}</ul>
            </details>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {short.some((l) => l.status === "short_no_order") && (
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run("requestMissing")}>{M.requestMissing}</button>
        )}
        <button type="button" className="btn btn-outline" disabled={pending} onClick={() => run("refreshMaterials")}>{M.checkAgain}</button>
        <a href={data.formulaHref ?? "/formulas"} className="btn btn-outline">{M.openRecipes}</a>
      </div>
      {msg && <p role="status" className={`m-0 text-sm font-semibold ${msg.ok ? "text-green-ink" : "text-red-ink"}`}>{msg.text}</p>}
      {data.checks.length > 1 && (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{M.history}</summary>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-ink-2">
            {data.checks.slice(1).map((c) => (
              <li key={c.id}>{fmt(M.historyRow, { date: time(locale, c.checked_at), source: (T.sources as Record<string, string>)[c.source] ?? c.source, ok: c.ok, total: c.total })}</li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}
