"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { deleteChatMessage, pollChat, sendChat } from "@/app/chat-actions";
import { formatDate, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";

export type ChatMessage = { id: string; author_id: string; author: string; body: string; created_at: string };
const POLL_MS = 4000;

/** The messages of one channel: new ones come every few seconds. Enter sends, Shift+Enter starts a new line. */
export function ChatRoom({ channel, initial, userId, isAdmin, readOnly, locale, text }: {
  channel: string; initial: ChatMessage[]; userId: string; isAdmin: boolean; readOnly: boolean; locale: Locale; text: Dict["chat"];
}) {
  const C = text;
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(initial.at(-1)?.created_at ?? null);

  const refresh = async () => {
    const rows = await pollChat(channel, last.current);
    if (!rows.length) return;
    last.current = rows[rows.length - 1].created_at;
    setMessages((m) => [...m, ...rows.filter((r) => !m.some((x) => x.id === r.id))]);
  };

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, POLL_MS);
    return () => clearInterval(t);
  });
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  const send = () => {
    const body = draft.trim();
    if (!body || pending) return;
    setDraft("");
    setError(null);
    start(async () => {
      const r = await sendChat(channel, body);
      if (r.error) {
        setError(r.error);
        setDraft(body);
      } else await refresh();
    });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const remove = (id: string) => start(async () => {
    await deleteChatMessage(id);
    setMessages((m) => m.filter((x) => x.id !== id));
  });

  return (
    <div className="flex min-h-[calc(100dvh-260px)] min-w-0 flex-col">
      <div className="flex flex-1 flex-col gap-3 pb-4">
        {messages.length === 0 && <p className="my-auto text-center text-sm text-ink-2">{C.empty}</p>}
        {messages.map((m) => (
          <div key={m.id} className="min-w-0 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-bold">{m.author}</span>
              <span className="text-xs text-ink-2">{formatDate(locale, m.created_at.slice(0, 10), { day: "numeric", month: "short" })} {m.created_at.slice(11, 16)}</span>
              {(m.author_id === userId || isAdmin) && !readOnly && (
                <button type="button" onClick={() => remove(m.id)} className="min-h-6 text-xs text-ink-2 underline">{C.delete}</button>
              )}
            </div>
            <p className="m-0 whitespace-pre-line break-words">{m.body}</p>
          </div>
        ))}
        <div ref={end} />
      </div>
      {readOnly ? <p className="m-0 text-sm text-ink-2">{C.readOnly}</p> : (
        <div className="sticky bottom-0 bg-canvas pt-2 pb-4">
          {error && <p role="alert" className="m-0 mb-2 text-sm font-semibold text-red-ink">{error}</p>}
          <form onSubmit={(e) => { e.preventDefault(); send(); }}
            className="flex min-w-0 items-end gap-2 rounded-2xl border border-line-strong bg-paper p-1.5 focus-within:border-ink">
            <label htmlFor="chat-text" className="sr-only">{C.message}</label>
            <textarea id="chat-text" rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
              placeholder={C.message} className="max-h-40 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm text-ink outline-none" />
            <button type="submit" aria-label={C.send} disabled={pending || !draft.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-lg text-white disabled:opacity-40">↑</button>
          </form>
        </div>
      )}
    </div>
  );
}
