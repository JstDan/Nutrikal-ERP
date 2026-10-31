import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { aiConfigured, aiModels } from "@/lib/ai/gateway";
import { AssistantChat, type ChatConversation, type ChatLine, type ChatProposal } from "@/components/assistant-chat";

/** The assistant reads the system's data with the rights of the person asking. */
export default async function AssistantPage({ searchParams }: PageProps<"/assistant">) {
  const { user, locale, t } = await requireRole("admin", "sales");
  const sp = await searchParams;
  const wanted = typeof sp.c === "string" && /^[0-9a-f-]{36}$/i.test(sp.c) ? sp.c : null;

  const { conversations, messages, proposals, current } = await withUser(user.id, async (tx) => {
    const conversations = (await tx.query<ChatConversation>(
      "select id, title, created_at::text from ai_conversations order by created_at desc limit 30")).rows;
    const current = conversations.find((c) => c.id === wanted) ?? null;
    const messages = current
      ? (await tx.query<ChatLine>("select id, role, content, model, created_at::text from ai_messages where conversation_id = $1 order by created_at", [current.id])).rows
      : [];
    const proposals = current
      ? (await tx.query<ChatProposal>("select id, recipe, estimate, formula_id, created_at::text from ai_recipe_proposals where conversation_id = $1 order by created_at", [current.id])).rows
      : [];
    return { conversations, messages, proposals, current };
  });

  return (
    <>
      <h1 className="sr-only">{t.assistant.title}</h1>
      <AssistantChat key={current?.id ?? "new"} conversations={conversations} current={current} messages={messages} proposals={proposals} models={aiModels()}
        configured={aiConfigured()} locale={locale} text={t.assistant} />
    </>
  );
}
