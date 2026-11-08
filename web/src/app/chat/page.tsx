import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { fmt, formatDate } from "@/lib/i18n";
import { LiveSearch } from "@/components/live-search";
import { ActionForm } from "@/components/action-form";
import { Avatar, ChatRoom, type ChatMessage, type ChatPerson } from "@/components/chat-room";
import { ChatSwitcher } from "@/components/chat-switcher";
import { FillHeight } from "@/components/fill-height";
import { createChannel, openDirect, type SavedItem } from "@/app/chat-actions";
import { PresenceDot } from "@/components/live";
import { ChatListRefresh, UnsaveButton } from "@/components/chat-live-bits";

type Channel = { id: string; name: string; description: string | null; kind: "team" | "external" | "direct"; unread: string };
type Hit = { id: string; channel_id: string; channel: string; author: string; body: string; created_at: string; thread_id: string | null };
const COLS = "id, author_id, author, body, created_at::text, edited_at::text, attachments, reactions, parent_id, reply_count, last_reply_at::text, repliers, pinned_at::text"
  + ", exists (select 1 from chat_saved s where s.message_id = f.id and s.user_id = auth.uid()) as saved";
const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

/**
 * The chat as in Slack (owner, Nov 2026): a dark list of channels and people, the channel with its threads beside it.
 * On a phone the list and the channel are two screens. Production sees only the channels marked for the partner.
 */
