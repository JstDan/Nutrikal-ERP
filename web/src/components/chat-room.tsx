"use client";

import { Fragment, useEffect, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { deleteChatMessage, editChatMessage, pollChat, sendChat, toggleReaction } from "@/app/chat-actions";
import { formatDate, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";

export type ChatAttachment = { id: string; name: string; mime: string | null; size: number };
export type ChatReaction = { emoji: string; n: number; mine: boolean };
export type ChatMessage = {
  id: string; author_id: string; author: string; body: string; created_at: string; edited_at: string | null;
  attachments: ChatAttachment[]; reactions: ChatReaction[];
};
export type ChatPerson = { id: string; full_name: string };

const POLL_MS = 4000;
/** Nutrikal's own emoji first: public/emoji/<code>.svg, written :code: in a message. */
const BRAND = ["capsule", "jar", "leaf", "flask", "coa", "pallet", "mg", "nutrikal"];
const EMOJI = ["👍", "❤️", "😂", "🎉", "🔥", "🙏", "👀", "✅", "🚀", "💪", "😅", "🤔"];
const IMAGE = /^image\/(png|jpeg|webp|gif)$/;

const Emoji = ({ code }: { code: string }) =>
  BRAND.includes(code)
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={`/emoji/${code}.svg`} alt={`:${code}:`} title={code} className="inline-block h-[1.35em] w-[1.35em] align-text-bottom" />
    : <>{code}</>;

/** Links, Nutrikal emoji and mentions in a message. Nothing else in the text is treated as markup. */
function Body({ text, names }: { text: string; names: string[] }) {
  const mention = names.length ? `|@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})` : "";
  const parts = text.split(new RegExp(`(https?://[^\\s]+|:(?:${BRAND.join("|")}):${mention})`, "g"));
  return (
    <>
      {parts.map((p, i): ReactNode => {
        if (i % 2 === 0) return <Fragment key={i}>{p}</Fragment>;
        if (p.startsWith("http")) return <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="break-all text-ink underline">{p}</a>;
        if (p.startsWith("@")) return <span key={i} className="rounded-sm bg-neutral-tint px-1 font-semibold">{p}</span>;
        return <Emoji key={i} code={p.slice(1, -1)} />;
      })}
    </>
  );
}

function Picker({ onPick, label }: { onPick: (code: string) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-5 gap-1 rounded-lg border border-line-strong bg-paper p-2 shadow-lg">
      {[...BRAND, ...EMOJI].map((e) => (
        <button key={e} type="button" onClick={() => onPick(e)} aria-label={e} className="flex h-11 w-11 items-center justify-center rounded-sm text-xl hover:bg-mist">
          <Emoji code={e} />
        </button>
      ))}
    </div>
  );
}

/** One channel: new messages come every few seconds. Enter sends, Shift+Enter starts a new line, @ mentions a person. */
export function ChatRoom({ channel, initial, people, me, userId, isAdmin, locale, text, warning }: {
  channel: string; initial: ChatMessage[]; people: ChatPerson[]; me: string; userId: string; isAdmin: boolean; locale: Locale; text: Dict["chat"]; warning?: string | null;
}) {
  const C = text;
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [mentions, setMentions] = useState<ChatPerson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const names = [me, ...people.map((p) => p.full_name)];

  const query = draft.match(/(?:^|\s)@([^\s@]*)$/)?.[1];
  const options = query === undefined ? [] : people.filter((p) => p.full_name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const refresh = async () => setMessages(await pollChat(channel, messages.at(-1)?.id ?? null));

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden && !pending) refresh().catch(() => {}); }, POLL_MS);
    return () => clearInterval(t);
  });
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages.length]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const choose = (p: ChatPerson) => {
    setDraft(draft.replace(/@([^\s@]*)$/, `@${p.full_name} `));
    setMentions((m) => (m.some((x) => x.id === p.id) ? m : [...m, p]));
    box.current?.focus();
  };
  const send = () => {
    const body = draft.trim();
    if ((!body && !files.length) || pending) return;
    const fd = new FormData();
    fd.set("channel", channel);
    fd.set("body", body);
    fd.set("mentions", JSON.stringify(mentions.filter((m) => body.includes(`@${m.full_name}`)).map((m) => m.id)));
    files.forEach((f) => fd.append("files", f));
    const sentFiles = files;
    setDraft("");
    setFiles([]);
    setMentions([]);
    setError(null);
    start(async () => {
      const r = await sendChat(fd).catch(() => ({ error: C.failed }));
      if (r.error) {
        setError(r.error);
        setDraft(body);
        setFiles(sentFiles);
      } else await refresh();
    });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (options.length) choose(options[0]); else send();
    }
  };
  const act = (fn: () => Promise<unknown>) => start(async () => { await fn(); await refresh(); });
  const addEmoji = (code: string) => {
    setDraft((d) => `${d}${BRAND.includes(code) ? `:${code}:` : code}`);
    setPickerFor(null);
    box.current?.focus();
  };
  const react = (id: string, code: string) => {
    setPickerFor(null);
    act(() => toggleReaction(id, BRAND.includes(code) ? `:${code}:` : code));
  };

  return (
    <div className="flex min-h-[calc(100dvh-260px)] min-w-0 flex-col">
      {warning && <p className="m-0 mb-3 rounded-sm bg-amber-tint px-3 py-2 text-sm font-semibold text-amber-ink">{warning}</p>}
      <div className="flex flex-1 flex-col gap-3 pb-4">
        {messages.length === 0 && <p className="my-auto text-center text-sm text-ink-2">{C.empty}</p>}
        {messages.map((m, i) => {
          const day = m.created_at.slice(0, 10);
          const newDay = day !== messages[i - 1]?.created_at.slice(0, 10);
          return (
            <Fragment key={m.id}>
              {newDay && <div className="text-center text-xs font-semibold text-ink-2">{formatDate(locale, day, { day: "numeric", month: "long" })}</div>}
              <div className="group relative min-w-0 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-bold">{m.author}</span>
                  <span className="text-xs text-ink-2">{m.created_at.slice(11, 16)}{m.edited_at ? ` · ${C.edited}` : ""}</span>
                </div>
                {editing?.id === m.id ? (
                  <form data-chat className="mt-1 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); const x = editing; setEditing(null); act(() => editChatMessage(x.id, x.body)); }}>
                    <textarea aria-label={C.edit} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} className="input" />
                    <div className="flex gap-2">
                      <button type="submit" className="btn btn-primary">{C.save}</button>
                      <button type="button" onClick={() => setEditing(null)} className="btn btn-outline">{C.cancel}</button>
                    </div>
                  </form>
                ) : m.body !== "📎" && <p className="m-0 whitespace-pre-line break-words"><Body text={m.body} names={names} /></p>}
                {m.attachments.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {m.attachments.map((a) => (IMAGE.test(a.mime ?? "")
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <a key={a.id} href={`/files/chat/${a.id}`} target="_blank" rel="noopener noreferrer"><img src={`/files/chat/${a.id}`} alt={a.name} className="max-h-48 max-w-full rounded-sm border border-line" /></a>
                      : <a key={a.id} href={`/files/chat/${a.id}?download=1`} className="flex min-h-11 max-w-full items-center gap-2 rounded-sm border border-line bg-paper px-3 text-xs font-semibold text-ink no-underline"><span aria-hidden="true">📎</span><span className="break-all">{a.name}</span></a>))}
                  </div>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {m.reactions.map((r) => {
                    const code = r.emoji.replace(/^:|:$/g, "");
                    return (
                      <button key={r.emoji} type="button" aria-pressed={r.mine} onClick={() => react(m.id, code)}
                        className={`flex min-h-8 items-center gap-1 rounded-full border px-2 text-xs ${r.mine ? "border-ink bg-neutral-tint" : "border-line bg-paper"}`}>
                        <Emoji code={code} /> {r.n}
                      </button>
                    );
                  })}
                  <button type="button" aria-label={C.react} onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)} className="flex min-h-8 items-center rounded-full px-2 text-xs text-ink-2 hover:bg-mist">☺+</button>
                  {m.author_id === userId && !editing && <button type="button" onClick={() => setEditing({ id: m.id, body: m.body })} className="min-h-8 px-1 text-xs text-ink-2 underline">{C.edit}</button>}
                  {(m.author_id === userId || isAdmin) && <button type="button" onClick={() => act(() => deleteChatMessage(m.id))} className="min-h-8 px-1 text-xs text-ink-2 underline">{C.delete}</button>}
                </div>
                {pickerFor === m.id && <div className="absolute z-20 mt-1 w-[260px] max-w-full"><Picker label={C.emoji} onPick={(c) => react(m.id, c)} /></div>}
              </div>
            </Fragment>
          );
        })}
        <div ref={end} />
      </div>

      <div className="sticky bottom-0 bg-canvas pt-2 pb-4">
        {error && <p role="alert" className="m-0 mb-2 text-sm font-semibold text-red-ink">{error}</p>}
        {options.length > 0 && (
          <div role="listbox" aria-label={C.mention} className="mb-1 flex flex-col rounded-lg border border-line-strong bg-paper">
            {options.map((p) => <button key={p.id} type="button" role="option" aria-selected={false} onClick={() => choose(p)} className="min-h-11 px-3 text-left text-sm hover:bg-mist">{p.full_name}</button>)}
          </div>
        )}
        {pickerFor === "composer" && <div className="mb-1 w-[260px] max-w-full"><Picker label={C.emoji} onPick={addEmoji} /></div>}
        {files.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <button key={f.name + i} type="button" onClick={() => setFiles(files.filter((_, n) => n !== i))} aria-label={`${C.removeFile}: ${f.name}`}
                className="flex min-h-9 max-w-full items-center gap-1 rounded-sm border border-line bg-paper px-2 text-xs"><span className="break-all">{f.name}</span> ×</button>
            ))}
          </div>
        )}
        <form data-chat onSubmit={(e) => { e.preventDefault(); send(); }} className="flex min-w-0 items-end gap-1 rounded-2xl border border-line-strong bg-paper p-1.5 focus-within:border-ink">
          <input ref={pick} type="file" multiple hidden aria-label={C.attach} onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
          <button type="button" aria-label={C.attach} onClick={() => pick.current?.click()} className="flex h-11 w-9 shrink-0 items-center justify-center text-lg text-ink-2 hover:text-ink">📎</button>
          <button type="button" aria-label={C.emoji} aria-expanded={pickerFor === "composer"} onClick={() => setPickerFor(pickerFor === "composer" ? null : "composer")} className="flex h-11 w-9 shrink-0 items-center justify-center text-lg text-ink-2 hover:text-ink">☺</button>
          <label htmlFor="chat-text" className="sr-only">{C.message}</label>
          <textarea id="chat-text" ref={box} rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
            placeholder={C.message} className="max-h-40 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm text-ink outline-none" />
          <button type="submit" aria-label={C.send} disabled={pending || (!draft.trim() && !files.length)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-lg text-white disabled:opacity-40">↑</button>
        </form>
      </div>
    </div>
  );
}
