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

const POLL_MS = 3000;
/** Nutrikal's own emoji first: public/emoji/<code>.svg, written :code: in a message. */
const BRAND = ["capsule", "jar", "leaf", "flask", "coa", "pallet", "mg", "nutrikal"];
const EMOJI = ["👍", "❤️", "😂", "🎉", "🔥", "🙏", "👀", "✅", "🚀", "💪", "😅", "🤔"];
const QUICK = ["👍", "❤️", "capsule", "🎉"];
const IMAGE = /^image\/(png|jpeg|webp|gif)$/;
const AVATARS = ["#222831", "#4a5160", "#3b6fd8", "#8a5cd6", "#c2610f", "#1a8078"];
/** Messages of one person this close together are shown as one group. */
const GROUP_MS = 5 * 60 * 1000;

const Emoji = ({ code }: { code: string }) =>
  BRAND.includes(code)
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={`/emoji/${code}.svg`} alt={`:${code}:`} title={code} className="inline-block h-[1.35em] w-[1.35em] align-text-bottom" />
    : <>{code}</>;

/** A round avatar with the initials; the colour stays the same for a person. */
export function Avatar({ name, id, size = 32 }: { name: string; id: string; size?: number }) {
  const colour = AVATARS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length];
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <span aria-hidden="true" style={{ background: colour, width: size, height: size, fontSize: size * 0.38 }}
      className="grid shrink-0 place-items-center rounded-full font-semibold text-[#fff]">{letters}</span>
  );
}

/** Links, Nutrikal emoji and mentions in a message. Nothing else in the text is treated as markup. */
function Body({ text, names, own }: { text: string; names: string[]; own: boolean }) {
  const mention = names.length ? `|@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})` : "";
  const parts = text.split(new RegExp(`(https?://[^\\s]+|:(?:${BRAND.join("|")}):${mention})`, "g"));
  return (
    <>
      {parts.map((p, i): ReactNode => {
        if (i % 2 === 0) return <Fragment key={i}>{p}</Fragment>;
        if (p.startsWith("http")) return <a key={i} href={p} target="_blank" rel="noopener noreferrer" className={`break-all underline ${own ? "text-[#fff]" : "text-ink"}`}>{p}</a>;
        if (p.startsWith("@")) return <span key={i} className={`rounded-sm px-1 font-semibold ${own ? "bg-[#ffffff33]" : "bg-green-tint text-green-ink"}`}>{p}</span>;
        return <Emoji key={i} code={p.slice(1, -1)} />;
      })}
    </>
  );
}

function Picker({ onPick, label }: { onPick: (code: string) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="grid w-[244px] grid-cols-5 gap-0.5 rounded-xl border border-line bg-paper p-2 shadow-xl">
      {[...BRAND, ...EMOJI].map((e) => (
        <button key={e} type="button" onClick={() => onPick(e)} aria-label={e} className="grid h-11 w-11 place-items-center rounded-lg text-xl transition-transform hover:scale-110 hover:bg-mist">
          <Emoji code={e} />
        </button>
      ))}
    </div>
  );
}

