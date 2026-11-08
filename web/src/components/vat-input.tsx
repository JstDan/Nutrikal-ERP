"use client";

import { useRef, useState, useTransition } from "react";
import { checkVat, type VatCheckResult } from "@/app/actions";
import type { Dict } from "@/lib/i18n/en";
import { fmt } from "@/lib/i18n";

/**
 * The VAT number of a client with Check in VIES (owner, Nov 2026): the answer shows valid or not, the name and address
 * VIES gives and the request number; Use the name and address fills them into the form (saved with Save).
 */
export function VatInput({ label, defaultValue, T }: { label: string; defaultValue: string; T: Dict["clients"]["vies"] }) {
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<VatCheckResult | null>(null);
  const [used, setUsed] = useState(false);
  const [pending, start] = useTransition();

  const field = (name: string) => input.current?.form?.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
  const check = () => {
    const vat = input.current?.value ?? "";
    if (!vat.trim()) return;
    setUsed(false);
    start(async () => setResult(await checkVat(vat, field("country_code")?.value ?? null)));
  };
  const use = () => {
    if (!result?.ok) return;
    const set = (name: string, v: string | null) => { const f = field(name); if (f && v) f.value = v; };
    set("legal_name", result.name);
    set("registration_address", result.address);
    // A Bulgarian VAT number is BG + the EIK
    const eik = field("company_id");
    if (result.country === "BG" && eik && !eik.value.trim()) eik.value = result.vat.slice(2);
    const country = field("country_code");
    if (country && [...(country as HTMLSelectElement).options].some((o) => o.value === result.country)) country.value = result.country;
    if (input.current) input.current.value = result.vat;
    setUsed(true);
  };

  return (
    <div className="field">
      <label htmlFor="vat_number" className="text-[13px] font-semibold text-ink">{label}</label>
      <div className="flex gap-2">
        <input ref={input} id="vat_number" name="vat_number" defaultValue={defaultValue} className="input min-w-0 flex-1"
          aria-describedby={result ? "vat-result" : undefined}
          onChange={() => setResult(null)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); check(); } }} />
        <button type="button" onClick={check} disabled={pending}
          className="min-h-11 shrink-0 rounded-[2px] border border-line-strong px-3 text-[13px] font-semibold hover:bg-mist disabled:opacity-60">
          {pending ? T.checking : T.check}
        </button>
      </div>
      {result && (
        <div id="vat-result" role="status" className="flex flex-col gap-1 text-[13px]">
          {!result.ok ? <span className="text-ink-2">{result.error}</span> : (
            <>
              <strong className={result.valid ? "text-[#2f7d1f]" : "text-[#D72C0D]"}>
                {result.valid ? "✓ " : "✗ "}{result.valid ? T.valid : T.invalid} · {result.vat}
              </strong>
              {result.valid && (result.name || result.address
                ? <span className="break-words">{[result.name, result.address].filter(Boolean).join(", ")}</span>
                : <span className="text-ink-2">{T.noName}</span>)}
              {result.requestId && <span className="text-ink-2">{fmt(T.requestId, { id: result.requestId })}</span>}
              {result.valid && (result.name || result.address) && (used
                ? <span className="text-ink-2">{T.used}</span>
                : <button type="button" onClick={use} className="self-start text-[13px] font-semibold underline">{T.use}</button>)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
