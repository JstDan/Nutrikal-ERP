"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions";
import { deleteKnowledge, saveKnowledge } from "@/app/settings/ai/actions";

type Text = { save: string; approve: string; remove: string; removeConfirm: string; addLabel: string };

/** One note of Nutri AI's memory: changed and saved (a proposal is approved with it) or deleted. */
export function KnowledgeRow({ id, body, proposed, meta, T }: { id: string; body: string; proposed: boolean; meta: string; T: Text }) {
  const [saved, save, saving] = useActionState<ActionState, FormData>(saveKnowledge, {});
  const [, remove, removing] = useActionState<ActionState, FormData>(deleteKnowledge, {});
  return (
    <li className="flex flex-col gap-2 border-b border-mist py-3 last:border-0">
      <form action={save} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={id} />
        <label htmlFor={`k-${id}`} className="sr-only">{T.addLabel}</label>
        <textarea id={`k-${id}`} name="body" defaultValue={body} maxLength={1000} rows={2} className="input" />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={saving} className={`btn ${proposed ? "btn-primary" : "btn-outline"}`}>{saving ? "…" : proposed ? T.approve : T.save}</button>
          <button type="submit" formAction={remove} disabled={removing} className="btn btn-outline"
            onClick={(e) => { if (!window.confirm(T.removeConfirm)) e.preventDefault(); }}>{T.remove}</button>
          <span className="text-xs text-ink-2">{meta}</span>
          {saved.error && <span role="alert" className="text-sm font-semibold text-red-ink">{saved.error}</span>}
        </div>
      </form>
    </li>
  );
}
