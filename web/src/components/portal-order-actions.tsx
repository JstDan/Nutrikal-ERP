"use client";

import { useState, useTransition } from "react";
import { fmt, formatDate, formatNumber, type AnyLocale } from "@/lib/i18n";
import type { PortalText } from "@/lib/i18n/portal";
import { portalLabelDecide, portalReorder } from "@/app/portal/actions";

type Line = { id: string; description: string; quantity: number };
type Request = { id: string; lines: { description: string; quantity: number }[]; note: string | null; status: "new" | "done" | "declined"; asked_at: string; reason: string | null; new_code: string | null };
export type PortalLabel = { id: string; file_id: string; file_name: string; status: "pending" | "approved" | "changes"; note: string | null; client_comment: string | null; requested_at: string; decided_at: string | null; decided_name: string | null };

const TONE = { new: "bg-amber-tint text-amber-ink", done: "bg-green-tint text-green-ink", declined: "bg-neutral-tint text-ink-2" } as const;

/** Order again: the same products with the quantities the client wants; the team confirms the order and prices. */
export function PortalReorder({ orderId, lines, requests, P, locale }: { orderId: string; lines: Line[]; requests: Request[]; P: PortalText; locale: AnyLocale }) {
  const R = P.reorder;
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, String(Number(l.quantity))])));
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const send = () => start(async () => {
    const r = await portalReorder(orderId, lines.map((l) => ({ line_id: l.id, quantity: Number((qty[l.id] ?? "0").replace(",", ".")) || 0 })), note);
    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? "" });
    if (!r.error) setOpen(false);
  });
  return (
    <div className="flex flex-col gap-3">
      {!open ? <button type="button" className="btn btn-primary w-fit" onClick={() => setOpen(true)}>{R.title}</button> : (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <p className="m-0 text-sm text-ink-2">{R.intro}</p>
          {lines.map((l) => (
            <label key={l.id} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-3 text-sm">
              <span className="min-w-0 break-words">{l.description}</span>
              <span className="field"><span className="sr-only">{R.quantity}</span>
                <input className="input text-right tabular-nums" inputMode="decimal" value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} aria-label={`${R.quantity}: ${l.description}`} />
              </span>
            </label>
          ))}
          <label className="field"><span>{R.note}</span><textarea className="input" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary" disabled={pending}>{R.send}</button>
            <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>×</button>
          </div>
        </form>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`m-0 text-sm font-semibold ${msg.ok ? "text-green-ink" : "text-red-ink"}`}>{msg.text}</p>}
      {requests.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-mist pt-3">
          <h3 className="m-0 text-sm font-bold">{R.list}</h3>
          {requests.map((q) => (
            <div key={q.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
              <span className="min-w-0 flex-[1_1_220px] break-words">
                {q.lines.map((l) => `${formatNumber(locale, Number(l.quantity))} × ${l.description}`).join(", ")}
                <span className="block text-xs text-ink-2">{R.asked} {formatDate(locale, q.asked_at)}{q.note ? ` · ${q.note}` : ""}</span>
              </span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[q.status]}`}>
                {q.status === "done" ? fmt(R.done, { code: q.new_code ?? "" }) : q.status === "declined" ? fmt(R.declined, { reason: q.reason ?? "" }) : R.waiting}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Labels sent for approval: open the file, approve it or ask for changes with a comment. */
export function PortalLabels({ orderId, labels, P, locale }: { orderId: string; labels: PortalLabel[]; P: PortalText; locale: AnyLocale }) {
  const L = P.labels;
  const [asking, setAsking] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decide = (id: string, approve: boolean) => start(async () => {
    setError(null);
    const r = await portalLabelDecide(orderId, id, approve, approve ? "" : comment);
    if (r.error) setError(r.error); else { setAsking(null); setComment(""); }
  });
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {labels.map((l) => (
        <li key={l.id} className="flex flex-col gap-2 rounded-md border border-line p-3 text-sm">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <a href={`/portal/files/${l.file_id}?view=1`} target="_blank" rel="noopener" className="font-semibold break-all text-ink underline">{l.file_name}</a>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${l.status === "approved" ? "bg-green-tint text-green-ink" : l.status === "changes" ? "bg-amber-tint text-amber-ink" : "bg-ink text-white"}`}>
              {l.status === "approved" ? L.approved : l.status === "changes" ? L.changesAsked : L.pending}
            </span>
          </span>
          {l.note && <span className="text-ink-2">{fmt(L.note, { note: l.note })}</span>}
          {l.client_comment && <span className="break-words">{fmt(L.comment, { comment: l.client_comment })}</span>}
          {l.decided_at && <span className="text-xs text-ink-2">{fmt(L.answered, { date: formatDate(locale, l.decided_at), name: l.decided_name ?? "" })}</span>}
          {l.status === "pending" && (asking === l.id ? (
            <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) decide(l.id, false); }}>
              <label className="field"><span>{L.what}</span><textarea className="input" rows={3} required maxLength={4000} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn btn-primary" disabled={pending || !comment.trim()}>{L.send}</button>
                <button type="button" className="btn btn-outline" onClick={() => setAsking(null)}>×</button>
              </div>
            </form>
          ) : (
            <span className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" disabled={pending} onClick={() => decide(l.id, true)}>{L.approve}</button>
              <button type="button" className="btn btn-outline" onClick={() => setAsking(l.id)}>{L.changes}</button>
            </span>
          ))}
        </li>
      ))}
      {error && <li role="alert" className="text-sm font-semibold text-red-ink">{error}</li>}
    </ul>
  );
}
