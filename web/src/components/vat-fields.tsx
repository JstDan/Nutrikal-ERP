"use client";

import { useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** A reason for 0 % VAT: when it applies (the interface's language) and the text printed (the document's language). */
export type VatBasisOption = { label: string; text: string };
export type VatFieldsText = { vat: string; basis: string; basisOther: string; guide: string };

/**
 * The VAT rate of a document and, at 0 %, the reason printed on it (owner, Nov 2026): one of the list or own text.
 * Form fields vat_pct, vat_basis (the printed text) and vat_basis_other.
 */
export function VatFields({ pct, basis, bases, text }: { pct: number; basis: string | null; bases: VatBasisOption[]; text: VatFieldsText }) {
  const [rate, setRate] = useState(String(pct));
  const known = bases.some((b) => b.text === basis);
  const [picked, setPicked] = useState(known ? basis ?? "" : "");
  const zero = rate.trim() !== "" && Number(rate) === 0;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <label className="field"><span>{text.vat}</span>
        <input name="vat_pct" type="number" min={0} max={100} step="any" required value={rate}
          onChange={(e) => setRate(e.currentTarget.value)} className="input tabular-nums" />
      </label>
      {zero && (
        <>
          <label className="field md:col-span-2"><span>{text.basis} *</span>
            <select name="vat_basis" className="input" value={picked} onChange={(e) => setPicked(e.currentTarget.value)}>
              <option value="">—</option>
              {bases.map((b) => <option key={b.text} value={b.text}>{b.label}</option>)}
            </select>
            {picked && <small className="text-xs text-ink-2">{picked}</small>}
          </label>
          <label className="field md:col-span-2"><span>{text.basisOther}</span>
            <input name="vat_basis_other" defaultValue={basis && !known ? basis : ""} className="input" />
          </label>
        </>
      )}
      <p className="m-0 text-xs text-ink-2 md:col-span-2">{text.guide}</p>
    </div>
  );
}

/** The proforma of an order: the rate and reason live in the address (?rate=, ?vb=), so the page, PDF and e-mail follow. */
export function ProformaVat({ apply, ...props }: Parameters<typeof VatFields>[0] & { apply: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const next = new URLSearchParams(params.toString());
    next.delete("vat");
    const rate = Number(fd.get("vat_pct") ?? 0);
    next.set("rate", String(rate));
    const vb = String(fd.get("vat_basis_other") ?? "").trim() || String(fd.get("vat_basis") ?? "").trim();
    if (rate === 0 && vb) next.set("vb", vb); else next.delete("vb");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <VatFields {...props} />
      <div><button type="submit" className="btn btn-primary">{apply}</button></div>
    </form>
  );
}
