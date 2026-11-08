"use client";

import { Fragment, useEffect, useRef, useState, useTransition, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { deleteChatMessage, editChatMessage, markChatRead, pinChatMessage, pollChat, pollThread, saveChatMessage, searchGifs, sendChat, setChatNotify, toggleReaction, type Gif } from "@/app/chat-actions";
import { useLive, type Topic } from "@/components/live";
import { Huddle } from "@/components/huddle";
import { fmt, formatDate, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { UserAvatar } from "@/components/user-avatar";

export type ChatAttachment = { id: string; name: string; mime: string | null; size: number };
export type ChatReaction = { emoji: string; n: number; mine: boolean };
export type ChatMessage = {
  id: string; author_id: string; author: string; body: string; created_at: string; edited_at: string | null;
  attachments: ChatAttachment[]; reactions: ChatReaction[];
  parent_id: string | null; reply_count: number; last_reply_at: string | null; repliers: string[] | null; pinned_at: string | null; saved?: boolean;
};
export type ChatPerson = { id: string; full_name: string };

const POLL_MS = 3000;
/** With the live connection the messages come at once; a slow poll stays as a safety net. */
const LIVE_POLL_MS = 30000;
/** Typing is told at most every few seconds, and shown a little longer. */
const TYPING_SEND_MS = 2500;
const TYPING_SHOW_MS = 5000;
/** Nutrikal's own emoji first: public/emoji/<code>.svg, written :code: in a message. */
const BRAND = ["capsule", "jar", "leaf", "flask", "coa", "pallet", "mg", "nutrikal"];
const EMOJI = ["👍", "❤️", "😂", "🎉", "🔥", "🙏", "👀", "✅", "🚀", "💪", "😅", "🤔"];
const QUICK = ["✅", "👀", "👍"];
const IMAGE = /^image\/(png|jpeg|webp|gif)$/;
const AVATARS = ["#222831", "#4a5160", "#3b6fd8", "#8a5cd6", "#c2610f", "#1a8078"];
/** Messages of one person this close together are shown as one group. */
const GROUP_MS = 5 * 60 * 1000;
/** A message that is only a GIPHY picture is shown as the picture (sent from the GIF panel). */
const GIF = /^https:\/\/(?:media\d?\.giphy\.com\/media|i\.giphy\.com)\/[\w./=%-]+\.(?:gif|webp)(?:\?[\w=&.%-]*)?$/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const time = (iso: string) => iso.slice(11, 16);

/** GIF search: trending until something is typed; a click sends the GIF. GIPHY asks to be named. */
function GifPanel({ onPick, onClose, text }: { onPick: (g: Gif) => void; onClose: () => void; text: Dict["chat"] }) {
  const [term, setTerm] = useState("");
  const [gifs, setGifs] = useState<Gif[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => { searchGifs(term).then((g) => { if (live) setGifs(g); }).catch(() => { if (live) setGifs([]); }); }, term ? 350 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [term]);
  return (
    <div role="dialog" aria-label={text.gif} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      className="flex max-h-[360px] w-full flex-col gap-2 rounded-xl border border-line bg-paper p-2 shadow-xl">
      <div className="flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{text.gifSearch}</span>
          <input ref={input} type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={text.gifSearch} className="input min-h-11 w-full" />
        </label>
        <button type="button" onClick={onClose} aria-label={text.close} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-lg text-ink-2 hover:bg-mist">×</button>
      </div>
      <div className="grid min-h-0 grid-cols-3 gap-1 overflow-x-hidden overflow-y-auto">
        {gifs === null && <p className="col-span-3 m-0 py-6 text-center text-sm text-ink-2">…</p>}
        {gifs?.length === 0 && <p className="col-span-3 m-0 py-6 text-center text-sm text-ink-2">{text.gifNone}</p>}
        {gifs?.map((g) => (
          <button key={g.id} type="button" onClick={() => onPick(g)} aria-label={g.title || text.gif}
            className="overflow-hidden rounded-lg bg-mist p-0 hover:opacity-80 focus-visible:outline-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={g.preview} alt="" loading="lazy" className="block aspect-square h-full w-full object-cover" />
          </button>
        ))}
      </div>
      <p className="m-0 text-right text-[10px] font-semibold tracking-[1px] text-ink-2 uppercase">{text.gifPowered}</p>
    </div>
  );
}

const Emoji = ({ code }: { code: string }) =>
  BRAND.includes(code)
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={`/emoji/${code}.svg`} alt={`:${code}:`} title={code} className="inline-block h-[1.35em] w-[1.35em] align-text-bottom" />
    : <>{code}</>;

/** A round avatar with the initials; the colour stays the same for a person. */
export function Avatar({ name, id, size = 32, photo = true }: { name: string; id: string; size?: number; photo?: boolean }) {
  // A person: their photo (or initials) from /api/avatar; otherwise the initials of the name here
  if (photo) return <UserAvatar id={id} size={size} />;
  const colour = AVATARS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length];
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <span aria-hidden="true" style={{ background: colour, width: size, height: size, fontSize: size * 0.38 }}
      className="grid shrink-0 place-items-center rounded-full font-semibold text-[#fff]">{letters}</span>
  );
}

