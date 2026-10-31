"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { askPanel, openPanelConversation } from "@/app/assistant-actions";
import { ProposalCard, type ChatLine, type ChatProposal } from "@/components/assistant-chat";
import type { Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";

const KEY = "nk_assistant_conversation";
const storage = {
  get: () => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set: (id: string | null) => { try { if (id) sessionStorage.setItem(KEY, id); else sessionStorage.removeItem(KEY); } catch { /* the chat works without it */ } },
};

/** The assistant on every page: a round button, and a panel at the side that keeps its conversation while the person moves around. */
export function AssistantPanel({ models, configured, locale, text }: {
  models: { label: string; id: string }[]; configured: boolean; locale: Locale; text: Dict["assistant"];
}) {
  const A = text;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [conversation, setConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [proposals, setProposals] = useState<ChatProposal[]>([]);
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState(models[0]?.id ?? "");
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  const close = () => { setOpen(false); opener.current?.focus(); };
  const show = () => {
    setOpen(true);
    const saved = storage.get();
    if (saved && saved !== conversation) {
      start(async () => {
        const r = await openPanelConversation(saved);
        if (r) { setConversation(saved); setMessages(r.messages); setProposals(r.proposals); } else storage.set(null);
      });
    }
  };

  useEffect(() => { if (open) box.current?.focus(); }, [open]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages.length, waiting, open]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  // Ctrl+J or Cmd+J opens and closes it from anywhere; Esc closes
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (open) close(); else show();
      } else if (e.key === "Escape" && open) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const send = (value: string) => {
    const question = value.trim();
    if (!question || pending || !configured) return;
    setError(null);
    setDraft("");
    setWaiting(question);
    const fd = new FormData();
    fd.set("text", question);
    fd.set("model", model);
    fd.set("page", pathname);
    if (conversation) fd.set("conversation_id", conversation);
    start(async () => {
      try {
        const r = await askPanel(fd);
        if ("error" in r) {
          setError(r.error);
          setDraft(question);
        } else {
          setConversation(r.id);
          storage.set(r.id);
          setMessages(r.messages);
          setProposals(r.proposals);
        }
      } catch (e) {
        console.error(e);
        setError(A.failed);
        setDraft(question);
      }
      setWaiting(null);
    });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };
  const fresh = () => {
    setConversation(null);
    setMessages([]);
    setProposals([]);
    setError(null);
    storage.set(null);
    box.current?.focus();
  };
  const answerOf = (p: ChatProposal) => messages.find((m) => m.role === "assistant" && m.created_at >= p.created_at)?.id;

  // The full page is the assistant already
  if (pathname.startsWith("/assistant")) return null;

  if (!open) {
    return (
      <button ref={opener} type="button" onClick={show} aria-label={A.open} aria-keyshortcuts="Control+J"
        className="fixed right-4 bottom-4 z-40 flex h-14 items-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-white shadow-lg hover:opacity-90 print:hidden sm:right-6 sm:bottom-6">
        <span aria-hidden="true" className="text-lg leading-none">✦</span>
        <span className="hide-sm">{A.openShort}</span>
      </button>
    );
  }

  return (
    <aside role="dialog" aria-label={A.title}
      className="fixed inset-0 z-40 flex flex-col bg-paper text-ink shadow-2xl print:hidden sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[420px] sm:border-l sm:border-line">
      <header className="flex items-center gap-1 border-b border-line px-3 py-2">
        <h2 className="m-0 min-w-0 flex-1 truncate text-base font-bold">{A.title}</h2>
        <button type="button" onClick={fresh} className="min-h-11 rounded-sm px-2 text-xs font-semibold text-ink-2 hover:text-ink">{A.newShort}</button>
        <Link href={conversation ? `/assistant?c=${conversation}` : "/assistant"} onClick={() => setOpen(false)} className="flex min-h-11 items-center rounded-sm px-2 text-xs font-semibold text-ink-2 no-underline hover:text-ink">{A.openFull}</Link>
        <button type="button" onClick={close} aria-label={A.close} className="flex h-11 w-11 items-center justify-center rounded-sm text-xl text-ink-2 hover:text-ink">×</button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !waiting && (
          <div className="my-auto flex flex-col gap-3 text-center">
            <p className="m-0 text-lg font-bold">{A.welcome}</p>
            <p className="m-0 text-sm text-ink-2">{A.panelHint}</p>
            <div className="flex flex-col gap-2">
              {A.panelSuggestions.map((s) => (
                <button key={s} type="button" disabled={!configured || pending} onClick={() => send(s)}
                  className="min-h-11 rounded-lg border border-line-strong bg-paper px-3 py-2 text-left text-sm text-ink hover:border-ink">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => m.role === "user" ? (
          <div key={m.id} className="ml-auto max-w-[88%] min-w-0 rounded-2xl rounded-br-sm bg-ink px-3.5 py-2 text-sm text-white">
            <p className="m-0 whitespace-pre-line break-words">{m.content}</p>
          </div>
        ) : (
          <div key={m.id} className="flex min-w-0 flex-col gap-2 text-sm leading-relaxed">
            <p className="m-0 whitespace-pre-line break-words">{m.content}</p>
            {proposals.filter((p) => answerOf(p) === m.id).map((p) => <ProposalCard key={p.id} p={p} locale={locale} A={A} />)}
          </div>
        ))}
        {waiting && (
          <>
            <div className="ml-auto max-w-[88%] min-w-0 rounded-2xl rounded-br-sm bg-ink px-3.5 py-2 text-sm text-white">
              <p className="m-0 whitespace-pre-line break-words">{waiting}</p>
            </div>
            <p role="status" className="m-0 animate-pulse text-sm text-ink-2">{A.thinking}</p>
          </>
        )}
        <div ref={end} />
      </div>

      <div className="border-t border-line p-3">
        {!configured && <p className="m-0 mb-2 text-sm font-semibold">{A.notConfigured}</p>}
        {error && <p role="alert" className="m-0 mb-2 text-sm font-semibold text-red-ink">{error}</p>}
        <form onSubmit={(e) => { e.preventDefault(); send(draft); }}
          className="flex min-w-0 items-end gap-2 rounded-2xl border border-line-strong bg-paper p-1.5 focus-within:border-ink">
          <label htmlFor="panel-text" className="sr-only">{A.question}</label>
          <textarea id="panel-text" ref={box} rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
            placeholder={A.placeholder} className="max-h-40 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm text-ink outline-none" />
          <button type="submit" aria-label={A.send} disabled={pending || !draft.trim() || !configured}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-lg text-white disabled:opacity-40">↑</button>
        </form>
        {models.length > 1 && (
          <div className="mt-1 flex justify-end">
            <label htmlFor="panel-model" className="sr-only">{A.model}</label>
            <select id="panel-model" value={model} onChange={(e) => setModel(e.target.value)}
              className="min-h-11 max-w-[180px] border-0 bg-transparent px-1 text-xs font-semibold text-ink-2">
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        )}
      </div>
    </aside>
  );
}
