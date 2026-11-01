"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { AnyLocale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";

const STORE = "nk_catalog_chat";
const WHATSAPP = "https://wa.me/359882919140";
type Line = { role: "user" | "assistant"; text: string };

const read = (): { chat: string | null; lines: Line[] } => {
  try {
    return { chat: null, lines: [], ...JSON.parse(sessionStorage.getItem(STORE) ?? "{}") };
  } catch {
    return { chat: null, lines: [] };
  }
};

/** One button for both ways of reaching us: Nutri AI or WhatsApp. Without AI settings it is WhatsApp alone. */
export function CatalogContactButton({ text, locale, ai, raised, onAdd, onChat }: {
  text: Dict["publicCatalog"]; locale: AnyLocale; ai: boolean; raised: boolean;
  onAdd: (code: string, quantity: number) => void; onChat: (chat: string) => void;
}) {
  const T = text;
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const chat = useRef<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const place = `fixed right-4 z-40 lg:bottom-6 lg:right-6 ${raised ? "bottom-[88px]" : "bottom-4"}`;

  useEffect(() => {
    const saved = read();
    chat.current = saved.chat;
    if (saved.chat) onChat(saved.chat);
    // Read after the first paint: the server does not know the conversation
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLines(saved.lines);
  }, [onChat]);
  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify({ chat: chat.current, lines })); } catch { /* it then lasts until the page closes */ }
    end.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  const reply = (change: (t: string) => string) => setLines((l) => {
    const last = l.at(-1);
    return last?.role === "assistant" ? [...l.slice(0, -1), { ...last, text: change(last.text) }] : [...l, { role: "assistant", text: change("") }];
  });

  async function ask() {
    const question = draft.trim();
    if (!question || busy) return;
    setDraft("");
    setBusy(true);
    setLines((l) => [...l, { role: "user", text: question }, { role: "assistant", text: "" }]);
    try {
      const r = await fetch("/api/catalog-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat: chat.current, locale, text: question }),
      });
      if (!r.ok || !r.body) {
        const out = await r.json().catch(() => ({}));
        reply(() => (out.error === "busy" ? T.chatBusy : T.chatFailed));
        return;
      }
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let rest = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        rest += value;
        const parts = rest.split("\n");
        rest = parts.pop() ?? "";
        for (const part of parts.filter(Boolean)) {
          const e = JSON.parse(part) as { chat?: string; delta?: string | null; add?: { code: string; quantity: number }; error?: string; empty?: boolean };
          if (e.chat) { chat.current = e.chat; onChat(e.chat); }
          if (e.delta === null) reply(() => "");
          else if (e.delta) reply((t) => t + e.delta);
          if (e.add) onAdd(e.add.code, e.add.quantity);
          if (e.error || e.empty) reply(() => T.chatFailed);
        }
      }
    } catch {
      reply(() => T.chatFailed);
    } finally {
      setBusy(false);
    }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); } };

  if (!ai) {
    return (
      <a href={WHATSAPP} target="_blank" rel="noopener" aria-label={T.whatsapp} title={T.whatsapp}
        className={`${place} grid h-14 w-14 place-items-center rounded-full bg-[#25D366] text-[#fff] shadow-lg transition-transform hover:scale-105`}>
        <WhatsAppIcon />
      </a>
    );
  }

  return (
    <>
      {!open && (
        <div className={`${place} flex flex-col items-end gap-2`}>
          {menu && (
            <div className="flex flex-col items-end gap-2">
              <button type="button" onClick={() => { setMenu(false); setOpen(true); }} className="flex min-h-11 items-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold text-white shadow-lg">{T.chatAsk}</button>
              <a href={WHATSAPP} target="_blank" rel="noopener" className="flex min-h-11 items-center gap-2 rounded-full bg-[#25D366] px-4 text-sm font-semibold text-[#10381f] no-underline shadow-lg">
                <WhatsAppIcon size={18} />WhatsApp
              </a>
            </div>
          )}
          <button type="button" aria-expanded={menu} aria-label={T.chatOpen} title={T.chatOpen} onClick={() => setMenu((m) => !m)}
            className="grid h-14 w-14 place-items-center rounded-full bg-[#25D366] text-[#fff] shadow-lg transition-transform hover:scale-105">
            {menu ? <span aria-hidden="true" className="text-2xl leading-none">×</span> : <WhatsAppIcon />}
          </button>
        </div>
      )}

      {open && (
        <aside role="dialog" aria-label={T.chatTitle} className="chat-in fixed inset-0 z-50 flex flex-col bg-paper text-ink shadow-2xl sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[560px] sm:max-h-[calc(100dvh-48px)] sm:w-[380px] sm:rounded-xl sm:border sm:border-line">
          <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line px-4">
            <h2 className="m-0 min-w-0 flex-1 text-base font-bold">{T.chatTitle}</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label={T.close} className="grid h-11 w-11 shrink-0 place-items-center text-xl text-ink-2 hover:text-ink">×</button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
            <p className="m-0 rounded-md bg-neutral-tint px-3 py-2 text-xs text-ink-2">{T.chatNotice}</p>
            {lines.length === 0 && <p className="m-0 max-w-[90%] rounded-2xl rounded-bl-md bg-neutral-tint px-3 py-2 text-sm">{T.chatWelcome}</p>}
            {lines.map((l, i) => (
              <p key={i} className={`m-0 max-w-[90%] rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap ${l.role === "user" ? "ml-auto rounded-br-md bg-ink text-white" : "rounded-bl-md bg-neutral-tint"}`}>
                {l.text || <span className="animate-pulse text-ink-2">{T.chatThinking}</span>}
              </p>
            ))}
            <div ref={end} />
          </div>
          <form onSubmit={submit} className="flex shrink-0 items-end gap-2 border-t border-line p-3">
            <label className="min-w-0 flex-1">
              <span className="sr-only">{T.chatPlaceholder}</span>
              <textarea autoFocus rows={1} value={draft} maxLength={1000} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} placeholder={T.chatPlaceholder} className="input max-h-32 w-full resize-none" />
            </label>
            <button type="submit" aria-label={T.chatSend} disabled={busy || !draft.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-lg text-white disabled:opacity-40">↑</button>
          </form>
        </aside>
      )}
    </>
  );
}

function WhatsAppIcon({ size = 28 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" d="M17.5 14.4c-.3-.1-1.800-.9-2-1-.3-.1-.5-.1-.7.2-.2.3-.8 1-.9 1.200-.2.2-.3.2-.6.1-.3-.2-1.300-.5-2.400-1.500-.9-.8-1.500-1.800-1.700-2.100-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.1-.7-1.600-.9-2.200-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.400s1 2.800 1.200 3c.1.200 2 3.100 4.900 4.300.7.3 1.200.5 1.600.6.7.2 1.300.2 1.800.1.600-.1 1.800-.7 2-1.400.2-.7.2-1.300.2-1.400-.1-.1-.3-.2-.6-.4zM12 2a10 10 0 0 0-8.600 15L2 22l5.100-1.300A10 10 0 1 0 12 2z" />
    </svg>
  );
}
