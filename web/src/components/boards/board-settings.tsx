"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { boardOp, deleteBoardPart, type BoardOp } from "@/app/board-actions";
import { BOARD_COLORS, BOARD_HEX, type BoardColor, type BoardData } from "@/lib/boards-shared";

type T = Dict["boards"];

/** Name, colour and people of a board; archive, leave, delete. */
export function BoardSettings({ data, T, userId, isAdmin, onClose }: { data: BoardData; T: T; userId: string; isAdmin: boolean; onClose: () => void }) {
  const router = useRouter();
  const b = data.board;
  const [name, setName] = useState(b.name);
  const [color, setColor] = useState<BoardColor>(b.color);
  const [add, setAdd] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = (op: BoardOp, args: Record<string, unknown>, after?: () => void) => start(async () => {
    setError(null);
    const r = await boardOp(b.id, op, args);
    if (r.error) setError(r.error); else after?.();
  });
  const outside = data.people.filter((p) => !data.members.some((m) => m.user_id === p.id));
  const canDelete = b.created_by === userId || isAdmin;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(0,0,0,0.45)] p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="board-settings-h" className="card flex w-full max-w-[560px] flex-col gap-4 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id="board-settings-h" className="m-0 text-lg font-bold">{T.settings}</h2>
          <button ref={closeRef} type="button" className="btn btn-outline" onClick={onClose}>{T.close}</button>
        </div>
        {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}

        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) run("renameBoard", { name, color }); }}>
          <label className="field"><span>{T.name}</span>
            <input className="input" value={name} maxLength={100} required onChange={(e) => setName(e.target.value)} />
          </label>
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 text-sm font-semibold">{T.color}</legend>
            <div className="flex flex-wrap gap-2">
              {BOARD_COLORS.map((c) => (
                <button key={c} type="button" aria-pressed={color === c} aria-label={T.colors[c]} title={T.colors[c]} onClick={() => setColor(c)}
                  className={`h-11 w-11 rounded-sm ${color === c ? "ring-2 ring-ink ring-offset-2" : ""}`} style={{ background: BOARD_HEX[c] }} />
              ))}
            </div>
          </fieldset>
          {(name.trim() !== b.name || color !== b.color) && <button type="submit" className="btn btn-primary w-fit" disabled={pending || !name.trim()}>{T.save}</button>}
        </form>

        <section aria-labelledby="board-members-h" className="flex flex-col gap-2 border-t border-mist pt-4">
          <h3 id="board-members-h" className="m-0 text-sm font-bold tracking-[1px] uppercase text-ink-2">{T.members}</h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {data.members.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-mist py-1 last:border-0">
                <span className="min-w-0 text-sm break-words">{m.full_name}</span>
                {m.user_id !== userId && data.members.length > 1 && (
                  <button type="button" className="btn btn-outline" disabled={pending} aria-label={fmt(T.removeMember, { name: m.full_name })}
                    onClick={() => run("removeMember", { user: m.user_id })}>×</button>
                )}
              </li>
            ))}
          </ul>
          {outside.length > 0 && (
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (add) run("addMember", { user: add }, () => setAdd("")); }}>
              <label className="field min-w-0 flex-[1_1_200px]"><span>{T.addMember}</span>
                <select className="input" value={add} onChange={(e) => setAdd(e.target.value)}>
                  <option value="">—</option>
                  {outside.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </label>
              <button type="submit" className="btn btn-outline" disabled={pending || !add}>{T.add}</button>
            </form>
          )}
        </section>

        <div className="flex flex-wrap gap-2 border-t border-mist pt-4">
          <button type="button" className="btn btn-outline" disabled={pending}
            onClick={() => run("archiveBoard", { on: !b.archived_at }, onClose)}>{b.archived_at ? T.restoreBoard : T.archiveBoard}</button>
          {data.members.some((m) => m.user_id === userId) && data.members.length > 1 && (
            <button type="button" className="btn btn-outline" disabled={pending}
              onClick={() => run("removeMember", { user: userId }, () => router.push("/boards"))}>{T.leave}</button>
          )}
          {canDelete && !confirm && <button type="button" className="btn btn-outline text-red-ink" onClick={() => setConfirm(true)}>{T.deleteBoard}</button>}
        </div>
        {confirm && (
          <div className="flex flex-col gap-2 rounded-sm bg-red-tint p-3">
            <p className="m-0 text-sm font-semibold text-red-ink">{T.deleteBoardConfirm}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" disabled={pending}
                onClick={() => start(async () => { const r = await deleteBoardPart(b.id, "board", b.id); if (r?.error) setError(r.error); })}>{T.deleteBoard}</button>
              <button type="button" className="btn btn-outline" onClick={() => setConfirm(false)}>{T.cancel}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
