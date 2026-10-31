import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { ActionForm } from "@/components/action-form";
import { Fold } from "@/components/ui";
import { ChatRoom, type ChatMessage } from "@/components/chat-room";
import { createChannel } from "@/app/chat-actions";

type Channel = { id: string; name: string; description: string | null; unread: number };

/** Channels for the team, like Slack. Production is not in the chat: the channels talk about clients. */
export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  const { user, locale, t } = await requireStaff();
  const C = t.chat;
  const sp = await searchParams;
  const { channels, current, messages } = await withUser(user.id, async (tx) => {
    const channels = (await tx.query<Channel>(
      `select c.id, c.name, c.description, coalesce(u.unread, 0)::int as unread
         from chat_channels c left join chat_unread() u on u.channel_id = c.id order by c.created_at, c.name`)).rows;
    const current = channels.find((c) => c.id === sp.c) ?? channels[0] ?? null;
    const messages = current
      ? (await tx.query<ChatMessage>("select id, author_id, author, body, created_at::text from chat_feed($1)", [current.id])).rows
      : [];
    if (current && !user.readOnly) {
      await tx.query("insert into chat_reads (channel_id, user_id) values ($1, auth.uid()) on conflict (channel_id, user_id) do update set read_at = now()", [current.id]);
    }
    return { channels, current, messages };
  });

  return (
    <>
      <h1 className="sr-only">{C.title}</h1>
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-3">
          <nav aria-label={C.channels} className="flex flex-wrap gap-1 lg:flex-col lg:flex-nowrap">
            {channels.map((c) => (
              <Link key={c.id} href={`/chat?c=${c.id}`} aria-current={c.id === current?.id ? "page" : undefined}
                className={`flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-sm px-3 text-sm text-ink no-underline ${c.id === current?.id ? "bg-neutral-tint font-semibold" : "hover:bg-mist"}`}>
                <span className="truncate"># {c.name}</span>
                {c.unread > 0 && <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-semibold text-white">{c.unread}</span>}
              </Link>
            ))}
          </nav>
          {user.role === "admin" && !user.readOnly && (
            <Fold title={C.newChannel}>
              <ActionForm action={createChannel} submitLabel={C.create}>
                <label className="field"><span>{C.name} *</span><input name="name" required maxLength={60} className="input" /></label>
                <label className="field"><span>{C.description}</span><input name="description" className="input" /></label>
              </ActionForm>
            </Fold>
          )}
        </aside>
        {current && (
          <section aria-label={current.name} className="flex min-w-0 flex-col gap-3">
            <div>
              <h2 className="m-0 text-lg font-bold"># {current.name}</h2>
              {current.description && <p className="m-0 text-sm text-ink-2">{current.description}</p>}
            </div>
            <ChatRoom key={current.id} channel={current.id} initial={messages} userId={user.id} isAdmin={user.role === "admin"} readOnly={user.readOnly} locale={locale} text={C} />
          </section>
        )}
      </div>
    </>
  );
}
