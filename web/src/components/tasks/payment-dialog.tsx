"use client";

import { useActionState, useState } from "react";
import { fmt, formatPrice, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import type { TemplateOption } from "@/lib/tasks-shared";
import { confirmFinalPayment, confirmFirstPayment } from "@/app/task-actions";

type T = Dict["tasks"];

/** Admin: Confirm first payment (the advance received, VAT included, or 100 %) with the task template of the order. */
export function ConfirmFirstPayment({ orderId, T, locale, templates, defaultPct, gross, currency }: {
  orderId: string; T: T; locale: Locale; templates: TemplateOption[]; defaultPct: number | null; gross: number; currency: string;
}) {
  const P = T.payment;
  const [state, action, pending] = useActionState(confirmFirstPayment, {});
  const [open, setOpen] = useState(false);
  const [received, setReceived] = useState<"advance" | "full">(defaultPct === 100 ? "full" : "advance");
  const def = templates.find((x) => x.is_default) ?? templates[0];
  const name = (x: TemplateOption) => (locale === "en" ? x.name_en || x.name_bg : x.name_bg);

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" className="btn btn-primary w-fit" onClick={() => setOpen(true)}>{P.confirmFirst}</button>
        {state.ok && state.message && <p role="status" className="m-0 text-sm font-semibold text-green-ink">{state.message}</p>}
      </div>
    );
  }
  return (
    <form action={action} aria-labelledby="pay-first-h" className="flex flex-col gap-3 rounded-sm border border-line p-3">
      <h3 id="pay-first-h" className="m-0 text-base font-bold">{P.dialogTitle}</h3>
      <p className="m-0 text-xs text-ink-2">{P.dialogNote}</p>
      <input type="hidden" name="order_id" value={orderId} />
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">{P.received}</legend>
        <label className="flex min-h-11 cursor-pointer flex-wrap items-center gap-3 text-sm">
          <input type="radio" name="received" value="advance" className="h-5 w-5 accent-ink" checked={received === "advance"} onChange={() => setReceived("advance")} />
          {P.advance}
        </label>
        {received === "advance" && (
          <label className="field ml-8 max-w-[260px]"><span>{fmt(P.advanceAmount, { currency })}</span>
            <input name="amount" type="number" min={0.01} max={gross > 0 ? Math.max(0.01, gross - 0.01).toFixed(2) : undefined} step={0.01} required
              inputMode="decimal" className="input" aria-describedby="pay-first-hint"
              defaultValue={(Math.round(gross * (defaultPct != null && defaultPct > 0 && defaultPct < 100 ? defaultPct : 50)) / 100).toFixed(2)} />
            <small id="pay-first-hint" className="text-xs text-ink-2">{fmt(P.advanceHint, { total: formatPrice(locale, gross, currency) })}</small>
          </label>
        )}
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input type="radio" name="received" value="full" className="h-5 w-5 accent-ink" checked={received === "full"} onChange={() => setReceived("full")} />
          {P.full}
        </label>
      </fieldset>
      {templates.length > 0 && (
        <label className="field"><span>{P.template}</span>
          <select name="template_id" className="input" defaultValue={def?.id}>
            {templates.map((x) => <option key={x.id} value={x.id}>{name(x)}</option>)}
          </select>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "…" : P.confirm}</button>
        <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>{T.cancel}</button>
        {state.error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{state.error}</p>}
      </div>
    </form>
  );
}

/** Admin: Confirm final payment (the balance of an order paid with an advance). */
export function ConfirmFinalPayment({ orderId, T }: { orderId: string; T: T }) {
  const [state, action, pending] = useActionState(confirmFinalPayment, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "…" : T.payment.confirmFinal}</button>
      <p role="status" aria-live="polite" className="m-0 text-sm">
        {state.error && <span className="font-semibold text-red-ink">{state.error}</span>}
        {state.ok && state.message && <span className="font-semibold text-green-ink">{state.message}</span>}
      </p>
    </form>
  );
}
