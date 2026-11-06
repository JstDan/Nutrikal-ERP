"use client";

import { useState, useTransition } from "react";
import type { Dict } from "@/lib/i18n/en";
import { createBoard } from "@/app/board-actions";
import { BOARD_COLORS, BOARD_HEX, type BoardColor } from "@/lib/boards-shared";

type T = Dict["boards"];

/** "New board": name, colour and the people to invite; opens the board when made. */
export function NewBoardForm({ people, T }: { people: { id: string; full_name: string }[]; T: T }) {
  const [open, setOpen] = useState(false);
  const [colorOf, setColor] = useState<BoardColor>("blue");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) return <button type="button" className="btn btn-primary w-fit" onClick={() => setOpen(true)}>{T.newBoard}</button>;
  return (
    <form className="card flex flex-col gap-4 p-4"
      action={(fd) => start(async () => { setError(null); const r = await createBoard(fd); if (r?.error) setError(r.error); })}>
      <h2 className="m-0 text-base font-bold">{T.newBoard}</h2>
      <label className="field"><span>{T.name} *</span>
        <input name="name" className="input" required maxLength={100} autoFocus />
      </label>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold">{T.color}</legend>
        <input type="hidden" name="color" value={colorOf} />
        <div className="flex flex-wrap gap-2">
          {BOARD_COLORS.map((c) => (
            <button key={c} type="button" aria-pressed={colorOf === c} aria-label={T.colors[c]} title={T.colors[c]} onClick={() => setColor(c)}
              className={`h-11 w-11 rounded-sm ${colorOf === c ? "ring-2 ring-ink ring-offset-2" : ""}`} style={{ background: BOARD_HEX[c] }} />
          ))}
        </div>
      </fieldset>
      {people.length > 0 && (
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 text-sm font-semibold">{T.invite}</legend>
          <p className="m-0 text-xs text-ink-2">{T.inviteHint}</p>
          <div className="grid gap-x-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(200px, 100%), 1fr))" }}>
            {people.map((p) => (
              <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" name="member" value={p.id} className="h-5 w-5 shrink-0 accent-ink" />
                <span className="min-w-0 break-words">{p.full_name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>{T.create}</button>
        <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>{T.cancel}</button>
      </div>
    </form>
  );
}
