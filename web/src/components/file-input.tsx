"use client";

import { useState, type ChangeEvent } from "react";
import { shrinkImages } from "@/lib/shrink-image";

/**
 * A file field of a form whose photos are made smaller in the browser before the form is sent (`shrinkImage`):
 * the chosen files are replaced in the field itself, so the form and its server action stay as they were.
 * While a photo is being prepared the form's submit button waits (the field is marked busy).
 */
export function FileInput({ name, required, accept, multiple, className = "input", maxSide, photosOnly, describedBy, preparing }: {
  name: string; required?: boolean; accept?: string; multiple?: boolean; className?: string; maxSide?: number; photosOnly?: boolean; describedBy?: string; preparing: string;
}) {
  const [busy, setBusy] = useState(false);
  async function onChange(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    setBusy(true);
    const submit = input.form?.querySelector<HTMLButtonElement>("button[type=submit]");
    if (submit) submit.disabled = true;
    try {
      const small = await shrinkImages(files, { maxSide, photosOnly });
      if (small.some((f, i) => f !== files[i])) {
        const dt = new DataTransfer();
        small.forEach((f) => dt.items.add(f));
        input.files = dt.files;
      }
    } finally {
      if (submit) submit.disabled = false;
      setBusy(false);
    }
  }
  return (
    <>
      <input name={name} type="file" required={required} accept={accept} multiple={multiple} onChange={onChange}
        aria-describedby={describedBy} aria-busy={busy || undefined} className={className} />
      {busy && <small role="status" className="text-xs font-semibold text-ink">{preparing}</small>}
    </>
  );
}
