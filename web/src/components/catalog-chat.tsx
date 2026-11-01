"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { fmt, type AnyLocale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";

const STORE = "nk_catalog_chat";
const TEASER_STORE = "nk_catalog_teaser";
const TEASER_MS = 5000;
const WHATSAPP = "https://wa.me/359882919140";
const AVATAR = "/catalog/site/nutri.svg";
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
type Line = { role: "user" | "assistant"; text: string };

/** On this device for 30 days, so a visitor can close the page and carry on. */
const read = (): { chat: string | null; lines: Line[] } => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? "{}") as { chat?: string; lines?: Line[]; at?: number };
    if (!saved.chat || Date.now() - (saved.at ?? 0) > KEEP_MS) return { chat: null, lines: [] };
    return { chat: saved.chat, lines: (saved.lines ?? []).filter((l) => l.text) };
  } catch {
    return { chat: null, lines: [] };
  }
};

/** An answer in parts: odd places are product codes, shown as cards. A code still arriving stays hidden. */
const parts = (text: string) => text.replace(/\[\[[^\]]*$/, "").split(/\s*\[\[([A-Za-z0-9-]+)\]\]\s*/);

/** The answers are plain text; only our WhatsApp address becomes a link. */
const withLinks = (text: string) => text.split(WHATSAPP).flatMap((part, i) => (i ? [<a key={i} href={WHATSAPP} target="_blank" rel="noopener" className="font-semibold underline">WhatsApp</a>, part] : [part]));

function Avatar({ size = 32 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={AVATAR} alt="" width={size} height={size} style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover" />;
}

/** One button for both ways of reaching us: Nutri AI or WhatsApp. Without AI settings it is WhatsApp alone. */
export function CatalogContactButton({ text, locale, ai, raised, hidden, quote, onAdd, onChat, onQuote, onSent, card }: {
  text: Dict["publicCatalog"]; locale: AnyLocale; ai: boolean; raised: boolean; hidden: boolean; quote: Record<string, number>;
  onAdd: (code: string, quantity: number) => void; onChat: (chat: string) => void; onQuote: () => void; onSent: () => void; card: (code: string) => ReactNode;
}) {
  const T = text;
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [teaser, setTeaser] = useState(false);
  const chat = useRef<string | null>(null);
  const loaded = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const lift = raised ? "bottom-[88px]" : "bottom-4";
  const inQuote = Object.keys(quote).length;

  useEffect(() => {
    const saved = read();
    chat.current = saved.chat;
    if (saved.chat) onChat(saved.chat);
    // Read after the first paint: the server does not know the conversation
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLines(saved.lines);
    loaded.current = true;
  }, [onChat]);
  useEffect(() => {
    if (!loaded.current || !chat.current || !lines.length) return;
    try { localStorage.setItem(STORE, JSON.stringify({ chat: chat.current, lines: lines.slice(-60), at: Date.now() })); } catch { /* it then lasts until the page closes */ }
  }, [lines]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [lines, open]);
  const startOver = () => {
    chat.current = null;
    setLines([]);
    try { localStorage.removeItem(STORE); } catch { /* nothing was kept */ }
  };

  // The invitation comes once, a moment after the page opens, and stays closed once closed
  useEffect(() => {
    try { if (sessionStorage.getItem(TEASER_STORE)) return; } catch { /* it then shows on every visit */ }
    const timer = setTimeout(() => setTeaser(true), TEASER_MS);
    return () => clearTimeout(timer);
  }, []);
  const hideTeaser = () => {
    setTeaser(false);
    try { sessionStorage.setItem(TEASER_STORE, "1"); } catch { /* it then shows on every visit */ }
  };

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
        body: JSON.stringify({ chat: chat.current, locale, text: question, quote: Object.entries(quote).map(([code, quantity]) => ({ code, quantity })) }),
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
          const e = JSON.parse(part) as { done?: boolean; chat?: string; delta?: string | null; add?: { code: string; quantity: number }; sent?: boolean; error?: string; empty?: boolean };
          if (e.chat) { chat.current = e.chat; onChat(e.chat); }
          if (e.done) setLines((l) => [...l]);
          if (e.delta === null) reply(() => "");
          else if (e.delta) reply((t) => t + e.delta);
          if (e.add) onAdd(e.add.code, e.add.quantity);
          if (e.sent) onSent();
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

  if (hidden && !open) return null;

  if (!ai) {
    return (
      <a href={WHATSAPP} target="_blank" rel="noopener" aria-label={T.whatsapp} title={T.whatsapp}
        className={`fixed right-4 z-40 lg:right-6 lg:bottom-6 ${lift} grid h-14 w-14 place-items-center rounded-full bg-[#25D366] text-[#fff] shadow-lg transition-transform hover:scale-105`}>
        <WhatsAppIcon />
      </a>
    );
  }

  return (
    <>
      {!open && (
        <div className={`pointer-events-none fixed inset-x-0 z-40 flex flex-col items-center gap-2 px-4 lg:bottom-6 ${lift}`}>
          {teaser && (
            <div className="chat-in pointer-events-auto flex max-w-full items-center gap-2 rounded-2xl border border-line bg-paper py-1 pr-1 pl-3 text-sm text-ink shadow-lg sm:max-w-[420px]">
              <button type="button" onClick={() => { hideTeaser(); setOpen(true); }} className="min-h-11 min-w-0 flex-1 text-left">{T.chatTeaser}</button>
              <button type="button" onClick={hideTeaser} aria-label={T.close} className="grid h-11 w-9 shrink-0 place-items-center text-lg text-ink-2 hover:text-ink">×</button>
            </div>
          )}
          <button type="button" onClick={() => { hideTeaser(); setOpen(true); }}
            className="nutri-capsule pointer-events-auto flex min-h-14 max-w-full min-w-0 items-center gap-3 rounded-full py-2 pr-8 pl-2 text-left text-base font-semibold transition-transform hover:scale-105">
            <Avatar size={40} /><span className="min-w-0">{lines.length ? T.chatContinue : T.chatAsk}</span>
          </button>
        </div>
      )}

      {open && <button type="button" aria-label={T.close} tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-50 hidden bg-black/50 sm:block" />}
      {open && (
        <aside role="dialog" aria-modal="true" aria-label={T.chatTitle} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          className="chat-in fixed inset-0 z-50 flex flex-col bg-paper text-ink shadow-2xl sm:m-auto sm:h-[min(720px,calc(100dvh-48px))] sm:w-[min(760px,calc(100vw-48px))] sm:rounded-xl sm:border sm:border-line">
          <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line px-4">
            <Avatar size={36} />
            <h2 className="m-0 min-w-0 flex-1 text-base font-bold">{T.chatTitle}</h2>
            {inQuote > 0 && <button type="button" onClick={() => { setOpen(false); onQuote(); }} className="min-h-11 shrink-0 px-2 text-xs font-semibold text-ink underline">{fmt(T.basketCount, { n: inQuote })}</button>}
            {lines.length > 0 && <button type="button" onClick={startOver} disabled={busy} className="min-h-11 px-2 text-xs font-semibold text-ink-2 hover:text-ink">{T.chatNew}</button>}
            <button type="button" onClick={() => setOpen(false)} aria-label={T.close} className="grid h-11 w-11 shrink-0 place-items-center text-xl text-ink-2 hover:text-ink">×</button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 sm:gap-3 sm:p-5">
            <p className="m-0 rounded-md bg-neutral-tint px-3 py-2 text-xs text-ink-2">{T.chatNotice}</p>
            <a href={WHATSAPP} target="_blank" rel="noopener" className="flex min-h-11 items-center gap-2 rounded-md border border-line px-3 py-1 text-sm font-semibold text-ink no-underline hover:bg-neutral-tint">
              <span className="shrink-0 text-[#128C4B]"><WhatsAppIcon size={20} /></span><span className="min-w-0">{T.chatHuman}</span>
            </a>
            {lines.length === 0 && <div className="flex items-end gap-2"><Avatar size={28} /><p className="m-0 max-w-[85%] rounded-2xl rounded-bl-md bg-neutral-tint px-3 py-2 text-sm sm:text-base">{T.chatWelcome}</p></div>}
            {lines.map((l, i) => l.role === "user" ? (
              <div key={i} className="flex min-w-0 items-end justify-end gap-2">
                <p className="m-0 max-w-[85%] min-w-0 rounded-2xl rounded-br-md bg-ink px-3 py-2 text-sm break-words whitespace-pre-wrap text-white sm:text-base">{l.text}</p>
              </div>
            ) : (
              <div key={i} className="flex min-w-0 items-end gap-2">
                <Avatar size={28} />
                <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
                  {!parts(l.text).join("").trim() && <p className="m-0 rounded-2xl rounded-bl-md bg-neutral-tint px-3 py-2 text-sm sm:text-base"><span className="animate-pulse text-ink-2">{T.chatThinking}</span></p>}
                  {parts(l.text).map((part, n) => n % 2 ? <div key={n} className="w-full min-w-0">{card(part)}</div> : part.trim() && (
                    <p key={n} className="m-0 max-w-[85%] min-w-0 rounded-2xl rounded-bl-md bg-neutral-tint px-3 py-2 text-sm break-words whitespace-pre-wrap sm:text-base">{withLinks(part)}</p>
                  ))}
                </div>
              </div>
            ))}
            <div ref={end} />
          </div>
          <form onSubmit={submit} className="flex shrink-0 items-end gap-2 border-t border-line p-3 sm:px-5 sm:py-4">
            <label className="min-w-0 flex-1">
              <span className="sr-only">{T.chatPlaceholder}</span>
              <textarea autoFocus rows={1} value={draft} maxLength={1000} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} placeholder={T.chatPlaceholder} className="input h-12 !min-h-0 w-full resize-none" />
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