/** One channel, in a page or in the side panel: it fills the height it gets. Enter sends, Shift+Enter starts a new line, @ mentions a person. */
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
  const [behind, setBehind] = useState(false);
  const [pending, start] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const atEnd = useRef(true);
  const first = useRef(new Set(initial.map((m) => m.id)));
  const names = [me, ...people.map((p) => p.full_name)];

  const query = draft.match(/(?:^|\s)@([^\s@]*)$/)?.[1];
  const options = query === undefined ? [] : people.filter((p) => p.full_name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const refresh = async () => setMessages(await pollChat(channel, messages.at(-1)?.id ?? null));
  const toEnd = (behaviour: ScrollBehavior = "smooth") => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: behaviour });
    setBehind(false);
  };

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden && !pending) refresh().catch(() => {}); }, POLL_MS);
    return () => clearInterval(t);
  });
  useEffect(() => { toEnd("auto"); box.current?.focus(); }, []);
  // New messages: follow them, unless the person has scrolled up to read
  useEffect(() => {
    if (atEnd.current) toEnd(); else setBehind(true);
  }, [messages.length]);
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
    atEnd.current = true;
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
    <div className="relative flex h-full min-h-0 min-w-0 flex-col">
      {warning && <p className="m-0 mx-3 mb-2 rounded-lg bg-amber-tint px-3 py-2 text-xs font-semibold text-amber-ink">{warning}</p>}
      <div ref={scroller} onScroll={(e) => {
        const el = e.currentTarget;
        atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        if (atEnd.current) setBehind(false);
      }} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-3 py-2">
        {messages.length === 0 && <p className="my-auto text-center text-sm text-ink-2">{C.empty}</p>}
        {messages.map((m, i) => {
          const before = messages[i - 1];
          const day = m.created_at.slice(0, 10);
          const newDay = day !== before?.created_at.slice(0, 10);
          const grouped = !newDay && before?.author_id === m.author_id && Date.parse(m.created_at) - Date.parse(before.created_at) < GROUP_MS;
          const own = m.author_id === userId;
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-neutral-tint px-3 py-1 text-[11px] font-semibold text-ink-2">{formatDate(locale, day, { day: "numeric", month: "long" })}</span>
                </div>
              )}
              <div className={`group relative flex min-w-0 gap-2 ${own ? "flex-row-reverse" : ""} ${grouped ? "" : "mt-3"} ${first.current.has(m.id) ? "" : "chat-in"}`}>
                {!own && (grouped ? <span className="w-8 shrink-0" /> : <Avatar name={m.author} id={m.author_id} />)}
                <div className={`flex max-w-[82%] min-w-0 flex-col ${own ? "items-end" : "items-start"}`}>
                  {!grouped && !own && <span className="mb-0.5 text-xs font-semibold">{m.author}</span>}
                  {editing?.id === m.id ? (
                    <form data-chat className="flex w-full min-w-[220px] flex-col gap-2" onSubmit={(e) => { e.preventDefault(); const x = editing; setEditing(null); act(() => editChatMessage(x.id, x.body)); }}>
                      <textarea aria-label={C.edit} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} className="input" />
                      <div className="flex gap-2">
                        <button type="submit" className="btn btn-primary">{C.save}</button>
                        <button type="button" onClick={() => setEditing(null)} className="btn btn-outline">{C.cancel}</button>
                      </div>
                    </form>
                  ) : m.body !== "📎" && (
                    <div className={`min-w-0 rounded-2xl px-3 py-1.5 text-sm ${own ? "rounded-br-md bg-ink text-[#fff]" : "rounded-bl-md bg-neutral-tint text-ink"}`}>
                      <p className="m-0 whitespace-pre-line break-words"><Body text={m.body} names={names} own={own} /></p>
                    </div>
                  )}
                  {m.attachments.length > 0 && (
                    <div className={`mt-1 flex flex-wrap gap-2 ${own ? "justify-end" : ""}`}>
                      {m.attachments.map((a) => (IMAGE.test(a.mime ?? "")
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <a key={a.id} href={`/files/chat/${a.id}`} target="_blank" rel="noopener noreferrer"><img src={`/files/chat/${a.id}`} alt={a.name} className="max-h-56 max-w-full rounded-xl border border-line" /></a>
                        : <a key={a.id} href={`/files/chat/${a.id}?download=1`} className="flex min-h-11 max-w-full items-center gap-2 rounded-xl border border-line bg-paper px-3 text-xs font-semibold text-ink no-underline"><span aria-hidden="true">📎</span><span className="break-all">{a.name}</span></a>))}
                    </div>
                  )}
                  {m.reactions.length > 0 && (
                    <div className={`-mt-1 flex flex-wrap gap-1 ${own ? "justify-end" : ""}`}>
                      {m.reactions.map((r) => {
                        const code = r.emoji.replace(/^:|:$/g, "");
                        return (
                          <button key={r.emoji} type="button" aria-pressed={r.mine} onClick={() => react(m.id, code)}
                            className={`flex min-h-7 items-center gap-1 rounded-full border px-1.5 text-xs shadow-sm transition-transform hover:scale-105 ${r.mine ? "border-ink bg-paper" : "border-line bg-paper"}`}>
                            <Emoji code={code} /> {r.n}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <span className="mt-0.5 px-1 text-[10px] text-ink-2">{m.created_at.slice(11, 16)}{m.edited_at ? ` · ${C.edited}` : ""}</span>
                </div>
                {/* Appears when pointing at a message; always there on touch screens */}
                <div className="flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-60">
                  {QUICK.map((q) => (
                    <button key={q} type="button" aria-label={q} onClick={() => react(m.id, q)} className="hide-sm grid h-7 w-7 place-items-center rounded-full text-sm transition-transform hover:scale-125 hover:bg-mist"><Emoji code={q} /></button>
                  ))}
                  <button type="button" aria-label={C.react} onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)} className="grid h-7 w-7 place-items-center rounded-full text-sm text-ink-2 hover:bg-mist">☺</button>
                  {own && !editing && <button type="button" aria-label={C.edit} title={C.edit} onClick={() => setEditing({ id: m.id, body: m.body })} className="grid h-7 w-7 place-items-center rounded-full text-sm text-ink-2 hover:bg-mist">✎</button>}
                  {(own || isAdmin) && <button type="button" aria-label={C.delete} title={C.delete} onClick={() => act(() => deleteChatMessage(m.id))} className="grid h-7 w-7 place-items-center rounded-full text-sm text-ink-2 hover:bg-mist">×</button>}
                </div>
                {pickerFor === m.id && <div className={`absolute top-full z-20 ${own ? "right-0" : "left-10"}`}><Picker label={C.emoji} onPick={(c) => react(m.id, c)} /></div>}
              </div>
            </Fragment>
          );
        })}
      </div>

      {behind && (
        <button type="button" onClick={() => toEnd()} className="chat-in absolute bottom-24 left-1/2 z-10 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-[#fff] shadow-lg">↓ {C.newMessages}</button>
      )}

      <div className="relative px-3 pt-1 pb-3">
        {error && <p role="alert" className="m-0 mb-2 text-sm font-semibold text-red-ink">{error}</p>}
        {options.length > 0 && (
          <div role="listbox" aria-label={C.mention} className="absolute right-3 bottom-full left-3 z-20 mb-1 flex flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-xl">
            {options.map((p) => (
              <button key={p.id} type="button" role="option" aria-selected={false} onClick={() => choose(p)} className="flex min-h-11 items-center gap-2 px-3 text-left text-sm hover:bg-mist">
                <Avatar name={p.full_name} id={p.id} size={24} /> {p.full_name}
              </button>
            ))}
          </div>
        )}
        {pickerFor === "composer" && <div className="absolute bottom-full left-3 z-20 mb-1"><Picker label={C.emoji} onPick={addEmoji} /></div>}
        {files.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <button key={f.name + i} type="button" onClick={() => setFiles(files.filter((_, n) => n !== i))} aria-label={`${C.removeFile}: ${f.name}`}
                className="flex min-h-9 max-w-full items-center gap-1 rounded-lg border border-line bg-paper px-2 text-xs"><span className="break-all">{f.name}</span> ×</button>
            ))}
          </div>
        )}
        <form data-chat onSubmit={(e) => { e.preventDefault(); send(); }} className="flex min-w-0 items-end gap-0.5 rounded-3xl border border-line-strong bg-paper p-1 transition-shadow focus-within:border-ink focus-within:shadow-md">
          <input ref={pick} type="file" multiple hidden aria-label={C.attach} onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
          <button type="button" aria-label={C.attach} onClick={() => pick.current?.click()} className="grid h-11 w-9 shrink-0 place-items-center text-lg text-ink-2 hover:text-ink">📎</button>
          <button type="button" aria-label={C.emoji} aria-expanded={pickerFor === "composer"} onClick={() => setPickerFor(pickerFor === "composer" ? null : "composer")} className="grid h-11 w-9 shrink-0 place-items-center text-lg text-ink-2 hover:text-ink">☺</button>
          <label htmlFor={`chat-text-${channel}`} className="sr-only">{C.message}</label>
          <textarea id={`chat-text-${channel}`} data-chat-input ref={box} rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
            placeholder={C.message} className="max-h-40 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm text-ink outline-none" />
          <button type="submit" aria-label={C.send} disabled={pending || (!draft.trim() && !files.length)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-lg text-[#fff] transition-transform hover:scale-105 disabled:opacity-30">↑</button>
        </form>
      </div>
    </div>
  );
}
