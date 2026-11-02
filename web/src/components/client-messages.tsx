import Link from "next/link";
import { Card } from "@/components/ui";
import { ChatPane, SubmitOnChange, type ChatLine } from "@/components/portal-chat";
import { replyToClient, setClientThread } from "@/app/file-actions";
import { q } from "@/lib/db/engine";
import { formatDate, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";

type Row = { id: string; from_client: boolean; body: string; created_at: string; author: string | null };
const STATES = ["open", "waiting", "solved"] as const;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** One conversation with a client: its status, who answers, and the chat. Used in the inbox, on orders and on clients. */
export async function ClientConversation({ clientId, orderId, userId, canWrite, locale, t, tall = false }: {
  clientId: string; orderId?: string | null; userId: string; canWrite: boolean; locale: Locale; t: Dict; tall?: boolean;
}) {
  const S = t.portal.staff;
  const I = S.inbox;
  const order = orderId ?? null;
  const rows = await q<Row>(userId,
    `select m.id, m.from_client, m.body, m.created_at::text, p.full_name as author
       from client_messages m left join profiles p on p.id = m.sender_id
      where m.client_id = $1 and m.order_id is not distinct from $2::uuid order by m.created_at`, [clientId, order]);
  if (canWrite && rows.some((m) => m.from_client)) await q(userId, "select client_messages_read($1, $2)", [clientId, order]);
  const [thread] = await q<{ status: string; assigned_to: string | null }>(userId, "select status, assigned_to from client_threads where client_id = $1 and order_id is not distinct from $2::uuid", [clientId, order]);
  const team = thread ? await q<{ id: string; full_name: string }>(userId, "select id, full_name from client_team()") : [];
  const lines: ChatLine[] = rows.map((m, i) => ({
    id: m.id, mine: !m.from_client, who: m.author ?? "", initials: initials(m.author ?? ""), time: m.created_at.slice(11, 16), body: m.body,
    day: i > 0 && rows[i - 1].created_at.slice(0, 10) === m.created_at.slice(0, 10) ? null : formatDate(locale, m.created_at.slice(0, 10)),
  }));
  const keys = <><input type="hidden" name="client_id" value={clientId} />{order && <input type="hidden" name="order_id" value={order} />}</>;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      {thread && canWrite && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <form action={setClientThread} role="group" aria-label={I.status} className="flex gap-1">
            {keys}
            <input type="hidden" name="assigned_to" value={thread.assigned_to ?? ""} />
            {STATES.map((x) => <button key={x} type="submit" name="status" value={x} aria-pressed={thread.status === x} className={`p-seg ${thread.status === x ? "p-seg-on" : ""}`}>{I.statuses[x]}</button>)}
          </form>
          <form action={setClientThread}>
            {keys}
            <input type="hidden" name="status" value={thread.status} />
            <SubmitOnChange key={thread.assigned_to ?? ""} name="assigned_to" value={thread.assigned_to ?? ""} label={I.assigned} options={[{ value: "", text: I.nobody }, ...team.map((p) => ({ value: p.id, text: p.full_name }))]} />
          </form>
        </div>
      )}
      <ChatPane action={replyToClient} fields={keys} lines={lines} empty={S.empty} placeholder={S.placeholder} send={S.send} tall={tall} />
    </div>
  );
}

/** On an order or a client: the same conversation, with the way to the inbox. */
export async function ClientMessages({ clientId, orderId, userId, canWrite, locale, t }: {
  clientId: string; orderId?: string; userId: string; canWrite: boolean; locale: Locale; t: Dict;
}) {
  const S = t.portal.staff;
  const [{ n }] = await q<{ n: number }>(userId,
    "select (select count(*) from client_user_list($1)) + (select count(*) from client_messages where client_id = $1 and order_id is not distinct from $2::uuid) as n", [clientId, orderId ?? null]);
  if (Number(n) === 0) return null;
  return (
    <Card title={S.messages} id="client-messages" action={<Link href="/client-messages" className="text-sm">{S.inbox.title}</Link>}>
      <ClientConversation clientId={clientId} orderId={orderId} userId={userId} canWrite={canWrite} locale={locale} t={t} />
    </Card>
  );
}
