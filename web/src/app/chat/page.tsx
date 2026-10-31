import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { ActionForm } from "@/components/action-form";
import { Fold } from "@/components/ui";
import { LiveSearch } from "@/components/live-search";
import { ChatRoom, type ChatMessage, type ChatPerson } from "@/components/chat-room";
import { createChannel, openDirect } from "@/app/chat-actions";

type Channel = { id: string; name: string; description: string | null; kind: "team" | "external" | "direct"; unread: string };
type Hit = { id: string; channel_id: string; channel: string; author: string; body: string; created_at: string };

/** Channels and direct messages. Production sees only the channels marked for the partner. */
export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  const { user, locale, t } = await getSession();
  const C = t.chat;
  const sp = await searchParams;
  const term = typeof sp.q === "string" ? sp.q.trim() : "";
  const partner = user.role === "production";

  const { channels, current, messages, people, everyone, hits } = await withUser(user.id, async (tx) => {
    const channels = (await tx.query<Channel>("select id, name, description, kind, unread::text from chat_channel_list()")).rows;
    const current = channels.find((c) => c.id === sp.c) ?? channels[0] ?? null;
    return {
      channels, current,
      messages: current
        ? (await tx.query<ChatMessage>("select id, author_id, author, body, created_at::text, edited_at::text, attachments, reactions from chat_feed($1)", [current.id])).rows
        : [],
      people: current ? (await tx.query<ChatPerson>("select id, full_name from chat_people($1)", [current.id])).rows : [],
      everyone: partner ? [] : (await tx.query<ChatPerson>("select id, full_name from chat_people()")).rows,
      hits: term ? (await tx.query<Hit>("select id, channel_id, channel, author, body, created_at::text from chat_search($1)", [term])).rows : [],
    };
  });

  const list = (kind: "shared" | "direct") => channels.filter((c) => (kind === "direct") === (c.kind === "direct")).map((c) => (
    <Link key={c.id} href={`/chat?c=${c.id}`} aria-current={c.id === current?.id ? "page" : undefined}
      className={`flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-sm px-3 text-sm text-ink no-underline ${c.id === current?.id ? "bg-neutral-tint font-semibold" : "hover:bg-mist"}`}>
      <span className="truncate">{c.kind === "direct" ? c.name : `# ${c.name}`}</span>
      {c.id !== current?.id && Number(c.unread) > 0 && <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-semibold text-white">{c.unread}</span>}
    </Link>
  ));

  return (
    <>
      <h1 className="sr-only">{C.title}</h1>
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-3">
          {!partner && (
            <form method="get" role="search" className="flex min-w-0">
              <label htmlFor="chat-search" className="sr-only">{C.search}</label>
              {current && <input type="hidden" name="c" value={current.id} />}
              <LiveSearch id="chat-search" defaultValue={term} placeholder={C.search} className="input" />
            </form>
          )}
          <nav aria-label={C.channels} className="flex flex-wrap gap-1 lg:flex-col lg:flex-nowrap">{list("shared")}</nav>
          {!partner && (
            <div className="flex flex-col gap-1">
              <span className="label px-3">{C.direct}</span>
              <nav aria-label={C.direct} className="flex flex-wrap gap-1 lg:flex-col lg:flex-nowrap">{list("direct")}</nav>
              <form action={openDirect} className="flex items-center gap-2 px-1">
                <label htmlFor="chat-person" className="sr-only">{C.newDirect}</label>
                <select id="chat-person" name="user" required defaultValue="" className="input min-w-0 flex-1">
                  <option value="" disabled>{C.newDirect}</option>
                  {everyone.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
                <button type="submit" className="btn btn-outline">{C.open}</button>
              </form>
            </div>
          )}
          {user.role === "admin" && !user.readOnly && (
            <Fold title={C.newChannel}>
              <ActionForm action={createChannel} submitLabel={C.create}>
                <label className="field"><span>{C.name} *</span><input name="name" required maxLength={60} className="input" /></label>
                <label className="field"><span>{C.description}</span><input name="description" className="input" /></label>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                  <input type="checkbox" name="partner" className="h-5 w-5 shrink-0 accent-ink" /><span>{C.withPartner}</span>
                </label>
              </ActionForm>
            </Fold>
          )}
        </aside>
        {term ? (
          <section aria-label={C.search} className="flex min-w-0 flex-col gap-2">
            {hits.length === 0 && <p className="m-0 text-sm text-ink-2">{C.noResults}</p>}
            {hits.map((h) => (
              <Link key={h.id} href={`/chat?c=${h.channel_id}`} className="card flex min-w-0 flex-col gap-1 p-3 text-sm text-ink no-underline">
                <span className="text-xs text-ink-2">{h.channel} · {h.author}</span>
                <span className="break-words">{h.body}</span>
              </Link>
            ))}
          </section>
        ) : current && (
          <section aria-label={current.name} className="card flex h-[calc(100dvh-190px)] min-h-[420px] min-w-0 flex-col overflow-hidden pt-3">
            <div className="border-b border-line px-4 pb-2">
              <h2 className="m-0 text-lg font-bold">{current.kind === "direct" ? current.name : `# ${current.name}`}</h2>
              {current.description && current.kind !== "external" && <p className="m-0 text-sm text-ink-2">{current.description}</p>}
            </div>
            <div className="min-h-0 flex-1 pt-2">
            <ChatRoom key={current.id} channel={current.id} initial={messages} people={people} me={user.name} userId={user.id} isAdmin={user.role === "admin"}
              locale={locale} text={C} warning={current.kind === "external" && !partner ? C.partnerWarning : null} />
            </div>
          </section>
        )}
      </div>
    </>
  );
}