// ------------------------------------------------------------------ formatting, as in Slack
// *bold* _italic_ ~strike~ `code` ```block``` > quote, - list, 1. list, [text](link), links, :emoji:, @mentions.
function Inline({ text, names }: { text: string; names: string[] }): ReactNode {
  const mention = names.length ? `|@(?:${names.map(esc).join("|")})` : "";
  const re = new RegExp(
    "(`[^`\\n]+`" +
    "|\\[[^\\]\\n]+\\]\\(https?://[^\\s)]+\\)" +
    "|https?://[^\\s<]+[^\\s<.,:;!?)\\]'\"]" +
    "|(?<![\\w*])\\*(?=\\S)[^*\\n]*?\\S\\*(?![\\w*])|(?<![\\w*])\\*\\S\\*(?![\\w*])" +
    "|(?<![\\w_])_(?=\\S)[^_\\n]*?\\S_(?![\\w_])|(?<![\\w_])_\\S_(?![\\w_])" +
    "|(?<![\\w~])~(?=\\S)[^~\\n]*?\\S~(?![\\w~])" +
    `|:(?:${BRAND.join("|")}):${mention})`, "g");
  const parts = text.split(re);
  return parts.map((p, i): ReactNode => {
    if (i % 2 === 0 || !p) return <Fragment key={i}>{p}</Fragment>;
    if (p.startsWith("`")) return <code key={i} className="rounded border border-line bg-neutral-tint px-1 py-px font-mono text-[12.5px] text-red-ink">{p.slice(1, -1)}</code>;
    const link = p.match(/^\[([^\]]+)\]\((.+)\)$/);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="break-words text-[#1264a3] hover:underline">{link[1]}</a>;
    if (p.startsWith("http")) return <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="break-all text-[#1264a3] hover:underline">{p}</a>;
    if (p.startsWith("*")) return <strong key={i}><Inline text={p.slice(1, -1)} names={names} /></strong>;
    if (p.startsWith("_")) return <em key={i}><Inline text={p.slice(1, -1)} names={names} /></em>;
    if (p.startsWith("~")) return <s key={i}><Inline text={p.slice(1, -1)} names={names} /></s>;
    if (p.startsWith("@")) return <span key={i} className="rounded-sm bg-[#e8f5fa] px-0.5 font-semibold text-[#1264a3]">{p}</span>;
    return <Emoji key={i} code={p.slice(1, -1)} />;
  });
}

function Rich({ text, names }: { text: string; names: string[] }) {
  const out: ReactNode[] = [];
  text.split(/```\n?([\s\S]*?)\n?```/g).forEach((seg, s) => {
    if (s % 2 === 1) {
      out.push(<pre key={`c${s}`} className="m-0 my-1 overflow-x-hidden rounded-md border border-line bg-neutral-tint p-2 font-mono text-[12.5px] whitespace-pre-wrap break-words">{seg}</pre>);
      return;
    }
    const lines = seg.replace(/^\n|\n$/g, "").split("\n");
    if (s > 0 && lines.length === 1 && !lines[0]) return;
    let i = 0;
    while (i < lines.length) {
      const k = `${s}-${i}`;
      const take = (re: RegExp) => { const got: string[] = []; while (i < lines.length && re.test(lines[i])) got.push(lines[i++].replace(re, "")); return got; };
      if (/^>\s?/.test(lines[i])) {
        const q = take(/^>\s?/);
        out.push(<blockquote key={k} className="m-0 my-0.5 border-l-4 border-line-strong pl-3 text-ink-2">{q.map((l, j) => <div key={j}><Inline text={l} names={names} />{!l && <br />}</div>)}</blockquote>);
      } else if (/^\s*[-•*]\s+/.test(lines[i])) {
        const items = take(/^\s*[-•*]\s+/);
        out.push(<ul key={k} className="m-0 my-0.5 list-disc pl-6">{items.map((l, j) => <li key={j}><Inline text={l} names={names} /></li>)}</ul>);
      } else if (/^\s*\d+[.)]\s+/.test(lines[i])) {
        const items = take(/^\s*\d+[.)]\s+/);
        out.push(<ol key={k} className="m-0 my-0.5 list-decimal pl-6">{items.map((l, j) => <li key={j}><Inline text={l} names={names} /></li>)}</ol>);
      } else {
        const l = lines[i++];
        out.push(<div key={k} className="min-h-[1.4em]"><Inline text={l} names={names} /></div>);
      }
    }
  });
  return <div className="break-words">{out}</div>;
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

