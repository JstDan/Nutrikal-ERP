"use client";

import { useState, type ChangeEvent } from "react";

type Props = {
  name: string;
  label: string;
  hint: string;
  preparing: string;
  ready: string; // "{n} file(s) ready"
  error: string;
  required?: boolean;
};

/**
 * Photos from the phone camera or files. Images are made smaller in the
 * browser before upload (longest side 1600 px, JPEG quality 0.75; HEIC is
 * converted to JPEG); PDFs are sent as they are.
 */
export function PhotoInput({ name, label, hint, preparing, ready, error, required }: Props) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function onChange(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return setStatus("");
    setBusy(true);
    setStatus(preparing);
    const dt = new DataTransfer();
    let failed = false;
    for (const f of files) {
      try {
        dt.items.add(await shrink(f));
      } catch {
        failed = true;
      }
    }
    input.files = dt.files;
    setBusy(false);
    setStatus(failed ? error : ready.replace("{n}", String(dt.files.length)));
  }

  return (
    <label className="field">
      <span>{label}{required ? " *" : ""}</span>
      <input
        name={name}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        multiple
        required={required}
        onChange={onChange}
        aria-describedby={`${name}-hint ${name}-status`}
        className="input h-auto py-2"
      />
      <small id={`${name}-hint`} className="text-xs text-ink-2">{hint}</small>
      <small id={`${name}-status`} role="status" aria-live="polite" className={`text-xs font-semibold ${status === error ? "text-red-ink" : "text-ink"}`}>
        {busy ? preparing : status}
      </small>
    </label>
  );
}

const MAX_SIDE = 1600;
const QUALITY = 0.75;

async function shrink(f: File): Promise<File> {
  if (f.type === "application/pdf") return f;
  const heic = /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(f);
  } catch (e) {
    if (!heic) throw e;
    // Only Safari decodes HEIC itself; elsewhere convert it first (loaded on demand)
    const { default: heic2any } = await import("heic2any");
    const jpeg = await heic2any({ blob: f, toType: "image/jpeg", quality: 0.9 });
    bmp = await createImageBitmap(Array.isArray(jpeg) ? jpeg[0] : jpeg);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", QUALITY));
  return new File([blob], f.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}
