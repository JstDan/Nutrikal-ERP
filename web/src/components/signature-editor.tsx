"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSignature } from "@/app/signature-actions";
import type { Dict } from "@/lib/i18n/en";

/**
 * The e-mail signature of one person. Pasted from Gmail (Settings > Signature: select, copy, paste here):
 * the formatting, links and a logo given as a picture link stay. The server cleans the HTML before saving.
 */
export function SignatureEditor({ userId, initial, text, label }: { userId: string; initial: string; text: Dict["signature"]; label: string }) {
  const S = text;
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ ok?: boolean; error?: string }>({});
  const [empty, setEmpty] = useState(!initial);

  const save = (html: string) => start(async () => {
    setState({});
    const res = await saveSignature(userId, html);
    setState(res);
    if (res.ok) router.refresh();
  });

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span id={`sig-${userId}-label`} className="text-[13px] font-semibold">{label}</span>
      <div className="relative min-w-0">
        <div
          ref={box}
          role="textbox"
          aria-multiline="true"
          aria-labelledby={`sig-${userId}-label`}
          aria-describedby={`sig-${userId}-hint`}
          contentEditable={!pending}
          suppressContentEditableWarning
          onInput={(e) => setEmpty(!e.currentTarget.textContent?.trim() && !e.currentTarget.querySelector("img"))}
          // The signature was cleaned on the server before it was saved
          dangerouslySetInnerHTML={{ __html: initial }}
          className="min-h-24 min-w-0 overflow-x-hidden rounded-sm border border-line-strong bg-[#fff] p-3 text-sm break-words text-[#222831] [&_img]:inline-block [&_img]:max-w-full [&_table]:max-w-full"
        />
        {empty && <span aria-hidden="true" className="pointer-events-none absolute top-3 left-3 text-sm text-[#4a5160]">{S.placeholder}</span>}
      </div>
      <p id={`sig-${userId}-hint`} className="m-0 text-xs text-ink-2">{S.hint}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending} onClick={() => save(box.current?.innerHTML ?? "")} className="btn btn-primary">{pending ? "…" : S.save}</button>
        {!empty && (
          <button type="button" disabled={pending} onClick={() => { if (box.current) box.current.innerHTML = ""; setEmpty(true); save(""); }} className="btn btn-outline">
            {S.clear}
          </button>
        )}
        <p role="status" aria-live="polite" className="m-0 text-sm">
          {state.error && <span className="font-semibold text-red-ink">{state.error}</span>}
          {state.ok && <span className="font-semibold text-green-ink">{S.saved}</span>}
        </p>
      </div>
    </div>
  );
}
