"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmt, formatPrice, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { correctInvoice } from "@/app/batch-actions";

type T = Dict["invoiceFix"];
type Line = { id?: string; description: string; quantity: string; unit_price: string };
export type CorrectionInvoice = {
  id: string; number: string; issue_date: string; tax_point_date: string | null; due_date: string | null; payment_method: string;
  vat_pct: string; vat_basis: string | null; locale: "bg" | "en"; notes: string | null; currency: string;
  buyer: Record<string, unknown>;
  lines: { id: string; description: string; quantity: string; unit_price: string }[];
};

const BUYER = [["name", "buyerName"], ["company_id", "buyerId"], ["vat", "buyerVat"], ["address", "buyerAddress"],
  ["city", "buyerCity"], ["postal_code", "buyerZip"], ["country", "buyerCountry"]] as const;

/** Admin corrects an issued invoice in full; the old version is kept with the reason (owner, Nov 2026). */
export function InvoiceCorrection({ inv, T, methods, locale }: { inv: CorrectionInvoice; T: T; methods: Record<string, string>; locale: Locale }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [head, setHead] = useState({
    number: inv.number, issue_date: inv.issue_date, tax_point_date: inv.tax_point_date ?? "", due_date: inv.due_date ?? "",
    payment_method: inv.payment_method, vat_pct: inv.vat_pct, vat_basis: inv.vat_basis ?? "", locale: inv.locale, notes: inv.notes ?? "",
  });
  const [buyer, setBuyer] = useState<Record<string, string>>(Object.fromEntries(BUYER.map(([k]) => [k, String(inv.buyer[k] ?? "")])));
  const [lines, setLines] = useState<Line[]>(inv.lines.map((l) => ({ id: l.id, description: l.description, quantity: String(Number(l.quantity)), unit_price: String(Number(l.unit_price)) })));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const num = (v: string) => Number(v.replace(",", "."));
  const sub = lines.reduce((a, l) => a + Math.round(num(l.quantity) * num(l.unit_price) * 100) / 100, 0);
  const vat = Math.round(sub * num(head.vat_pct)) / 100;
  const money = (n: number) => formatPrice(locale, n, inv.currency);
  const set = (k: keyof typeof head) => (e: { target: { value: string } }) => setHead({ ...head, [k]: e.target.value });
  const setLine = (i: number, k: keyof Line) => (e: { target: { value: string } }) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)));

  const save = () => start(async () => {
    setError(null); setMessage(null);
    const r = await correctInvoice(inv.id, { ...head, vat_pct: num(head.vat_pct), buyer },
      lines.map((l) => ({ id: l.id, description: l.description, quantity: num(l.quantity), unit_price: num(l.unit_price) })), reason)
      .catch((e: Error) => ({ error: e.message, n: undefined }));
    if (r.error) return setError(r.error);
    setMessage(fmt(T.saved, { n: r.n ?? "" }));
    setReason("");
    setOpen(false);
    router.refresh();
  });

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {message && <p role="status" className="m-0 text-sm font-semibold text-green-ink">{message}</p>}
        <button type="button" className="btn btn-outline w-fit" onClick={() => setOpen(true)}>{T.open}</button>
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <p className="m-0 rounded-sm bg-amber-tint p-3 text-sm text-amber-ink">{T.note}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="field"><span>{T.number} *</span>
          <input className="input tabular-nums" required pattern="[0-9]{10}" maxLength={10} inputMode="numeric" value={head.number} onChange={set("number")} /></label>
        <label className="field"><span>{T.issueDate} *</span><input type="date" className="input" required value={head.issue_date} onChange={set("issue_date")} /></label>
        <label className="field"><span>{T.taxDate}</span><input type="date" className="input" value={head.tax_point_date} onChange={set("tax_point_date")} /></label>
        <label className="field"><span>{T.due}</span><input type="date" className="input" value={head.due_date} onChange={set("due_date")} /></label>
        <label className="field"><span>{T.method}</span>
          <select className="input" value={head.payment_method} onChange={set("payment_method")}>
            {Object.entries(methods).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="field"><span>{T.locale}</span>
          <select className="input" value={head.locale} onChange={set("locale")}><option value="bg">БГ</option><option value="en">EN</option></select></label>
        <label className="field"><span>{T.vat} *</span><input type="number" min="0" max="100" step="0.01" className="input" required value={head.vat_pct} onChange={set("vat_pct")} /></label>
        <label className="field sm:col-span-2"><span>{T.vatBasis}</span><input className="input" value={head.vat_basis} onChange={set("vat_basis")} /></label>
      </div>

      <fieldset className="m-0 flex flex-col gap-3 border-0 border-t border-mist p-0 pt-3">
        <legend className="text-sm font-bold">{T.buyer}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BUYER.map(([k, label]) => (
            <label key={k} className={`field ${k === "address" ? "sm:col-span-2" : ""}`}><span>{T[label]}</span>
              <input className="input" value={buyer[k]} onChange={(e) => setBuyer({ ...buyer, [k]: e.target.value })} /></label>
          ))}
        </div>
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-3 border-0 border-t border-mist p-0 pt-3">
        <legend className="text-sm font-bold">{T.lines}</legend>
        {lines.map((l, i) => (
          <div key={l.id ?? `new-${i}`} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_110px_130px_auto]">
            <label className="field"><span>{T.description} *</span><input className="input" required value={l.description} onChange={setLine(i, "description")} /></label>
            <label className="field"><span>{T.quantity} *</span><input className="input" required inputMode="decimal" value={l.quantity} onChange={setLine(i, "quantity")} /></label>
            <label className="field"><span>{T.price} *</span><input className="input" required inputMode="decimal" value={l.unit_price} onChange={setLine(i, "unit_price")} /></label>
            <button type="button" className="btn btn-outline" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>{T.removeLine}</button>
          </div>
        ))}
        <button type="button" className="btn btn-outline w-fit" onClick={() => setLines([...lines, { description: "", quantity: "1", unit_price: "" }])}>{T.addLine}</button>
        <p className="m-0 text-sm font-semibold tabular-nums">{fmt(T.totals, { sub: money(sub), vat: money(vat), total: money(sub + vat) })}</p>
      </fieldset>

      <label className="field border-t border-mist pt-3"><span>{T.notes}</span><textarea className="input" value={head.notes} onChange={set("notes")} /></label>
      <label className="field"><span>{T.reason} *</span><input className="input" required value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending || !reason.trim()}>{T.save}</button>
        <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>{T.cancel}</button>
      </div>
    </form>
  );
}
