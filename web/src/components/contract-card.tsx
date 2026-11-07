"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmt, formatDate, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { contractOp, contractToDrive, type ContractOp } from "@/app/contract-actions";
import { contractModel, type ContractRow, type ContractSeller } from "@/lib/contract-model";
import { SendDocument, type SendInfo } from "@/components/send-document";
import { ContractBody } from "@/components/contract-body";

type C = Dict["contract"];
export type CardContract = ContractRow & {
  id: string; token: string; version: number; accepted_email: string | null; accepted_ip: string | null;
  drive_url: string | null; drive_version: number | null; signed_url: string | null;
};
export type CardComment = { from_client: boolean; author_name: string; body: string; created_at: string; version: number };
export type CardVersion = { version: number; created_at: string; accepted: { name: string; at: string } | null };

const TONE: Record<string, string> = {
  draft: "bg-neutral-tint text-ink", sent: "bg-amber-tint text-amber-ink", accepted: "bg-green-tint text-green-ink", signed: "bg-green-tint text-green-ink",
};

/** The contract of an order: make it, correct it, talk about it with the client, send it, mark it signed. */
export function ContractCard({ orderId, k, comments, versions, seller, link, canSign, canEdit, send, sendText, C, locale }: {
  orderId: string; k: CardContract | null; comments: CardComment[]; versions: CardVersion[]; seller: ContractSeller; link: string;
  canSign: boolean; canEdit: boolean; send: SendInfo | null; sendText: Dict["send"]; C: C; locale: Locale;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(k?.body ?? "");
  const [comment, setComment] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signedUrl, setSignedUrl] = useState("");
  const when = (d: string) => formatDate(locale, d, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const run = (op: ContractOp, id: string, text?: string, after?: (token?: string) => void) => start(async () => {
    setError(null); setNote(null);
    const r = await contractOp(orderId, op, id, text).catch((): { error: string; token?: string } => ({ error: "…" }));
    if (r.error) setError(r.error); else { after?.(r.token); router.refresh(); }
  });

  if (!k) {
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm text-ink-2">{C.none}</p>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run("make", orderId, "bg")}>{fmt(C.makeIn, { lang: "БГ" })}</button>
            <button type="button" className="btn btn-outline" disabled={pending} onClick={() => run("make", orderId, "en")}>{fmt(C.makeIn, { lang: "EN" })}</button>
          </div>
        )}
        {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
      </div>
    );
  }

  const fixed = k.status === "signed";
  const pdf = async () => {
    const { contractPdfBase64 } = await import("@/lib/contract-pdf");
    return contractPdfBase64(contractModel(k, seller));
  };
  // Google eSignature is asked for in Drive by hand: the PDF goes there and opens in a new tab
  const toDrive = () => {
    const tab = window.open("about:blank", "_blank");
    start(async () => {
      setError(null);
      const f = await pdf();
      const r = await contractToDrive(orderId, k.id, f.base64, f.fileName).catch((): { error: string; url?: string } => ({ error: "…" }));
      if (r.error || !r.url) { tab?.close(); setError(r.error ?? "…"); return; }
      if (tab) tab.location.href = r.url; else window.open(r.url, "_blank");
      router.refresh();
    });
  };
  const download = () => start(async () => {
    const { downloadContractPdf } = await import("@/lib/contract-pdf");
    await downloadContractPdf(contractModel(k, seller));
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <strong>{fmt(C.number, { no: k.number })}</strong>
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[k.status] ?? ""}`}>{C.status[k.status as "sent"]}</span>
        <span className="text-ink-2">{k.locale.toUpperCase()} · {fmt(C.versionN, { n: k.version })}</span>
      </div>
      {k.accepted_at && (
        <p className="m-0 rounded-sm bg-green-tint p-3 text-sm text-green-ink">
          {fmt(C.accepted, { name: k.accepted_name ?? "", title: k.accepted_title ? `, ${k.accepted_title}` : "", email: k.accepted_email ?? "", date: when(k.accepted_at), ip: k.accepted_ip ?? "—" })}
        </p>
      )}
      {k.signed_at && (
        <p className="m-0 rounded-sm bg-green-tint p-3 text-sm text-green-ink">
          {fmt(C.signedByHand, { date: when(k.signed_at) })}
          {k.signed_url && <> · <a href={k.signed_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-green-ink underline">{C.signedFile}</a></>}
        </p>
      )}
      {!fixed && k.drive_url && (
        <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
          <a href={k.drive_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline">{fmt(C.driveOpen, { n: k.drive_version ?? 1 })}</a>
          {(k.drive_version ?? 0) < k.version && <span className="rounded-full bg-amber-tint px-2 py-0.5 text-xs font-semibold text-amber-ink">{fmt(C.driveOld, { n: k.drive_version ?? 1 })}</span>}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-outline" disabled={pending} onClick={download}>{C.download}</button>
        <button type="button" className="btn btn-outline" aria-expanded={preview} onClick={() => setPreview(!preview)}>{preview ? "×" : "👁"} {C.title}</button>
        {canEdit && !fixed && (
          <button type="button" className="btn btn-outline" disabled={pending}
            onClick={() => run("sent", k.id, undefined, () => { void navigator.clipboard?.writeText(link).catch(() => {}); setNote(C.copied); })}>{C.copyLink}</button>
        )}
        {canEdit && !fixed && <button type="button" className="btn btn-outline" onClick={() => { setBody(k.body); setEditing(!editing); }}>{C.edit}</button>}
        {canEdit && !fixed && <button type="button" className="btn btn-outline" disabled={pending} onClick={() => run("refresh", k.id)}>{C.refresh}</button>}
        {canEdit && !fixed && <button type="button" className="btn btn-primary" disabled={pending} onClick={toDrive}>{C.drive}</button>}
        {canSign && !fixed && <button type="button" className="btn btn-outline" aria-expanded={signing} onClick={() => setSigning(!signing)}>{C.markSigned}</button>}
        {canEdit && !confirm && <button type="button" className="btn btn-outline text-red-ink" onClick={() => setConfirm(true)}>{C.cancel}</button>}
      </div>
      <p className="m-0 text-xs break-all text-ink-2">{link}</p>
      {canEdit && !fixed && <p className="m-0 text-xs text-ink-2">{C.driveHint}</p>}
      {signing && canSign && !fixed && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run("signed", k.id, signedUrl, () => setSigning(false)); }}>
          <label className="field min-w-0 flex-[1_1_320px]"><span>{C.signedLink}</span>
            <input type="url" className="input" placeholder="https://drive.google.com/…" value={signedUrl} onChange={(e) => setSignedUrl(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={pending}>{C.markSigned}</button>
        </form>
      )}
      {note && <p role="status" className="m-0 text-sm font-semibold text-green-ink">{note}</p>}
      {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
      {confirm && (
        <div className="flex flex-col gap-2 rounded-sm border border-red-line bg-red-tint p-3">
          <p className="m-0 text-sm font-semibold text-red-ink">{fmt(C.cancelConfirm, { no: k.number })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run("cancel", k.id, undefined, () => setConfirm(false))}>{C.cancel}</button>
            <button type="button" className="btn btn-outline" onClick={() => setConfirm(false)}>×</button>
          </div>
        </div>
      )}

      {editing && (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run("save", k.id, body, () => setEditing(false)); }}>
          <p className="m-0 text-xs text-ink-2">{C.editHint} {k.status !== "draft" && C.correctionNote}</p>
          <label className="field"><span className="sr-only">{C.edit}</span>
            <textarea className="input font-mono text-[13px]" rows={18} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary" disabled={pending || !body.trim()}>{C.save}</button>
            <button type="button" className="btn btn-outline" onClick={() => setEditing(false)}>×</button>
          </div>
        </form>
      )}
      {preview && <div className="rounded-sm border border-line p-4"><ContractBody k={k} /></div>}

      <section aria-labelledby="contract-comments-h" className="flex flex-col gap-2 border-t border-mist pt-3">
        <h3 id="contract-comments-h" className="m-0 text-sm font-bold tracking-[1px] uppercase text-ink-2">{C.comments} · {comments.length}</h3>
        {comments.length === 0 && <p className="m-0 text-sm text-ink-2">{C.noComments}</p>}
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {comments.map((m, i) => (
            <li key={i} className={`flex flex-col gap-1 rounded-md p-3 text-sm ${m.from_client ? "bg-amber-tint" : "bg-mist"}`}>
              <span className="text-xs font-semibold">{m.author_name}{m.from_client ? ` (${C.client})` : ""} <span className="font-normal text-ink-2">· {when(m.created_at)} · {fmt(C.versionN, { n: m.version })}</span></span>
              <span className="break-words whitespace-pre-line">{m.body}</span>
            </li>
          ))}
        </ol>
        {canEdit && !fixed && (
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) run("comment", k.id, comment, () => setComment("")); }}>
            <label className="field"><span className="sr-only">{C.commentPlaceholder}</span>
              <textarea className="input" rows={2} value={comment} placeholder={C.commentPlaceholder} onChange={(e) => setComment(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-outline w-fit" disabled={pending || !comment.trim()}>{C.commentSend}</button>
          </form>
        )}
      </section>

      {versions.length > 0 && (
        <details className="border-t border-mist pt-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{C.versions} · {versions.length}</summary>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {versions.map((v) => (
              <li key={v.version}>{fmt(C.versionN, { n: v.version })} · {when(v.created_at)}{v.accepted ? ` · ${fmt(C.versionAccepted, { name: v.accepted.name, date: when(v.accepted.at) })}` : ""}</li>
            ))}
          </ul>
        </details>
      )}

      {send && canEdit && !fixed && <SendDocument info={send} makePdf={pdf} text={sendText} locale={locale} />}
    </div>
  );
}
