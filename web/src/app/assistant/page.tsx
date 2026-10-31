import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { formatDate } from "@/lib/i18n";
import { ActionForm } from "@/components/action-form";
import { Card, Empty, Fold, PageHeader } from "@/components/ui";
import { aiConfigured, aiModels } from "@/lib/ai/gateway";
import { askAssistant, deleteConversation } from "@/app/assistant-actions";

type Conversation = { id: string; title: string; created_at: string };
type Message = { id: string; role: "user" | "assistant"; content: string; model: string | null };

/** The assistant reads the system's data with the rights of the person asking. */
export default async function AssistantPage({ searchParams }: PageProps<"/assistant">) {
  const { user, locale, t } = await requireRole("admin", "sales");
  const A = t.assistant;
  const sp = await searchParams;
  const wanted = typeof sp.c === "string" && /^[0-9a-f-]{36}$/i.test(sp.c) ? sp.c : null;
  const models = aiModels();

  const { conversations, messages, current } = await withUser(user.id, async (tx) => {
    const conversations = (await tx.query<Conversation>(
      "select id, title, created_at::text from ai_conversations order by created_at desc limit 30")).rows;
    const current = conversations.find((c) => c.id === wanted) ?? null;
    const messages = current
      ? (await tx.query<Message>("select id, role, content, model from ai_messages where conversation_id = $1 order by created_at", [current.id])).rows
      : [];
    return { conversations, messages, current };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={A.title} subtitle={A.subtitle} />
      {!aiConfigured() && <Card><p className="m-0 text-sm font-semibold">{A.notConfigured}</p></Card>}

      <Card title={current?.title ?? A.newChat} id="chat-h">
        {messages.length === 0 && <Empty>{A.hint}</Empty>}
        {messages.map((m) => (
          <div key={m.id} className={`min-w-0 rounded-sm p-3 text-sm ${m.role === "user" ? "bg-neutral-tint" : "border border-line"}`}>
            <div className="label mb-1">{m.role === "user" ? user.name : m.model ?? A.title}</div>
            <p className="m-0 whitespace-pre-line break-words">{m.content}</p>
          </div>
        ))}
        <ActionForm key={messages.length} action={askAssistant} submitLabel={A.send} resetOnSuccess={false}>
          {current && <input type="hidden" name="conversation_id" value={current.id} />}
          <label className="field"><span>{A.question}</span><textarea name="text" required rows={3} className="input" /></label>
          {models.length > 1 && (
            <label className="field max-w-[280px]"><span>{A.model}</span>
              <select name="model" className="input">{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
            </label>
          )}
        </ActionForm>
        {current && (
          <div className="flex flex-wrap gap-3 border-t border-mist pt-3">
            <Link href="/assistant" className="btn btn-outline">{A.newChat}</Link>
            <form action={deleteConversation}>
              <input type="hidden" name="id" value={current.id} />
              <button type="submit" className="btn btn-outline">{A.delete}</button>
            </form>
          </div>
        )}
      </Card>

      {conversations.length > 0 && (
        <Fold title={A.history}>
          {conversations.map((c) => (
            <Link key={c.id} href={`/assistant?c=${c.id}`} className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-3 text-sm text-ink">
              <span className="min-w-0 break-words font-semibold">{c.title}</span>
              <span className="text-ink-2">{formatDate(locale, c.created_at.slice(0, 10))}</span>
            </Link>
          ))}
        </Fold>
      )}
    </div>
  );
}
