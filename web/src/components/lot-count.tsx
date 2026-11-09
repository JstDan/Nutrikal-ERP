"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { countStock, type ActionState } from "@/app/actions";
import { fmt, formatQty, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { parseQty } from "@/lib/parse-qty";

/**
 * A lot's quantity at one location, clicked to correct it after a count (owner, Nov 2026: click the ingredient and
 * correct it). A small window shows what is in stock now, takes the counted quantity (12,5 or 12.5) and shows the
 * difference before it is saved through count_stock, which posts it to the ledger.
 */
export function LotCount({ lotId, locationId, lot, item, location, quantity, unit, locale, T, reasonRequired = false, className = "" }: {
  lotId: string; locationId: string; lot: string; item: string; location: string; quantity: string; unit: string; locale: Locale;
  T: Dict["inventory"]["count"]; reasonRequired?: boolean; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(countStock, {});
  const [counted, setCounted] = useState("");
  const id = useId();
  const now = Number(quantity);
  const value = parseQty(counted);
  const diff = value === null ? null : Math.round((value - now) * 10000) / 10000;

  // Saved: the window closes and the page shows the new quantity
  useEffect(() => { if (state.ok) dialog.current?.close(); }, [state]);
  const open = () => { setCounted(""); dialog.current?.showModal(); };
  const shown = formatQty(locale, quantity, unit);

  return (
    <>
      <button type="button" onClick={open} title={T.editShort}
        className={`inline-flex min-h-9 items-center justify-end gap-1.5 rounded-md px-1.5 text-right tabular-nums underline decoration-dotted underline-offset-4 hover:bg-mist ${now < 0 ? "font-semibold text-red-ink" : ""} ${className}`}>
        <span>{shown}</span>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
        <span className="sr-only">{fmt(T.edit, { lot })}</span>
      </button>
      {state.ok && state.message && <span role="status" className="block text-right text-xs text-green-ink">{state.message}</span>}
      <dialog ref={dialog} aria-labelledby={`${id}-h`} className="m-auto w-[min(420px,calc(100vw-32px))] rounded-xl border border-line bg-paper p-0 text-left font-normal text-ink shadow-2xl backdrop:bg-black/40">
        <form action={action} className="flex flex-col gap-4 p-5">
          <input type="hidden" name="lot_location" value={`${lotId}|${locationId}`} />
          <input type="hidden" name="counted" value={value ?? ""} />
          <div>
            <h2 id={`${id}-h`} className="m-0 text-base font-bold break-words">{item}</h2>
            <p className="m-0 text-[13px] break-words text-ink-2">{lot} · {location}</p>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-ink-2">{T.now}</span>
            <strong className="tabular-nums">{shown}</strong>
          </div>
          <label className="field"><span>{T.counted} ({unit === "pcs" ? (locale === "bg" ? "бр." : "pcs") : unit === "kg" && locale === "bg" ? "кг" : unit}) *</span>
            <input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" autoComplete="off" required autoFocus
              aria-invalid={counted.trim() !== "" && (value === null || value < 0)} aria-describedby={`${id}-d`} className="input tabular-nums" />
          </label>
          <p id={`${id}-d`} className="m-0 flex items-baseline justify-between gap-3 text-sm" aria-live="polite">
            <span className="text-ink-2">{T.diff}</span>
            <strong className={`tabular-nums ${diff === null ? "text-ink-2" : diff < 0 ? "text-red-ink" : diff > 0 ? "text-green-ink" : ""}`}>
              {counted.trim() === "" ? "—" : diff === null || (value ?? 0) < 0 ? T.invalid : `${diff > 0 ? "+" : ""}${formatQty(locale, diff, unit)}`}
            </strong>
          </p>
          <label className="field"><span>{reasonRequired ? T.reasonRequired : T.reason}</span>
            <input name="reason" required={reasonRequired} autoComplete="off" className="input" />
          </label>
          {state.error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{state.error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-outline" onClick={() => dialog.current?.close()}>{T.cancel}</button>
            <button type="submit" className="btn btn-primary" disabled={pending || value === null || value < 0}>{T.submit}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
