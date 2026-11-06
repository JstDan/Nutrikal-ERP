"use client";

import { useState, useTransition } from "react";
import type { Dict } from "@/lib/i18n/en";
import { createBoard } from "@/app/board-actions";
import { BOARD_COLORS, BOARD_HEX, LABEL_HEX, type BoardColor, type LabelColor } from "@/lib/boards-shared";

type T = Dict["boards"];
type Template = { name: string; hint: string; labels: { name: string; color: string }[]; lists: { name: string; cards: unknown[] }[] };
const COLOR_OF: Record<string, BoardColor> = { blank: "blue", weekly: "teal", sales: "green", product: "purple", marketing: "orange", personal: "grey" };

/** "New board": a template, name, colour and the people to invite; opens the board when made. */
export function NewBoardForm({ people, T }: { people: { id: string; full_name: string }[]; T: T }) {
  const templates = T.templates as unknown as Record<string, Template>;
  const [open, setOpen] = useState(false);
  const [tpl, setTpl] = useState("blank");
  const [colorOf, setColor] = useState<BoardColor>("blue");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) return <button type="button" className="btn btn-primary w-fit" onClick={() => setOpen(true)}>{T.newBoard}</button>;
  return (
    <form className="card flex flex-col gap-4 p-4"
      action={(fd) => start(async () => { setError(null); const r = await createBoard(fd).catch((): { error: string; id?: string } => ({ error: T.stale })); if (r?.error) setError(r.error); })}>
      <h2 className="m-0 text-base font-bold">{T.newBoard}</h2>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold">{T.template}</legend>
        <input type="hidden" name="template" value={tpl} />
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(230px, 100%), 1fr))" }}>
          {Object.entries(templates).map(([key, x]) => (
            <button key={key} type="button" aria-pressed={tpl === key}
              onClick={() => { setTpl(key); setColor(COLOR_OF[key] ?? "blue"); }}
              className={`flex min-h-24 flex-col gap-2 rounded-sm border-2 bg-white p-3 text-left ${tpl === key ? "border-ink" : "border-line hover:border-line-strong"}`}>
              <span className="flex items-center gap-2 text-sm font-bold">
                <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm" style={{ background: BOARD_HEX[COLOR_OF[key] ?? "blue"] }} />
                {x.name}
              </span>
              <span className="text-xs text-ink-2">{x.hint}</span>
              {x.labels.length > 0 && (
                <span aria-hidden="true" className="flex flex-wrap gap-1">
                  {x.labels.map((l) => (
                    <span key={l.name} className="rounded-full px-2 text-[11px] font-semibold"
                      style={{ background: LABEL_HEX[l.color as LabelColor].bg, color: LABEL_HEX[l.color as LabelColor].fg }}>{l.name}</span>
                  ))}
                </span>
              )}
            </button>
          ))}
        </div>
      </fieldset>

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
