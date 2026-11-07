"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmt, formatDate } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { acceptContract, commentContract } from "@/app/contract-actions";
import { contractModel, type ContractRow, type ContractSeller } from "@/lib/contract-model";

type C = Dict["contract"];
export type PublicComment = { from_client: boolean; name: string; body: string; at: string; version: number };

/** The client's side of the link: comments and requested changes, acceptance, and the PDF. */
export function ContractPublic({ token, k, seller, comments, C }: {
  token: string; k: ContractRow; seller: ContractSeller; comments: PublicComment[]; C: C;
}) {
  const O = C.open;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [who, setWho] = useState({ name: "", title: "", email: "" });
  const [agree, setAgree] = useState(false);
  const [comment, setComment] = useState("");
  const open = k.status === "draft" || k.status === "sent";
  const when = (d: string) => formatDate(k.locale, d, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const download = () => start(async () => {
    const { downloadContractPdf } = await import("@/lib/contract-pdf");
    await downloadContractPdf(contractModel(k, seller));
  });
  const accept = () => start(async () => {
    setError(null);
    const r = await acceptContract(token, who.name, who.title, who.email).catch((): { error: string } => ({ error: "…" }));
    if (r.error) setError(r.error); else router.refresh();
  });
  const send = () => start(async () => {
    setError(null);
    const r = await commentContract(token, who.name, who.email, comment).catch((): { error: string } => ({ error: "…" }));
    if (r.error) setError(r.error); else { setComment(""); setNote(O.commentDone); router.refresh(); }
  });

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="ct-comments" className="flex flex-col gap-3 rounded-lg border border-line bg-white p-4 sm:p-5">
        <h2 id="ct-comments" className="m-0 text-base font-bold">{C.comments}</h2>
        {comments.length === 0 && <p className="m-0 text-sm text-ink-2">{C.noComments}</p>}
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {comments.map((m, i) => (
            <li key={i} className={`flex flex-col gap-1 rounded-md p-3 text-sm ${m.from_client ? "bg-mist" : "bg-green-tint"}`}>
              <span className="text-xs font-semibold">{m.from_client ? m.name : `${m.name} · ${O.team}`} <span className="font-normal text-ink-2">· {when(m.at)} · {fmt(C.versionN, { n: m.version })}</span></span>
              <span className="break-words whitespace-pre-line">{m.body}</span>
            </li>
          ))}
        </ol>
        {k.status !== "signed" && (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <h3 className="m-0 text-sm font-bold">{O.comment}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="field"><span>{O.name} *</span><input className="input" required value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} /></label>
              <label className="field"><span>{O.email}</span><input type="email" className="input" value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })} /></label>
            </div>
            <label className="field"><span>{O.commentText} *</span><textarea className="input" rows={4} required maxLength={5000} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
            <button type="submit" className="btn btn-outline w-fit" disabled={pending || !comment.trim() || !who.name.trim()}>{O.commentSend}</button>
            {note && <p role="status" className="m-0 text-sm font-semibold text-green-ink">{note}</p>}
          </form>
        )}
      </section>

      {open ? (
        <form className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-white p-4 sm:p-5" onSubmit={(e) => { e.preventDefault(); accept(); }}>
          <h2 className="m-0 text-base font-bold">{O.accept}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="field"><span>{O.name} *</span><input className="input" required autoComplete="name" value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} /></label>
            <label className="field"><span>{O.position}</span><input className="input" autoComplete="organization-title" value={who.title} onChange={(e) => setWho({ ...who, title: e.target.value })} /></label>
            <label className="field"><span>{O.email} *</span><input type="email" className="input" required autoComplete="email" value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })} /></label>
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-ink" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>{fmt(O.agree, { client: k.client })}</span>
          </label>
          <button type="submit" className="btn btn-primary w-fit" disabled={pending || !agree || !who.name.trim() || !who.email.trim()}>{O.accept}</button>
        </form>
      ) : (
        <p role="status" className="m-0 rounded-lg bg-green-tint p-4 text-sm font-semibold text-green-ink">
          {k.status === "accepted" && k.accepted_at ? fmt(O.done, { date: when(k.accepted_at) }) : O.signed}
        </p>
      )}
      {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
      <button type="button" className="btn btn-outline w-fit" disabled={pending} onClick={download}>{O.download}</button>
    </div>
  );
}
