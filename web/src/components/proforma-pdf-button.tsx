"use client";

import { useState } from "react";
import type { ProformaPdfModel } from "@/lib/proforma-pdf";

/** Downloads the proforma as a PDF file (made in the browser). */
export function ProformaPdfButton({ model, label, errorText }: { model: ProformaPdfModel; label: string; errorText: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const download = async () => {
    setBusy(true);
    setError(false);
    try {
      const { downloadProformaPdf } = await import("@/lib/proforma-pdf");
      await downloadProformaPdf(model);
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
