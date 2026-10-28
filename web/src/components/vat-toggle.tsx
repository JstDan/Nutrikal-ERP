"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { setInvoiceVat } from "@/app/actions";

/**
 * With or without VAT on a document. A draft invoice (invoiceId) saves the choice;
 * the proforma keeps it in the address (?vat=1 / ?vat=0), so the PDF and print follow it.
 */
export function VatToggle({ checked, label, invoiceId }: { checked: boolean; label: string; invoiceId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const change = (on: boolean) => {
    setError(null);
    start(async () => {
      if (invoiceId) {
        const fd = new FormData();
        fd.set("invoice_id", invoiceId);
        fd.set("with_vat", on ? "1" : "0");
        const res = await setInvoiceVat({}, fd);
        if (res.error) setError(res.error);
        else router.refresh();
      } else {
        const next = new URLSearchParams(params.toString());
        next.set("vat", on ? "1" : "0");
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold">
        <input type="checkbox" className="h-5 w-5 shrink-0 accent-ink" checked={checked} disabled={pending}
          onChange={(e) => change(e.target.checked)} />
        <span>{label}</span>
      </label>
      {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
    </div>
  );
}
