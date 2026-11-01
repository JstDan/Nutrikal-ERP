import Link from "next/link";
import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { Chip, Empty, Fold, PageHeader } from "@/components/ui";
import { fmt, formatDate } from "@/lib/i18n";

type Chat = {
  id: string; locale: string; created_at: string; last_at: string; enquiry: string | null; company: string | null; questions: number;
  messages: { role: "user" | "assistant"; body: string }[];
};

/** What visitors of the open catalog asked Nutri AI. Chats without an enquiry go after 12 months. */
export default async function CatalogChatsPage() {
  const { user, locale, t } = await requireRole("admin", "sales");
  const C = t.catalog;
  const chats = await q<Chat>(user.id,
    `select c.id, c.locale, c.created_at::text, c.last_at::text, e.number as enquiry, e.company,
            (select count(*)::int from catalog_chat_messages m where m.chat_id = c.id and m.role = 'user') as questions,
            coalesce((select jsonb_agg(jsonb_build_object('role', m.role, 'body', m.body) order by m.id) from catalog_chat_messages m where m.chat_id = c.id), '[]') as messages
       from catalog_chats c
       left join catalog_enquiries e on e.id = c.enquiry_id
      order by c.last_at desc
      limit 200`);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader crumb={<Link href="/catalog" className="text-ink-2">{C.title}</Link>} title={C.conversations} subtitle={C.conversationsNote} />
      {chats.length === 0 && <Empty>{C.noConversations}</Empty>}
      {chats.map((c) => (
        <Fold key={c.id} title={c.enquiry ? `${c.enquiry} · ${c.company}` : c.messages[0]?.body.slice(0, 70) ?? c.id}
          note={`${formatDate(locale, c.last_at)} · ${c.locale.toUpperCase()} · ${fmt(C.questions, { n: c.questions })}`}>
          <div className="flex min-w-0 flex-col gap-2 text-sm">
            {c.enquiry && <div><Chip tone="green">{fmt(C.ledToEnquiry, { no: c.enquiry })}</Chip></div>}
            {c.messages.map((m, i) => (
              <p key={i} className={`m-0 max-w-[85%] rounded-2xl px-3 py-2 break-words whitespace-pre-wrap ${m.role === "user" ? "bg-neutral-tint" : "ml-auto bg-mist"}`}>
                <span className="block text-xs font-semibold text-ink-2">{m.role === "user" ? C.visitor : "Nutri AI"}</span>
                {m.body}
              </p>
            ))}
          </div>
        </Fold>
      ))}
    </div>
  );
}
