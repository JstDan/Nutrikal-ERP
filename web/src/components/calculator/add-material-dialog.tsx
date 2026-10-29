"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { addRawMaterial } from "@/app/calculator/actions";
import { parseNum } from "@/lib/calculator/numbers";
import type { RawMaterial } from "@/lib/calculator/types";
import { Field, NumberField, useCalcText } from "./kit";

/** "Not in the price list – add it?" under the raw material search, with a + button that opens the dialog. */
export function AddMaterialPrompt({ query, onAdded }: { query: string; onAdded: (m: RawMaterial) => void }) {
  const { t } = useCalcText();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-dashed border-line-strong px-3 py-1">
      <p className="m-0 min-w-0 grow basis-64 py-2 text-sm">{t.formula.notInListAsk}</p>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-outline min-h-11 gap-2" aria-haspopup="dialog">
        <span aria-hidden="true" className="text-lg leading-none">+</span>
        {t.formula.addMaterial}
      </button>
      {open && <AddMaterialDialog initialName={query} onClose={() => setOpen(false)} onAdded={(m) => { setOpen(false); onAdded(m); }} />}
    </div>
  );
}

function AddMaterialDialog({ initialName, onClose, onAdded }: { initialName: string; onClose: () => void; onAdded: (m: RawMaterial) => void }) {
  const { t } = useCalcText();
  const F = t.formula;
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (initialName ? document.getElementById("add-material-price") : nameRef.current)?.focus();
  }, [initialName]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = () => {
    const p = parseNum(price);
    if (!name.trim()) return setError(F.addNameRequired);
    if (p === null || p <= 0) return setError(F.addPriceInvalid);
    setError(null);
    start(async () => {
      const res = await addRawMaterial(name.trim(), p);
      if (!res.ok) return setError(res.error);
      onAdded(res.data);
      router.refresh();
    });
  };

  // In a portal: the calculator itself is a form, and forms cannot be nested.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(0,0,0,0.45)] p-4 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-labelledby="add-material-h"
        onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); save(); }}
        className="flex w-full max-w-[420px] flex-col gap-4 rounded-sm bg-white p-4 shadow-2xl sm:p-6">
        <h2 id="add-material-h" className="m-0 text-lg font-bold">{F.addTitle}</h2>
        <Field label={F.addName} htmlFor="add-material-name" required>
          <input ref={nameRef} id="add-material-name" className="input" value={name} maxLength={200} autoComplete="off"
            onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={F.addPrice} htmlFor="add-material-price" required>
          <NumberField id="add-material-price" value={price} onChange={setPrice} suffix="€" />
        </Field>
        <p className="m-0 text-xs text-ink-2">{F.addNote}</p>
        {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-outline" onClick={onClose}>{t.cancel}</button>
          <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "…" : F.addSave}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
