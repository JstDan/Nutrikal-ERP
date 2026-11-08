"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { chatList, chatRoomData, chatUnread, openDirectChat } from "@/app/chat-actions";
import { Avatar, ChatRoom, type ChatMessage, type ChatPerson } from "@/components/chat-room";
import type { Locale } from "@/lib/i18n";
import { onPing, PresenceDot } from "@/components/live";
import type { Dict } from "@/lib/i18n/en";

type Channel = { id: string; name: string; description: string | null; kind: "team" | "external" | "direct"; unread: string };
type Room = { channel: Channel; messages: ChatMessage[]; people: ChatPerson[]; lastRead: string | null; notify: string };
const BADGE_MS = 15000;

/** The chat from anywhere: a button by the bell and a panel over the page. */
export function ChatDrawer({ unread: first, userId, me, isAdmin, partner, locale, text, gifs = false }: {
  unread: number; userId: string; me: string; isAdmin: boolean; partner: boolean; locale: Locale; text: Dict["chat"]; gifs?: boolean;
}) {
  const C = text;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(first);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [everyone, setEveryone] = useState<ChatPerson[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [term, setTerm] = useState("");
  const [, start] = useTransition();
  const button = useRef<HTMLButtonElement>(null);
  // The page was drawn again (a channel was read): the count follows it
  useEffect(() => { setUnread(first); }, [first]);

  const loadList = () => start(async () => {
    const r = await chatList();
    setChannels(r.channels as Channel[]);
    setEveryone(r.everyone);
    setUnread(r.channels.reduce((a, c) => a + Number(c.unread), 0));
  });
  const close = () => { setOpen(false); setRoom(null); button.current?.focus(); };
  const enter = (channel: Channel) => start(async () => {
    const r = await chatRoomData(channel.id);
    setRoom({ channel, ...r });
    setTerm("");
  });
  const back = () => { setRoom(null); loadList(); };
  const direct = (person: ChatPerson) => start(async () => {
    const id = await openDirectChat(person.id);
    const r = await chatRoomData(id);
    setRoom({ channel: { id, name: person.full_name, description: null, kind: "direct", unread: "0" }, ...r });
    setTerm("");
  });

  useEffect(() => {
    if (open) return;
    const t = setInterval(() => { if (!document.hidden) chatUnread().then(setUnread).catch(() => {}); }, BADGE_MS);
    return () => clearInterval(t);
  }, [open]);
  // A new message anywhere: the count (and the open list) at once
  useEffect(() => onPing((event) => {
    if (event !== "chat") return;
    if (open && !room) loadList(); else chatUnread().then(setUnread).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [open, room]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // The full page is the chat already
  if (pathname.startsWith("/chat")) return null;

  const find = term.trim().toLowerCase();
  const shown = channels.filter((c) => !find || c.name.toLowerCase().includes(find));
  const shared = shown.filter((c) => c.kind !== "direct");
  const talks = shown.filter((c) => c.kind === "direct");
  // A direct talk is named after the other person: their picture
  const personId = (name: string) => everyone.find((p) => p.full_name === name)?.id;
  const others = everyone.filter((p) => (!find || p.full_name.toLowerCase().includes(find)) && !talks.some((c) => c.name === p.full_name));
  const badge = (n: number) => n > 0 && (
    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-red px-1 text-[11px] font-bold text-[#fff]">{n > 99 ? "99+" : n}</span>
  );

  return (
    <>
      <button ref={button} type="button" aria-label={unread > 0 ? `${C.title}: ${unread}` : C.title} aria-expanded={open}
        onClick={() => { if (open) close(); else { setOpen(true); loadList(); } }}
        className="relative grid h-[44px] w-11 shrink-0 place-items-center rounded-sm border border-line-strong bg-white text-ink hover:bg-canvas">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.500l1.400-5.400A8 8 0 1 1 21 12z" />
        </svg>
        {unread > 0 && <span aria-hidden="true" className="absolute -top-1.5 -right-1.5">{badge(unread)}</span>}
      </button>

      {open && (
        <aside role="dialog" aria-label={C.title}
          className="chat-drawer fixed inset-0 z-50 flex flex-col bg-paper text-ink shadow-2xl print:hidden sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[440px] sm:border-l sm:border-line">
          <header className="flex min-h-14 items-center gap-2 border-b border-line px-3">
            {room && <button type="button" onClick={back} aria-label={C.back} className="grid h-11 w-9 shrink-0 place-items-center rounded-lg text-xl hover:bg-mist">←</button>}
            {room?.channel.kind === "direct" && <Avatar name={room.channel.name} id={personId(room.channel.name) ?? room.channel.id} photo={!!personId(room.channel.name)} size={30} />}
            <h2 className="m-0 min-w-0 flex-1 truncate text-base font-bold">{room ? `${room.channel.kind === "direct" ? "" : "# "}${room.channel.name}` : C.title}</h2>
            <Link href={room ? `/chat?c=${room.channel.id}` : "/chat"} onClick={() => setOpen(false)} className="flex min-h-11 items-center rounded-sm px-2 text-xs font-semibold text-ink-2 no-underline hover:text-ink">{C.fullView}</Link>
            <button type="button" onClick={close} aria-label={C.close} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-xl text-ink-2 hover:bg-mist hover:text-ink">×</button>
          </header>

          {room ? (
            <div className="min-h-0 flex-1 pt-2">
              <ChatRoom key={room.channel.id} channel={room.channel.id} initial={room.messages} people={room.people} me={me} userId={userId} isAdmin={isAdmin} gifs={gifs}
                name={room.channel.kind === "direct" ? room.channel.name : `# ${room.channel.name}`} lastRead={room.lastRead} kind={room.channel.kind} notify={room.notify}
                locale={locale} text={C} warning={room.channel.kind === "external" && !partner ? C.partnerWarning : null} />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              {!partner && (
                <>
                  <label htmlFor="chat-find" className="sr-only">{C.find}</label>
                  <input id="chat-find" autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder={C.find} className="input" />
                </>
              )}
              <nav aria-label={C.channels} className="flex flex-col gap-0.5">
                {shared.map((c) => (
                  <button key={c.id} type="button" onClick={() => enter(c)} className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl px-2 text-left text-sm hover:bg-mist">
                    <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-tint font-bold text-ink-2">#</span>
                    <span className={`min-w-0 flex-1 truncate ${Number(c.unread) ? "font-bold" : ""}`}>{c.name}</span>
                    {badge(Number(c.unread))}
                  </button>
                ))}
              </nav>
              {!partner && (talks.length > 0 || others.length > 0) && (
                <div className="flex flex-col gap-0.5">
                  <span className="label px-2 pb-1">{C.direct}</span>
                  {talks.map((c) => (
                    <button key={c.id} type="button" onClick={() => enter(c)} className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl px-2 text-left text-sm hover:bg-mist">
                      <span className="relative shrink-0"><Avatar name={c.name} id={personId(c.name) ?? c.id} photo={!!personId(c.name)} /><PresenceDot id={personId(c.name)} label={{ active: C.online, away: C.away }} /></span>
                      <span className={`min-w-0 flex-1 truncate ${Number(c.unread) ? "font-bold" : ""}`}>{c.name}</span>
                      {badge(Number(c.unread))}
                    </button>
                  ))}
                  {others.map((p) => (
                    <button key={p.id} type="button" onClick={() => direct(p)} className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl px-2 text-left text-sm text-ink-2 hover:bg-mist hover:text-ink">
                      <span className="relative shrink-0"><Avatar name={p.full_name} id={p.id} /><PresenceDot id={p.id} label={{ active: C.online, away: C.away }} /></span>
                      <span className="min-w-0 flex-1 truncate">{p.full_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>
      )}
    </>
  );
}