export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  const { user, developer, locale, t } = await getSession();
  const C = t.chat;
  const sp = await searchParams;
  const term = typeof sp.q === "string" ? sp.q.trim() : "";
  const partner = user.role === "production";
  const savedView = sp.saved === "1" && !term;

  const { channels, current, messages, people, everyone, hits, lastRead, notify, saved } = await withUser(user.id, async (tx) => {
    const channels = (await tx.query<Channel>("select id, name, description, kind, unread::text from chat_channel_list()")).rows;
    const current = channels.find((c) => c.id === sp.c) ?? channels[0] ?? null;
    return {
      channels, current,
      lastRead: current ? (await tx.query<{ at: string | null }>("select read_at::text as at from chat_reads where channel_id = $1 and user_id = auth.uid()", [current.id])).rows[0]?.at ?? null : null,
      messages: current && !savedView ? (await tx.query<ChatMessage>(`select ${COLS} from chat_feed($1) f`, [current.id])).rows : [],
      notify: current ? (await tx.query<{ n: string | null }>("select chat_my_notify($1) as n", [current.id])).rows[0]?.n ?? null : null,
      saved: savedView ? (await tx.query<SavedItem>("select id, channel_id, channel, kind, author_id, author, body, created_at::text, parent_id, saved_at::text from chat_saved_list()")).rows : [],
      people: current ? (await tx.query<ChatPerson>("select id, full_name from chat_people($1)", [current.id])).rows : [],
      everyone: partner ? [] : (await tx.query<ChatPerson>("select id, full_name from chat_people()")).rows,
      hits: term ? (await tx.query<Hit>("select id, channel_id, channel, author, body, created_at::text, thread_id from chat_search($1)", [term])).rows : [],
    };
  });

  // A phone shows the list or the channel; a wide screen both
  const inRoom = !!(sp.c || term || savedView);
  const dot = { active: C.online, away: C.away };
  const personOf = (name: string) => everyone.find((p) => p.full_name === name)?.id;
  const talks = channels.filter((c) => c.kind === "direct");
  const item = (c: Channel) => {
    const on = !term && !savedView && c.id === current?.id;
    const unread = Number(c.unread) > 0 && !on;
    const pid = c.kind === "direct" ? personOf(c.name) : undefined;
    return (
      <Link key={c.id} href={`/chat?c=${c.id}`} aria-current={on ? "page" : undefined}
        className={`flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 text-[15px] no-underline lg:min-h-8 ${on ? "bg-[#1264a3] text-white" : unread ? "font-bold text-white hover:bg-white/10" : "text-side-text hover:bg-white/10"}`}>
        {c.kind === "direct"
          ? <span className="relative shrink-0"><span className="block overflow-hidden rounded-md"><Avatar name={c.name} id={pid ?? c.id} photo={!!pid} size={20} /></span><PresenceDot id={pid} label={dot} ring={on ? "border-[#1264a3]" : "border-side"} /></span>
          : <span aria-hidden="true" className="w-5 shrink-0 text-center opacity-70">#</span>}
        <span className="min-w-0 flex-1 truncate">{c.name}</span>
        {unread && <span className="rounded-full bg-red px-1.5 text-xs leading-5 font-bold text-white">{c.unread}</span>}
      </Link>
    );
  };
  const targets = [
    ...channels.filter((c) => c.kind !== "direct").map((c) => ({ kind: "channel" as const, id: c.id, name: c.name })),
    ...talks.map((c) => ({ kind: "direct" as const, id: c.id, name: c.name, personId: personOf(c.name) })),
    ...everyone.filter((p) => !talks.some((c) => c.name === p.full_name)).map((p) => ({ kind: "person" as const, id: p.id, name: p.full_name, personId: p.id })),
  ];
  const label = (c: Channel) => (c.kind === "direct" ? c.name : `# ${c.name}`);

  return (
    <>
      <h1 className="sr-only">{C.title}</h1>
      <ChatListRefresh current={savedView || term ? null : current?.id ?? null} />
      <FillHeight className="grid h-[calc(100dvh-150px-var(--tabbar))] min-w-0 grid-cols-1 overflow-hidden rounded-lg border border-line bg-paper sm:-my-2 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className={`${inRoom ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-col gap-4 overflow-y-auto bg-side px-3 py-4 text-side-text`}>
          <div className="flex flex-col gap-2 px-1">
            <span className="text-base font-bold text-white">Nutrikal</span>
            <ChatSwitcher targets={targets} label={C.jump} hint={C.jumpHint} placeholder={C.find} />
            {!partner && (
              <form method="get" role="search" className="flex min-w-0">
                <label htmlFor="chat-search" className="sr-only">{C.search}</label>
                {current && <input type="hidden" name="c" value={current.id} />}
                <LiveSearch id="chat-search" defaultValue={term} placeholder={C.search} className="input min-h-10 border-[#4a5160]! bg-white/10! text-white! placeholder:text-side-muted!" />
              </form>
            )}
          </div>
          <Link href="/chat?saved=1" aria-current={savedView ? "page" : undefined}
            className={`flex min-h-11 items-center gap-2 rounded-md px-2 text-[15px] no-underline lg:min-h-8 ${savedView ? "bg-[#1264a3] text-white" : "text-side-text hover:bg-white/10"}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" className="mx-0.5 shrink-0"><path d="M6 4h12v17l-6-4-6 4z" /></svg>
            {C.savedTitle}
          </Link>
          <nav aria-label={C.channels} className="flex flex-col gap-0.5">
            <span className="px-2 pb-1 text-[13px] font-semibold text-side-muted">{C.channels}</span>
            {channels.filter((c) => c.kind !== "direct").map(item)}
          </nav>
          {!partner && (
            <nav aria-label={C.direct} className="flex flex-col gap-0.5">
              <span className="px-2 pb-1 text-[13px] font-semibold text-side-muted">{C.direct}</span>
              {talks.map(item)}
              <form action={openDirect} className="mt-1 flex min-w-0 items-center gap-1 px-1">
                <label htmlFor="chat-person" className="sr-only">{C.newDirect}</label>
                <select id="chat-person" name="user" required defaultValue="" className="input min-h-10 min-w-0 flex-1 border-[#4a5160]! bg-side! text-side-text!">
                  <option value="" disabled>{C.newDirect}</option>
                  {everyone.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
                <button type="submit" className="min-h-10 rounded-md border border-[#4a5160] px-3 text-xs font-semibold text-white hover:bg-white/10">{C.open}</button>
              </form>
            </nav>
          )}
          {user.role === "admin" && !user.readOnly && (
            <details className="group px-1">
              <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md px-1 text-sm text-side-text hover:bg-white/10">
                <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded bg-white/10">+</span>{C.addChannel}
              </summary>
              <div className="mt-2 rounded-md bg-paper p-3 text-ink">
                <ActionForm action={createChannel} submitLabel={C.create}>
                  <label className="field"><span>{C.name} *</span><input name="name" required maxLength={60} className="input" /></label>
                  <label className="field"><span>{C.description}</span><input name="description" className="input" /></label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                    <input type="checkbox" name="partner" className="h-5 w-5 shrink-0 accent-ink" /><span>{C.withPartner}</span>
                  </label>
                </ActionForm>
              </div>
            </details>
          )}
        </aside>

        <section aria-label={term ? C.search : current?.name ?? C.title} className={`${inRoom ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col`}>
          {savedView ? (
            <>
              <header className="flex min-h-14 items-center gap-2 border-b border-line px-4">
                <Link href="/chat" aria-label={C.channels} className="grid h-11 w-9 shrink-0 place-items-center rounded-md text-xl text-ink no-underline hover:bg-mist lg:hidden">←</Link>
                <h2 className="m-0 min-w-0 truncate text-lg font-bold">{C.savedTitle}</h2>
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
                {saved.length === 0 && <p className="m-0 max-w-prose text-sm text-ink-2">{C.savedEmpty}</p>}
                {saved.map((h) => (
                  <div key={h.id} className="flex min-w-0 items-start gap-3 rounded-lg border border-line p-3 text-sm">
                    <Avatar name={h.author} id={h.author_id} size={32} />
                    <Link href={`/chat?c=${h.channel_id}${h.parent_id ? `&t=${h.parent_id}` : ""}`} className="flex min-w-0 flex-1 flex-col gap-1 text-ink no-underline">
                      <span className="text-xs text-ink-2"><strong className="text-ink">{h.author}</strong> · {h.kind === "direct" ? h.channel : `# ${h.channel}`} · {formatDate(locale, h.created_at.slice(0, 10))}{h.parent_id ? ` · ${C.thread}` : ""}</span>
                      <span className="line-clamp-4 break-words whitespace-pre-line">{h.body}</span>
                    </Link>
                    <UnsaveButton id={h.id} label={C.unsave} />
                  </div>
                ))}
              </div>
            </>
          ) : term ? (
            <>
              <header className="flex min-h-14 items-center gap-2 border-b border-line px-4">
                <Link href={current ? `/chat?c=${current.id}` : "/chat"} aria-label={C.back} className="grid h-11 w-9 place-items-center rounded-md text-xl text-ink no-underline hover:bg-mist">←</Link>
                <h2 className="m-0 min-w-0 truncate text-lg font-bold">{C.search}: “{term}”</h2>
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
                {hits.length === 0 && <p className="m-0 text-sm text-ink-2">{C.noResults}</p>}
                {hits.map((h) => (
                  <Link key={h.id} href={`/chat?c=${h.channel_id}${h.thread_id ? `&t=${h.thread_id}` : ""}`} className="flex min-w-0 flex-col gap-1 rounded-lg border border-line p-3 text-sm text-ink no-underline hover:bg-canvas">
                    <span className="text-xs text-ink-2"><strong className="text-ink">{h.author}</strong> · {h.channel} · {formatDate(locale, h.created_at.slice(0, 10))}{h.thread_id ? ` · ${C.thread}` : ""}</span>
                    <span className="break-words">{h.body}</span>
                  </Link>
                ))}
              </div>
            </>
          ) : current && (
            <>
              <header className="flex min-h-14 items-center gap-2 border-b border-line px-4">
                <Link href="/chat" aria-label={C.channels} className="grid h-11 w-9 shrink-0 place-items-center rounded-md text-xl text-ink no-underline hover:bg-mist lg:hidden">←</Link>
                {current.kind === "direct" && personOf(current.name) && (
                  <span className="relative shrink-0"><Avatar name={current.name} id={personOf(current.name)!} size={28} /><PresenceDot id={personOf(current.name)} label={dot} /></span>
                )}
                <div className="min-w-0 flex-1 py-1">
                  <h2 className="m-0 truncate text-lg font-bold">{label(current)}</h2>
                  {current.description && current.kind !== "external" && <p className="m-0 truncate text-xs text-ink-2">{current.description}</p>}
                </div>
                {current.kind !== "direct" && <span className="hide-sm shrink-0 rounded-md border border-line px-2 py-1 text-xs text-ink-2">{fmt(C.members, { n: people.length + 1 })}</span>}
              </header>
              <div className="min-h-0 flex-1">
                <ChatRoom key={current.id} channel={current.id} initial={messages} people={people} // A developer acting as someone writes under their own name
                  me={developer?.name ?? user.name} userId={developer?.id ?? user.id} isAdmin={user.role === "admin"} gifs={!!process.env.GIPHY_API_KEY}
                  name={label(current)} lastRead={lastRead} thread={uuid(sp.t)} kind={current.kind} notify={notify} huddle={sp.huddle === "1"}
                  locale={locale} text={C} warning={current.kind === "external" && !partner ? C.partnerWarning : null} />
              </div>
            </>
          )}
        </section>
      </FillHeight>
    </>
  );
}
