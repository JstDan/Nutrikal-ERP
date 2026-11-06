"use client";

import { useState } from "react";
import type { ProformaPdfModel } from "@/lib/proforma-pdf";
import { keepProforma } from "@/app/task-actions";
import { DocLangDialog, type DocLang, type DocLangText } from "@/components/doc-lang-dialog";

/**
 * Downloads a document (proforma, invoice, note, delivery note, purchase order) as a PDF file made in the browser.
 * It first asks the language: Download in BG / Download in EN (owner, Nov 2026); the page passes both versions.
 * With keep (staff page of an order) the same file is also added to the order tasks, Payments & invoices.
 */
export function ProformaPdfButton({ models, label, errorText, langText, keep, variant = "primary" }: {
  models: Record<DocLang, ProformaPdfModel>; label: string; errorText: string; langText: DocLangText;
  keep?: { orderId: string; final: boolean }; variant?: "primary" | "outline";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [asking, setAsking] = useState(false);

  const download = async (lang: DocLang) => {
    setAsking(false);
    setBusy(true);
    setError(false);
    const model = models[lang];
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
      <button type="button" className={`btn btn-${variant}`} onClick={() => setAsking(true)} disabled={busy} aria-haspopup="dialog">
        {busy ? "…" : label}
      </button>
      <DocLangDialog open={asking} text={langText} onPick={download} onClose={() => setAsking(false)} />
      {error && <p role="alert" className="m-0 self-center text-sm font-semibold text-red-ink">{errorText}</p>}
    </>
  );
}
