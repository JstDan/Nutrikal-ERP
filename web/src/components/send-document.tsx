"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mailThreads, sendDocument } from "@/app/shortcut-actions";
import type { MailThread } from "@/lib/gmail";

const replySubject = (s: string) => (/^re:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`);
import { fmt, formatDate, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import type { ProformaPdfModel } from "@/lib/proforma-pdf";

export type SendKind = "calc_offer" | "proforma" | "invoice" | "delivery_note" | "contract";
export type SendInfo = {
  kind: SendKind; refId: string; to: string; subject: string; body: string; configured: boolean;
  /** The shared Gmail mailbox it leaves from, or null (Resend). */
  via: string | null;
  /** The sender has an e-mail signature: it goes under the message. */
  signed: boolean;
  history: { id: string; recipient: string; status: "sending" | "sent" | "failed"; error: string | null; created_at: string; sender: string | null }[];
  /** The proposed e-mail in both languages, when the sender picks the language of the document (offers; owner, Nov 2026). */
  versions?: Record<"bg" | "en", { subject: string; body: string }>;
  /** The language picked first. */
  lang?: "bg" | "en";
};

/** E-mails a document to the client as a PDF made in the browser, the same file as the download. */
export function SendDocument({ info, model, makePdf, makePdfIn, text, locale, title, id, open, onToggle }: {
  info: SendInfo;
  /** Opened from a button elsewhere (controlled); left out, the card opens on its own heading. */
  id?: string;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  model?: ProformaPdfModel;
  makePdf?: () => Promise<{ base64: string; fileName: string }>;
  /** The document in the language picked on the card (with info.versions): Български or English. */
  makePdfIn?: (lang: "bg" | "en") => Promise<{ base64: string; fileName: string }>;
  text: Dict["send"];
  locale: Locale;
  title?: string;
}) {
  const S = text;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ ok?: boolean; error?: string; message?: string }>({});
  const last = info.history.find((h) => h.status === "sent");
  const pickLang = !!(info.versions && makePdfIn);
  const [lang, setLang] = useState<"bg" | "en">(info.lang ?? "en");
  const [subject, setSubject] = useState(pickLang ? info.versions![lang].subject : info.subject);
  const [body, setBody] = useState(pickLang ? info.versions![lang].body : info.body);
  /** Another language: the subject and the message follow it (whatever was typed is replaced). */
  const changeLang = (l: "bg" | "en") => {
    setLang(l);
    setSubject(info.versions![l].subject);
    setBody(info.versions![l].body);
  };
  // Earlier Gmail conversations with the address: the document can go as a reply in one (owner, Nov 2026)
  const [threads, setThreads] = useState<{ for: string; list: MailThread[]; loading: boolean; error?: string }>({ for: "", list: [], loading: false });
  const [threadId, setThreadId] = useState("");
  const thread = threads.list.find((x) => x.id === threadId);
  const loadThreads = (to: string) => {
    const a = to.trim();
    if (!info.via || a === threads.for) return;
    setThreadId("");
    if (!a.includes("@")) return setThreads({ for: a, list: [], loading: false });
    setThreads({ for: a, list: [], loading: true });
    mailThreads(a)
      .then((r) => setThreads((s) => (s.for === a ? { for: a, list: r.threads ?? [], loading: false, error: r.error } : s)))
      .catch(() => setThreads((s) => (s.for === a ? { for: a, list: [], loading: false, error: S.threadsFailed } : s)));
  };
  // Asked only when the card is open: a page with closed cards makes no Gmail requests
  const openedOnce = useRef(false);
  const opened = () => {
    if (openedOnce.current) return;
    openedOnce.current = true;
    loadThreads(info.to);
  };
  useEffect(() => {
    if (open) opened();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (fd: FormData) => start(async () => {
    setState({});
    try {
      const pdf = model
        ? await (await import("@/lib/proforma-pdf")).proformaPdfBase64(model)
        : pickLang ? await makePdfIn!(lang) : await makePdf!();
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
    <details id={id} open={open} onToggle={(e) => { const o = e.currentTarget.open; if (o) opened(); onToggle?.(o); }} className="card min-w-0 p-5 print:hidden sm:p-6">
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
            <label className="field"><span>{S.to} *</span><input name="to" type="email" required defaultValue={info.to} onBlur={(e) => loadThreads(e.currentTarget.value)} className="input" /></label>
            <label className="field"><span>{S.cc}</span><input name="cc" type="email" className="input" /></label>
          </div>
          {pickLang && (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-semibold">{S.language}</legend>
              <div className="flex flex-wrap gap-2">
                {(["bg", "en"] as const).map((l) => (
                  <label key={l} className={`btn ${lang === l ? "btn-primary" : "btn-outline"} cursor-pointer`}>
                    <input type="radio" name="doc_lang" value={l} checked={lang === l} onChange={() => changeLang(l)} className="sr-only" />
                    {l === "bg" ? S.languageBg : S.languageEn}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {info.via && (
            <label className="field">
              <span>{S.thread}</span>
              <select name="thread_id" value={threadId} onChange={(e) => setThreadId(e.currentTarget.value)} className="input" disabled={threads.loading}>
                <option value="">{threads.loading ? S.threadsLoading : S.newThread}</option>
                {threads.list.map((x) => (
                  <option key={x.id} value={x.id}>
                    {`${x.subject || S.noSubject} · ${formatDate(locale, x.date.slice(0, 10))} · ${x.from.replace(/\s*<[^>]*>/, "") || x.from}${x.count > 1 ? ` (${x.count})` : ""}`}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal text-ink-2">
                {threads.error ?? (thread ? S.threadNote : !threads.loading && threads.for.includes("@") && threads.list.length === 0 ? S.noThreads : S.threadHint)}
              </span>
              {thread?.snippet && <span className="min-w-0 break-words text-xs font-normal text-ink-2">„{thread.snippet}“</span>}
            </label>
          )}
          <label className="field"><span>{S.subject} *</span>
            <input name="subject" required value={thread ? replySubject(thread.subject) : subject} readOnly={!!thread}
              onChange={(e) => setSubject(e.currentTarget.value)} className="input read-only:bg-mist" />
          </label>
          <label className="field"><span>{S.body} *</span><textarea name="body" required rows={7} value={body} onChange={(e) => setBody(e.currentTarget.value)} className="input" /></label>
          <p className="m-0 text-xs text-ink-2">
            {info.signed ? S.signatureAdded : S.noSignature}{" "}
            <a href="/signature" className="font-semibold text-ink underline">{S.signatureLink}</a>
          </p>
          <p className="m-0 text-xs text-ink-2">{info.via ? fmt(S.attachedVia, { mailbox: info.via }) : S.attached}</p>
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