const ICONS = {
  reply: "M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5.4A8 8 0 1 1 21 12z",
  react: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01",
  pin: "M9 4h6l-1 6 4 4H6l4-4zM12 14v7",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  save: "M6 4h12v17l-6-4-6 4z",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
};
function Ico({ d, size = 18 }: { d: string; size?: number }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

// ------------------------------------------------------------------ the composer
type Draft = { body: string; files: File[]; mentions: ChatPerson[] };

function Composer({ id, placeholder, people, C, gifs, pending, onSend, onSendGif, onEditLast, autoFocus, onTyping, typing }: {
  id: string; placeholder: string; people: ChatPerson[]; C: Dict["chat"]; gifs: boolean; pending: boolean;
  onSend: (d: Draft) => Promise<boolean>; onSendGif: (g: Gif) => void; onEditLast?: () => void; autoFocus?: boolean;
  onTyping?: () => void;      // this person is typing: told to the others
  typing?: string | null;     // "Maria is typing…"
}) {
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [mentions, setMentions] = useState<ChatPerson[]>([]);
  const [panel, setPanel] = useState<"emoji" | "gif" | null>(null);
  const [active, setActive] = useState(0);
  // A phone: the formatting buttons come with Aa, as in Slack (owner, Nov 2026: fewer buttons on the phone)
  const [formatting, setFormatting] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const pick = useRef<HTMLInputElement>(null);

  const query = draft.match(/(?:^|\s)@([^\s@]*)$/)?.[1];
  const options = query === undefined ? [] : people.filter((p) => p.full_name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { if (autoFocus) box.current?.focus(); }, [autoFocus]);
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
  const send = async () => {
    const body = draft.trim();
    if ((!body && !files.length) || pending) return;
    const d = { body, files, mentions: mentions.filter((m) => body.includes(`@${m.full_name}`)) };
    setDraft(""); setFiles([]); setMentions([]);
    if (!(await onSend(d))) { setDraft(body); setFiles(d.files); }
  };
  /** Wraps the selected words in the marks (or puts the marks at the cursor). */
  const wrap = (open: string, close = open, line = false) => {
    const el = box.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = draft.slice(a, b);
    let next: string, cursor: number;
    if (line) {
      const start = draft.lastIndexOf("\n", a - 1) + 1;
      next = draft.slice(0, start) + open + draft.slice(start);
      cursor = b + open.length;
    } else {
      next = draft.slice(0, a) + open + sel + close + draft.slice(b);
      cursor = sel ? a + open.length + sel.length + close.length : a + open.length;
    }
    setDraft(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(cursor, cursor); });
  };
  const link = () => {
    const el = box.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const label = draft.slice(a, b) || C.linkText;
    const next = `${draft.slice(0, a)}[${label}](https://)${draft.slice(b)}`;
    setDraft(next);
    const at = a + label.length + 3 + 8;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(at, at); });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (options.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setActive((n) => (n + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
      return;
    }
    if ((e.key === "Enter" || e.key === "Tab") && options.length) { e.preventDefault(); choose(options[active] ?? options[0]); return; }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); return; }
    if (e.key === "ArrowUp" && !draft && onEditLast) { e.preventDefault(); onEditLast(); return; }
    if (e.key === "Escape" && panel) { setPanel(null); return; }
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === "b") { e.preventDefault(); wrap("*"); }
      else if (k === "i") { e.preventDefault(); wrap("_"); }
      else if (k === "x" && e.shiftKey) { e.preventDefault(); wrap("~"); }
      else if (k === "k" && e.shiftKey) { e.preventDefault(); link(); }
    }
  };
  const tool = "grid h-9 min-w-9 shrink-0 place-items-center rounded-md px-1 text-sm text-ink-2 hover:bg-mist hover:text-ink";

  return (
    <div className="@container/composer relative px-2 pt-1 pb-1 sm:px-4">
      {options.length > 0 && (
        <div role="listbox" aria-label={C.mention} className="absolute right-4 bottom-full left-4 z-20 mb-1 flex flex-col overflow-hidden rounded-xl border border-line bg-paper py-1 shadow-xl">
          {options.map((p, n) => (
            <button key={p.id} type="button" role="option" aria-selected={n === active} onMouseEnter={() => setActive(n)} onClick={() => choose(p)}
              className={`flex min-h-11 items-center gap-2 px-3 text-left text-sm ${n === active ? "bg-[#1264a3] text-white" : ""}`}>
              <Avatar name={p.full_name} id={p.id} size={24} /> {p.full_name}
            </button>
          ))}
        </div>
      )}
      {panel === "emoji" && <div className="absolute bottom-full left-4 z-20 mb-1"><Picker label={C.emoji} onPick={(code) => { setDraft((d) => `${d}${BRAND.includes(code) ? `:${code}:` : code}`); setPanel(null); box.current?.focus(); }} /></div>}
      {panel === "gif" && <div className="absolute right-4 bottom-full left-4 z-20 mb-1 sm:right-auto sm:w-[360px]"><GifPanel text={C} onPick={(g) => { setPanel(null); onSendGif(g); box.current?.focus(); }} onClose={() => { setPanel(null); box.current?.focus(); }} /></div>}
      <form data-chat onSubmit={(e) => { e.preventDefault(); send(); }}
        className="flex min-w-0 flex-col rounded-lg border border-line-strong bg-paper transition-shadow focus-within:border-ink-2 focus-within:shadow-sm">
        <div role="toolbar" aria-label={C.formatting} className={`${formatting ? "flex" : "hidden"} flex-wrap items-center gap-0.5 rounded-t-lg border-b border-mist bg-canvas px-1 py-0.5 @min-[520px]/composer:flex`}>
          <button type="button" className={`${tool} font-bold`} aria-label={C.bold} title={`${C.bold} (Ctrl+B)`} onClick={() => wrap("*")}>B</button>
          <button type="button" className={`${tool} italic`} aria-label={C.italic} title={`${C.italic} (Ctrl+I)`} onClick={() => wrap("_")}>I</button>
          <button type="button" className={`${tool} line-through`} aria-label={C.strike} title={`${C.strike} (Ctrl+Shift+X)`} onClick={() => wrap("~")}>S</button>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
          <button type="button" className={tool} aria-label={C.link} title={`${C.link} (Ctrl+Shift+K)`} onClick={link}>
            <Ico d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" size={16} />
          </button>
          <button type="button" className={tool} aria-label={C.list} title={C.list} onClick={() => wrap("- ", "", true)}>
            <Ico d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" size={16} />
          </button>
          <button type="button" className={tool} aria-label={C.quote} title={C.quote} onClick={() => wrap("> ", "", true)}>
            <Ico d="M5 6v12M9 8h10M9 12h10M9 16h6" size={16} />
          </button>
          <button type="button" className={`${tool} font-mono text-xs`} aria-label={C.code} title={C.code} onClick={() => (box.current && box.current.selectionStart !== box.current.selectionEnd && draft.slice(box.current.selectionStart, box.current.selectionEnd).includes("\n") ? wrap("```\n", "\n```") : wrap("`"))}>{"</>"}</button>
        </div>
        <label htmlFor={id} className="sr-only">{placeholder}</label>
        <textarea id={id} data-chat-input ref={box} rows={1} value={draft} onChange={(e) => { setDraft(e.target.value); if (e.target.value.trim()) onTyping?.(); }} onKeyDown={onKey}
          placeholder={placeholder} className="max-h-48 min-h-11 min-w-0 resize-none border-0 bg-transparent px-3 py-2.5 text-[15px] text-ink outline-none" />
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pb-2">
            {files.map((f, i) => (
              <button key={f.name + i} type="button" onClick={() => setFiles(files.filter((_, n) => n !== i))} aria-label={`${C.removeFile}: ${f.name}`}
                className="flex min-h-9 max-w-full items-center gap-1 rounded-lg border border-line bg-canvas px-2 text-xs"><span aria-hidden="true">📎</span><span className="break-all">{f.name}</span> ×</button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-0.5 px-1 pb-1">
          <input ref={pick} type="file" multiple hidden aria-label={C.attach} onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
          <button type="button" aria-label={C.attach} title={C.attach} onClick={() => pick.current?.click()} className={`${tool} text-lg`}>+</button>
          <button type="button" aria-label={C.emoji} aria-expanded={panel === "emoji"} onClick={() => setPanel(panel === "emoji" ? null : "emoji")} className={tool}><Ico d={ICONS.react} /></button>
          <button type="button" aria-label={C.formatting} title={C.formatting} aria-pressed={formatting} onClick={() => setFormatting((f) => !f)}
            className={`${tool} text-[13px] font-semibold underline decoration-1 underline-offset-2 @min-[520px]/composer:hidden ${formatting ? "bg-mist text-ink" : ""}`}>Aa</button>
          <button type="button" aria-label={C.mention} title={C.mention} onClick={() => { setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}@`); box.current?.focus(); }} className={`${tool} font-semibold`}>@</button>
          {gifs && (
            <button type="button" aria-label={C.gif} aria-expanded={panel === "gif"} onClick={() => setPanel(panel === "gif" ? null : "gif")} className={`${tool} text-[10px] font-bold`}>
              <span className="rounded border border-current px-1 leading-4">GIF</span>
            </button>
          )}
          <span className="ml-auto hidden pr-2 text-[11px] text-ink-2 @min-[520px]/composer:inline">{C.enterHint}</span>
          <button type="submit" aria-label={C.send} disabled={pending || (!draft.trim() && !files.length)}
            className="ml-auto grid h-9 w-11 shrink-0 place-items-center rounded-md bg-[#007a5a] text-white transition-colors hover:bg-[#148567] disabled:bg-transparent disabled:text-ink-2 disabled:opacity-60 @min-[520px]/composer:ml-0">
            <Ico d="M4 12l16-8-6 16-2-7z" size={16} />
          </button>
        </div>
      </form>
      <p aria-live="polite" className="m-0 h-4 truncate px-1 pt-0.5 text-[11px] text-ink-2">{typing ?? ""}</p>
    </div>
  );
}

// ------------------------------------------------------------------ one message
function Message({ m, grouped, names, own, isAdmin, C, locale, inThread, editing, onEdit, onSaveEdit, onReact, onDelete, onPin, onSave, onThread, fresh }: {
  m: ChatMessage; grouped: boolean; names: string[]; own: boolean; isAdmin: boolean; C: Dict["chat"]; locale: Locale; inThread: boolean;
  editing: boolean; onEdit: (on: boolean) => void; onSaveEdit: (body: string) => void; onReact: (code: string) => void; onDelete: () => void;
  onPin: () => void; onSave: () => void; onThread: () => void; fresh: boolean;
}) {
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [text, setText] = useState(m.body);
  const edit = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) return;
    setText(m.body);
    requestAnimationFrame(() => { const el = edit.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  }, [editing, m.body]);
  const btn = "grid h-8 w-8 place-items-center rounded-md text-ink-2 hover:bg-mist hover:text-ink";

  return (
    <div id={inThread ? undefined : `m-${m.id}`} className={`group relative flex min-w-0 gap-2 px-4 hover:bg-canvas ${grouped ? "py-0.5" : "pt-2 pb-0.5"} ${m.pinned_at && !inThread ? "bg-[#fef9ec] hover:bg-[#fdf3d7]" : ""} ${fresh ? "chat-in" : ""} ${editing ? "bg-[#fef9ec]" : ""}`}>
      <div className="w-9 shrink-0">
        {grouped
          ? <span className="block pt-1 text-right text-[10px] text-ink-2 opacity-0 group-hover:opacity-100">{time(m.created_at)}</span>
          : <span className="block overflow-hidden rounded-md"><Avatar name={m.author} id={m.author_id} size={36} /></span>}
      </div>
      <div className="min-w-0 flex-1">
        {(m.pinned_at && !inThread || m.saved) && (
          <div className="mb-0.5 flex flex-wrap items-center gap-x-3 text-[11px] font-semibold">
            {m.pinned_at && !inThread && <span className="flex items-center gap-1 text-[#b07b00]"><Ico d={ICONS.pin} size={12} />{C.pinned}</span>}
            {m.saved && <span className="flex items-center gap-1 text-[#e01e5a]"><Ico d={ICONS.save} size={12} />{C.savedLabel}</span>}
          </div>
        )}
        {!grouped && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[15px] font-bold text-ink">{m.author}</span>
            <time dateTime={m.created_at} className="text-xs text-ink-2">{time(m.created_at)}</time>
          </div>
        )}
        {editing ? (
          <form data-chat className="mt-1 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); onSaveEdit(text); }}>
            <textarea ref={edit} aria-label={C.edit} value={text} onChange={(e) => setText(e.target.value)} rows={2}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); onEdit(false); }
                else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSaveEdit(text); }
              }}
              className="input min-h-16 text-[15px]" />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => onEdit(false)} className="btn btn-outline">{C.cancel}</button>
              <button type="submit" className="btn btn-primary">{C.save}</button>
              <span className="text-[11px] text-ink-2">{C.editHint}</span>
            </div>
          </form>
        ) : GIF.test(m.body) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.body} alt={C.gif} loading="lazy" className="mt-1 max-h-56 max-w-full rounded-md" />
        ) : m.body !== "📎" && (
          <div className="text-[15px] leading-[1.45] text-ink">
            <Rich text={m.body} names={names} />
            {m.edited_at && <span className="text-[11px] text-ink-2"> ({C.edited})</span>}
          </div>
        )}
        {m.attachments.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2">
            {m.attachments.map((a) => (IMAGE.test(a.mime ?? "")
              // eslint-disable-next-line @next/next/no-img-element
              ? <a key={a.id} href={`/files/chat/${a.id}`} target="_blank" rel="noopener noreferrer"><img src={`/files/chat/${a.id}`} alt={a.name} className="max-h-60 max-w-full rounded-md border border-line" /></a>
              : <a key={a.id} href={`/files/chat/${a.id}?download=1`} className="flex min-h-12 max-w-full items-center gap-2 rounded-lg border border-line bg-paper px-3 text-sm font-semibold text-ink no-underline hover:bg-canvas">
                  <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#1264a3] text-xs text-white">📄</span><span className="break-all">{a.name}</span>
                </a>))}
          </div>
        )}
        {m.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.reactions.map((r) => {
              const code = r.emoji.replace(/^:|:$/g, "");
              return (
                <button key={r.emoji} type="button" aria-pressed={r.mine} onClick={() => onReact(code)}
                  className={`flex min-h-7 items-center gap-1 rounded-full border px-2 text-xs ${r.mine ? "border-[#1264a3] bg-[#e8f5fa] text-[#1264a3]" : "border-line bg-paper hover:border-ink-2"}`}>
                  <Emoji code={code} /> <span className="font-semibold tabular-nums">{r.n}</span>
                </button>
              );
            })}
            <button type="button" aria-label={C.react} onClick={() => setPicker(!picker)} className="grid min-h-7 w-9 place-items-center rounded-full border border-line bg-paper text-ink-2 opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"><Ico d={ICONS.react} size={14} /></button>
          </div>
        )}
        {!inThread && m.reply_count > 0 && (
          <button type="button" onClick={onThread} className="mt-1 -ml-1 flex min-h-9 max-w-full items-center gap-2 rounded-md border border-transparent px-1 text-left hover:border-line hover:bg-paper">
            <span className="flex shrink-0 -space-x-1">{(m.repliers ?? []).map((id) => <span key={id} className="overflow-hidden rounded-md ring-2 ring-paper"><UserAvatar id={id} size={22} /></span>)}</span>
            <span className="text-[13px] font-bold text-[#1264a3]">{m.reply_count === 1 ? C.oneReply : fmt(C.replies, { n: m.reply_count })}</span>
            {m.last_reply_at && <span className="hide-sm truncate text-xs text-ink-2">{fmt(C.lastReply, { at: `${formatDate(locale, m.last_reply_at.slice(0, 10))} ${time(m.last_reply_at)}` })}</span>}
          </button>
        )}
      </div>

      {/* The actions appear when pointing at a message (as in Slack); always there, smaller, on touch screens */}
      {/* Touch screens: the actions open from ⋯ */}
      {!editing && (
        <button type="button" aria-label={C.actions} aria-expanded={menu} onClick={() => setMenu(!menu)}
          className="absolute top-1 right-2 hidden h-9 w-9 place-items-center rounded-md text-lg text-ink-2 [@media(hover:none)]:grid">⋯</button>
      )}
      {!editing && (
        <div onClick={() => setMenu(false)} className={`absolute -top-3.5 right-4 z-10 flex items-center gap-0.5 rounded-lg border border-line bg-paper p-0.5 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:right-12 ${menu ? "opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto focus-within:pointer-events-auto [@media(hover:none)]:invisible"}`}>
          {QUICK.map((q) => (
            <button key={q} type="button" aria-label={q} onClick={() => onReact(q)} className={`${btn} hide-sm text-base`}><Emoji code={q} /></button>
          ))}
          <button type="button" aria-label={C.react} title={C.react} onClick={() => setPicker(!picker)} className={btn}><Ico d={ICONS.react} /></button>
          {!inThread && <button type="button" aria-label={C.reply} title={C.reply} onClick={onThread} className={btn}><Ico d={ICONS.reply} /></button>}
          {!inThread && <button type="button" aria-label={m.pinned_at ? C.unpin : C.pin} title={m.pinned_at ? C.unpin : C.pin} aria-pressed={!!m.pinned_at} onClick={onPin} className={`${btn} ${m.pinned_at ? "text-[#b07b00]" : ""}`}><Ico d={ICONS.pin} /></button>}
          <button type="button" aria-label={m.saved ? C.unsave : C.saveLater} title={m.saved ? C.unsave : C.saveLater} aria-pressed={!!m.saved} onClick={onSave} className={`${btn} ${m.saved ? "text-[#e01e5a]" : ""}`}><Ico d={ICONS.save} /></button>
          {own && !GIF.test(m.body) && <button type="button" aria-label={C.edit} title={C.edit} onClick={() => onEdit(true)} className={btn}><Ico d={ICONS.edit} /></button>}
          {(own || isAdmin) && <button type="button" aria-label={C.delete} title={C.delete} onClick={() => { if (window.confirm(C.deleteConfirm)) onDelete(); }} className={`${btn} hover:text-red-ink`}><Ico d={ICONS.trash} /></button>}
        </div>
      )}
      {picker && <div className="absolute top-full right-4 z-20"><Picker label={C.emoji} onPick={(c) => { setPicker(false); onReact(c); }} /></div>}
    </div>
  );
}

// ------------------------------------------------------------------ a list of messages with day lines and the "New" line
function Feed({ messages, userId, names, isAdmin, C, locale, inThread, lastRead, editingId, setEditing, act, onThread, empty, scroller, onScroll, firstIds, head }: {
  messages: ChatMessage[]; userId: string; names: string[]; isAdmin: boolean; C: Dict["chat"]; locale: Locale; inThread: boolean;
  lastRead: string | null; editingId: string | null; setEditing: (id: string | null) => void; act: (fn: () => Promise<unknown>) => void;
  onThread: (m: ChatMessage) => void; empty: ReactNode; scroller: RefObject<HTMLDivElement | null>; onScroll: () => void; firstIds: Set<string>; head?: ReactNode;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  // The "New" line: before the first message of someone else written after the channel was last read
  const firstNew = lastRead ? messages.find((m) => m.author_id !== userId && m.created_at > lastRead)?.id : undefined;
  return (
    <div ref={scroller} onScroll={onScroll} className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain pt-3 pb-2">
      {head}
      {messages.length === 0 && <div className="my-auto px-4 text-center text-sm text-ink-2">{empty}</div>}
      {messages.map((m, i) => {
        const before = messages[i - 1];
        const day = m.created_at.slice(0, 10);
        const newDay = !inThread && day !== before?.created_at.slice(0, 10);
        const isNew = m.id === firstNew;
        const grouped = !newDay && !isNew && !(inThread && i === 1) && before?.author_id === m.author_id && Date.parse(m.created_at) - Date.parse(before.created_at) < GROUP_MS && !m.pinned_at;
        return (
          <Fragment key={m.id}>
            {newDay && (
              <div className="relative my-3 flex justify-center" role="separator">
                <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-line" />
                <span className="relative rounded-full border border-line bg-paper px-3 py-1 text-xs font-bold text-ink">
                  {day === today ? C.today : day === yesterday ? C.yesterday : formatDate(locale, day, { weekday: "long", day: "numeric", month: "long" })}
                </span>
              </div>
            )}
            {isNew && (
              <div className="relative my-1 flex justify-end px-4" role="separator" aria-label={C.newLine}>
                <span aria-hidden="true" className="absolute inset-x-4 top-1/2 h-px bg-red" />
                <span className="relative bg-paper pl-2 text-[11px] font-bold text-red">{C.newLine}</span>
              </div>
            )}
            <Message m={m} grouped={grouped} names={names} own={m.author_id === userId} isAdmin={isAdmin} C={C} locale={locale} inThread={inThread}
              fresh={!firstIds.has(m.id)} editing={editingId === m.id} onEdit={(on) => setEditing(on ? m.id : null)}
              onSaveEdit={(body) => { setEditing(null); if (body.trim() && body.trim() !== m.body) act(() => editChatMessage(m.id, body)); }}
              onReact={(code) => act(() => toggleReaction(m.id, BRAND.includes(code) ? `:${code}:` : code))}
              onDelete={() => act(() => deleteChatMessage(m.id))} onPin={() => act(() => pinChatMessage(m.id, !m.pinned_at))} onSave={() => act(() => saveChatMessage(m.id, !m.saved))} onThread={() => onThread(m)} />
            {inThread && i === 0 && messages.length > 1 && (
              <div className="relative my-2 flex items-center gap-3 px-4 text-xs text-ink-2" role="separator">
                <span className="shrink-0">{messages.length - 1 === 1 ? C.oneReply : fmt(C.replies, { n: messages.length - 1 })}</span>
                <span aria-hidden="true" className="h-px flex-1 bg-line" />
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/** Keeps a list at its end when new messages come, unless the person scrolled up to read. */
function useFollow(count: number) {
  const scroller = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const [behind, setBehind] = useState(false);
  const toEnd = (behaviour: ScrollBehavior = "smooth") => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: behaviour });
    setBehind(false);
  };
  useEffect(() => { toEnd("auto"); }, []);
  useEffect(() => { if (atEnd.current) toEnd(); else setBehind(true); }, [count]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (atEnd.current) setBehind(false);
  };
  return { scroller, atEnd, behind, toEnd, onScroll };
}

// ------------------------------------------------------------------ the channel, with its thread beside it (or over it when narrow)
/**
 * One channel, in a page or in the side panel: it fills the height it gets. Enter sends, Shift+Enter starts a new line,
 * @ mentions a person, ↑ edits one's last message. Replies go in a thread beside the channel (owner, Nov 2026: like Slack).
 */
export function ChatRoom({ channel, initial, people, me, userId, isAdmin, locale, text, warning, gifs = false, name, lastRead = null, thread: openThread = null, kind = "team", notify: firstNotify = null, huddle: huddleOffer = false }: {
  channel: string; initial: ChatMessage[]; people: ChatPerson[]; me: string; userId: string; isAdmin: boolean; locale: Locale; text: Dict["chat"]; warning?: string | null;
  gifs?: boolean;                           // GIF search is set up (GIPHY_API_KEY)
  name?: string;                            // "# general" or a person: the composer says whom it writes to
  lastRead?: string | null;                 // when the channel was read before it was opened: the "New" line
  thread?: string | null;                   // a thread to open at once (a notification or a search hit)
  kind?: "team" | "external" | "direct";
  notify?: string | null;                   // one's notifications for this channel: all, mentions, none
  huddle?: boolean;                         // opened from a huddle call: Join is shown big
}) {
  const C = text;
  const [messages, setMessages] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [thread, setThread] = useState<string | null>(openThread);
  const [replies, setReplies] = useState<ChatMessage[] | null>(null);
  const [showPins, setShowPins] = useState(false);
  const [pending, start] = useTransition();
  const first = useRef(new Set(initial.map((m) => m.id)));
  const firstReplies = useRef(new Set<string>());
  const names = [me, ...people.map((p) => p.full_name)];
  const main = useFollow(messages.length);
  const side = useFollow(replies?.length ?? 0);
  const router = useRouter();
  const live = useLive();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [typing, setTyping] = useState<Map<string, { name: string; thread: string | null; at: number }>>(new Map());
  const [notify, setNotify] = useState(firstNotify);
  const [notifyMenu, setNotifyMenu] = useState(false);
  const lastTyping = useRef(0);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  // New messages are read here: the menu, the channel list and the bell are drawn again without them
  const refresh = async () => {
    const last = messages.at(-1)?.id ?? null;
    const rows = await pollChat(channel, last);
    setMessages(rows);
    if (rows.at(-1)?.id !== last) router.refresh();
    if (thread) setReplies(await pollThread(channel, thread));
  };
  // Opening a channel reads it (also when no new message comes while it is open)
  useEffect(() => {
    let live = true;
    markChatRead(channel).then(() => { if (live) router.refresh(); }).catch(() => {});
    return () => { live = false; };
  }, [channel, router]);
  refreshRef.current = refresh;
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden && !pending) refresh().catch(() => {}); }, live?.realtime ? LIVE_POLL_MS : POLL_MS);
    return () => clearInterval(t);
  });
  // The live topic of the channel: a change brings the messages at once; who is typing; the huddle
  // (join and session never change; the rest of the live value does, with every status of someone)
  const liveJoin = live?.join, liveSession = live?.session;
  useEffect(() => {
    if (!liveJoin) return;
    const t = liveJoin(`chat:${channel}`);
    setTopic(t);
    let timer = 0;
    const off = t.on((event, p) => {
      if (event === "change") {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => { refreshRef.current().catch(() => {}); }, 120);
      } else if (event === "typing" && p.session !== liveSession) {
        setTyping((old) => new Map(old).set(String(p.session), { name: String(p.name ?? ""), thread: (p.thread as string) ?? null, at: Date.now() }));
      } else if (event === "stop-typing") {
        setTyping((old) => { const n = new Map(old); n.delete(String(p.session)); return n; });
      }
    });
    return () => { window.clearTimeout(timer); off(); t.release(); setTopic(null); };
  }, [liveJoin, liveSession, channel]);
  // Typing fades after a few seconds without a new sign
  useEffect(() => {
    if (!typing.size) return;
    const t = window.setTimeout(() => setTyping((old) => {
      const n = new Map([...old].filter(([, v]) => Date.now() - v.at < TYPING_SHOW_MS));
      return n.size === old.size ? old : n;
    }), 1000);
    return () => window.clearTimeout(t);
  }, [typing]);
  const sayTyping = (where: string | null) => () => {
    if (!topic || !live || Date.now() - lastTyping.current < TYPING_SEND_MS) return;
    lastTyping.current = Date.now();
    topic.send("typing", { session: live.session, name: me, thread: where });
  };
  const typingText = (where: string | null) => {
    const who = [...new Set([...typing.values()].filter((v) => v.thread === where && Date.now() - v.at < TYPING_SHOW_MS).map((v) => v.name))];
    if (!who.length) return null;
    if (who.length === 1) return fmt(C.typingOne, { name: who[0] });
    if (who.length === 2) return fmt(C.typingTwo, { a: who[0], b: who[1] });
    return C.typingMany;
  };
  const chooseNotify = (level: string) => { setNotify(level); setNotifyMenu(false); start(async () => { await setChatNotify(channel, level); }); };
  // A thread opened: its messages, and its notifications are read
  useEffect(() => {
    if (!thread) { setReplies(null); return; }
    let live = true;
    pollThread(channel, thread).then((r) => { if (live) { firstReplies.current = new Set(r.map((m) => m.id)); setReplies(r); requestAnimationFrame(() => side.toEnd("auto")); } }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, thread]);
  useEffect(() => {
    if (!thread) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement)?.closest?.("form")) setThread(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [thread]);

  const act = (fn: () => Promise<unknown>) => start(async () => { await fn(); await refresh(); });
  const post = (d: Draft, parent: string | null) => new Promise<boolean>((resolve) => {
    const fd = new FormData();
    fd.set("channel", channel);
    fd.set("body", d.body);
    if (parent) fd.set("parent", parent);
    fd.set("mentions", JSON.stringify(d.mentions.map((m) => m.id)));
    d.files.forEach((f) => fd.append("files", f));
    setError(null);
    (parent ? side : main).atEnd.current = true;
    start(async () => {
      const r = await sendChat(fd).catch(() => ({ error: C.failed }));
      if (r.error) { setError(r.error); resolve(false); } else {
        if (topic && live) topic.send("stop-typing", { session: live.session });
        lastTyping.current = 0;
        await refresh(); resolve(true);
      }
    });
  });
  const gif = (g: Gif, parent: string | null) => post({ body: g.url, files: [], mentions: [] }, parent);
  const editLast = (list: ChatMessage[]) => () => {
    const mine = [...list].reverse().find((m) => m.author_id === userId && !GIF.test(m.body) && m.body !== "📎");
    if (mine) setEditing(mine.id);
  };
  const pins = messages.filter((m) => m.pinned_at);
  const parent = thread ? replies?.[0] ?? messages.find((m) => m.id === thread) : null;
  const placeholder = name ? fmt(C.messageTo, { name }) : C.message;
  const feedProps = { userId, names, isAdmin, C, locale, editingId: editing, setEditing, act };

  return (
    <div className="@container relative flex h-full min-h-0 min-w-0">
      <div className={`relative min-h-0 min-w-0 flex-1 flex-col ${thread ? "hidden @min-[760px]:flex" : "flex"}`}>
        {warning && <p className="m-0 mx-4 mb-2 rounded-lg bg-amber-tint px-3 py-2 text-xs font-semibold text-amber-ink">{warning}</p>}
        <div className="relative mx-4 mt-1 mb-1 flex min-w-0 flex-wrap items-center gap-2">
          {pins.length > 0 && (
            <button type="button" aria-expanded={showPins} onClick={() => setShowPins(!showPins)}
              className="flex min-h-8 items-center gap-1.5 rounded-md border border-line bg-paper px-2 text-xs font-semibold text-ink-2 hover:text-ink">
              <Ico d={ICONS.pin} size={13} />{fmt(C.pinnedCount, { n: pins.length })}
            </button>
          )}
          <span className="flex-1" />
          {live && <Huddle topic={topic} channel={channel} session={live.session} userId={userId} name={me} direct={kind === "direct"} C={C} autoOffer={huddleOffer} />}
          {notify && (
            <div className="relative">
              <button type="button" aria-expanded={notifyMenu} aria-haspopup="menu" onClick={() => setNotifyMenu(!notifyMenu)} title={C.notifyTitle}
                className={`flex min-h-9 items-center gap-1.5 rounded-md border border-line bg-paper px-2 text-xs font-semibold hover:text-ink ${notify === "none" ? "text-red-ink" : "text-ink-2"}`}>
                <Ico d={ICONS.bell} size={15} /><span className="hide-sm">{C.notifyLevels[notify as keyof typeof C.notifyLevels] ?? notify}</span>
                <span className="sr-only">{C.notifyTitle}</span>
              </button>
              {notifyMenu && (
                <div role="menu" aria-label={C.notifyTitle} className="absolute top-full right-0 z-30 mt-1 flex w-64 flex-col rounded-xl border border-line bg-paper p-1 shadow-xl">
                  <p className="m-0 px-2 py-1 text-xs font-bold text-ink-2">{C.notifyTitle}</p>
                  {(["all", "mentions", "none"] as const).map((l) => (
                    <button key={l} type="button" role="menuitemradio" aria-checked={notify === l} onClick={() => chooseNotify(l)}
                      className="flex min-h-11 items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-canvas">
                      <span aria-hidden="true" className="w-4 shrink-0 pt-0.5 text-[#1264a3]">{notify === l ? "✓" : ""}</span>
                      <span className="flex min-w-0 flex-col"><span className="font-semibold">{C.notifyLevels[l]}</span><span className="text-xs text-ink-2">{C.notifyHints[l]}</span></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {showPins && (
              <div className="absolute inset-x-0 top-full z-20 mt-1 flex max-h-[60vh] flex-col gap-1 overflow-y-auto rounded-xl border border-line bg-paper p-2 shadow-xl">
                <div className="flex items-center justify-between px-1"><strong className="text-sm">{C.pinnedTitle}</strong>
                  <button type="button" onClick={() => setShowPins(false)} aria-label={C.close} className="grid h-9 w-9 place-items-center rounded-md text-lg text-ink-2 hover:bg-mist">×</button></div>
                {pins.map((m) => (
                  <button key={m.id} type="button" onClick={() => { setShowPins(false); document.getElementById(`m-${m.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }); }}
                    className="flex min-w-0 flex-col items-start gap-0.5 rounded-lg border border-line p-2 text-left hover:bg-canvas">
                    <span className="text-xs font-bold">{m.author} <span className="font-normal text-ink-2">{formatDate(locale, m.created_at.slice(0, 10))}</span></span>
                    <span className="line-clamp-3 w-full text-sm break-words">{m.body}</span>
                  </button>
                ))}
              </div>
          )}
        </div>
        <Feed {...feedProps} messages={messages} inThread={false} lastRead={lastRead} onThread={(m) => setThread(m.id)} firstIds={first.current}
          scroller={main.scroller} onScroll={main.onScroll} empty={<><p className="m-0 text-base font-bold text-ink">{name ?? C.title}</p><p className="m-0">{C.empty}</p></>} />
        {main.behind && (
          <button type="button" onClick={() => main.toEnd()} className="chat-in absolute bottom-36 left-1/2 z-10 -translate-x-1/2 rounded-full bg-[#1264a3] px-4 py-2 text-xs font-semibold text-white shadow-lg">↓ {C.newMessages}</button>
        )}
        {error && !thread && <p role="alert" className="m-0 mx-4 mb-1 text-sm font-semibold text-red-ink">{error}</p>}
        <Composer id={`chat-text-${channel}`} placeholder={placeholder} people={people} C={C} gifs={gifs} pending={pending} autoFocus={!thread}
          onSend={(d) => post(d, null)} onSendGif={(g) => gif(g, null)} onEditLast={editLast(messages)} onTyping={sayTyping(null)} typing={typingText(null)} />
      </div>

      {thread && (
        <section aria-label={C.thread} className="flex min-h-0 w-full min-w-0 flex-col border-line @min-[760px]:w-[min(400px,45%)] @min-[760px]:border-l">
          <header className="flex min-h-12 items-center gap-2 border-b border-line px-4">
            <div className="min-w-0 flex-1">
              <h3 className="m-0 text-base font-bold">{C.thread}</h3>
              {name && <p className="m-0 truncate text-xs text-ink-2">{name}</p>}
            </div>
            <button type="button" onClick={() => setThread(null)} aria-label={C.close} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-xl text-ink-2 hover:bg-mist hover:text-ink">×</button>
          </header>
          {replies === null ? <p className="m-0 p-4 text-sm text-ink-2">…</p> : (
            <Feed {...feedProps} messages={replies} inThread lastRead={null} onThread={() => {}} firstIds={firstReplies.current}
              scroller={side.scroller} onScroll={side.onScroll} empty={C.noThread} head={<div className="h-2" />} />
          )}
          {error && thread && <p role="alert" className="m-0 mx-4 mb-1 text-sm font-semibold text-red-ink">{error}</p>}
          {parent && (
            <Composer key={thread} id={`chat-reply-${thread}`} placeholder={C.replyPlaceholder} people={people} C={C} gifs={gifs} pending={pending} autoFocus
              onSend={(d) => post(d, thread)} onSendGif={(g) => gif(g, thread)} onEditLast={editLast((replies ?? []).slice(1))} onTyping={sayTyping(thread)} typing={typingText(thread)} />
          )}
        </section>
      )}
    </div>
  );
}
