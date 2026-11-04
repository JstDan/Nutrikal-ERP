"use client";

import { useState } from "react";
import type { ProformaPdfModel } from "@/lib/proforma-pdf";
import { keepProforma } from "@/app/task-actions";

/**
 * Downloads the proforma as a PDF file (made in the browser). With keep (staff page of an order) the same file
 * is also added to the order tasks, Payments & invoices (owner, Nov 2026).
 */
export function ProformaPdfButton({ model, label, errorText, keep }: {
  model: ProformaPdfModel; label: string; errorText: string; keep?: { orderId: string; final: boolean };
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const download = async () => {
    setBusy(true);
    setError(false);
    try {
      const pdf = await import("@/lib/proforma-pdf");
      if (keep) {
        const base64 = await pdf.downloadProformaPdfKept(model);
        const res = await keepProforma(keep.orderId, keep.final, model.fileName, base64);
        if (res.error) console.error("Proforma not kept in the tasks:", res.error);
      } else await pdf.downloadProformaPdf(model);
    } catch (e) {
      console.error(e);
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={download} disabled={busy}>
        {busy ? "…" : label}
      </button>
      {error && <p role="alert" className="m-0 self-center text-sm font-semibold text-red-ink">{errorText}</p>}
    </>
  );
}
