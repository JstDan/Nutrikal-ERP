"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendDocument } from "@/app/shortcut-actions";
import { fmt, formatDate, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import type { ProformaPdfModel } from "@/lib/proforma-pdf";

export type SendKind = "calc_offer" | "proforma" | "invoice" | "delivery_note";
export type SendInfo = {
  kind: SendKind; refId: string; to: string; subject: string; body: string; configured: boolean;
  history: { id: string; recipient: string; status: "sending" | "sent" | "failed"; error: string | null; created_at: string; sender: string | null }[];
};

/** E-mails a document to the client as a PDF made in the browser, the same file as the download. */
export function SendDocument({ info, model, makePdf, text, locale, title }: {
  info: SendInfo;
  model?: ProformaPdfModel;
  makePdf?: () => Promise<{ base64: string; fileName: string }>;
  text: Dict["send"];
  locale: Locale;
  title?: string;
}) {
  const S = text;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ ok?: boolean; error?: string; message?: string }>({});
  const last = info.history.find((h) => h.status === "sent");

  const submit = (fd: FormData) => start(async () => {
    setState({});
    try {
      const pdf = model
        ? await (await import("@/lib/proforma-pdf")).proformaPdfBase64(model)
        : await makePdf!();
      fd.set("pdf", pdf.base64);
      fd.set("file_name", pdf.fileName);
      const res = await sendDocument(fd);
      setState(res);
      if (res.ok) router.refresh();
    } catch (e) {
      console.error(e);
      setState({ error: S.failed });
    }
  });

  return (
    <details className="card min-w-0 p-5 print:hidden sm:p-6">
      <summary className="flex min-h-11 cursor-pointer items-center gap-x-3 font-bold">
        <span>{title ?? S.title}</span>
        {last && <span className="text-sm font-normal text-ink-2">{fmt(S.lastSent, { date: formatDate(locale, last.created_at.slice(0, 10)), to: last.recipient })}</span>}
      </summary>
      <div className="mt-4 flex flex-col gap-4">
        {!info.configured && <p className="m-0 text-sm font-semibold">{S.notConfigured}</p>}
        <form action={submit} className="flex flex-col gap-4">
          <input type="hidden" name="kind" value={info.kind} />
          <input type="hidden" name="ref_id" value={info.refId} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="field"><span>{S.to} *</span><input name="to" type="email" required defaultValue={info.to} className="input" /></label>
            <label className="field"><span>{S.cc}</span><input name="cc" type="email" className="input" /></label>
          </div>
          <label className="field"><span>{S.subject} *</span><input name="subject" required defaultValue={info.subject} className="input" /></label>
          <label className="field"><span>{S.body} *</span><textarea name="body" required rows={7} defaultValue={info.body} className="input" /></label>
          <p className="m-0 text-xs text-ink-2">{S.attached}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={pending || !info.configured}>{pending ? "…" : S.send}</button>
            <p role="status" aria-live="polite" className="m-0 text-sm">
              {state.error && <span className="font-semibold text-red-ink">{state.error}</span>}
              {state.ok && state.message && <span className="font-semibold text-green-ink">{state.message}</span>}
            </p>
          </div>
        </form>
        {info.history.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-mist pt-3 text-sm">
            <span className="label">{S.history}</span>
            {info.history.map((h) => (
              <div key={h.id} className="min-w-0 break-words">
                {formatDate(locale, h.created_at.slice(0, 10))} · {h.recipient}{h.sender ? ` · ${h.sender}` : ""}
                {h.status !== "sent" && <span className="font-semibold text-red-ink"> · {S.notSent}{h.error ? `: ${h.error}` : ""}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
