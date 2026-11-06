"use client";

import { useActionState, useState } from "react";
import { deleteClient } from "@/app/actions";
import { fmt } from "@/lib/i18n";

type Labels = { button: string; title: string; confirm: string; yes: string; cancel: string };

/** Delete a client, after a second confirmation (Admin: any client; Sales: their own). The database decides. */
export function DeleteClient({ clientId, name, labels }: { clientId: string; name: string; labels: Labels }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(deleteClient, {});

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-expanded={false} className="btn btn-outline self-start text-red-ink!">
        {labels.button}
      </button>
    );
  }
  return (
    <form action={action} role="alertdialog" aria-labelledby="del-client-h" className="flex flex-col gap-3 rounded border border-red-ink/40 bg-white p-4">
      <input type="hidden" name="client_id" value={clientId} />
      <h3 id="del-client-h" className="m-0 text-sm font-bold">{fmt(labels.title, { name })}</h3>
      <p className="m-0 text-[13px] text-ink-2">{labels.confirm}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary bg-red-ink! border-red-ink!">{pending ? "…" : labels.yes}</button>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-outline">{labels.cancel}</button>
      </div>
      <p role="status" aria-live="polite" className="m-0 text-sm">
        {state.error && <span className="font-semibold text-red-ink">{state.error}</span>}
      </p>
    </form>
  );
}
