"use client";

import { useEffect, useRef } from "react";

export type DocLang = "bg" | "en";
export type DocLangText = { title: string; bg: string; en: string; cancel: string };

/**
 * Asked before every document download (owner, Nov 2026): Download in BG / Download in EN.
 * Clients have no document language of their own any more.
 */
export function DocLangDialog({ open, text, onPick, onClose }: {
  open: boolean; text: DocLangText; onPick: (lang: DocLang) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      aria-labelledby="doc-lang-title"
      className="m-auto w-[min(360px,calc(100vw-32px))] rounded border border-line bg-paper p-5 text-ink shadow-lg backdrop:bg-black/40"
    >
      <h2 id="doc-lang-title" className="m-0 mb-4 text-base font-semibold">{text.title}</h2>
      <div className="flex flex-col gap-2">
        <button type="button" className="btn btn-primary" onClick={() => onPick("bg")} lang="bg">{text.bg}</button>
        <button type="button" className="btn btn-primary" onClick={() => onPick("en")} lang="en">{text.en}</button>
        <button type="button" className="btn btn-outline" onClick={onClose}>{text.cancel}</button>
      </div>
    </dialog>
  );
}

/** Builds the text for the dialog from the portal labels. */
export const portalLangText = (p: { langTitle: string; langBg: string; langEn: string; langCancel: string }): DocLangText =>
  ({ title: p.langTitle, bg: p.langBg, en: p.langEn, cancel: p.langCancel });
