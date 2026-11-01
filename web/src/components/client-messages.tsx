import { ActionForm } from "@/components/action-form";
import { Card, Empty } from "@/components/ui";
import { replyToClient, setClientThread } from "@/app/file-actions";
import { q } from "@/lib/db/engine";
import { formatDate, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";

type Row = { id: string; from_client: boolean; body: string; created_at: string; author: string | null };

/** The conversation with a client from the customer panel: on an order that of the order, on a client the general one. */
export async function ClientMessages({ clientId, orderId, userId, canWrite, locale, t }: {
  clientId: string; orderId?: string; userId: string; canWrite: boolean; locale: Locale; t: Dict;
}) {
  const S = t.portal.staff;
  const order = orderId ?? null;
  const rows = await q<Row>(userId,
    `select m.id, m.from_client, m.body, m.created_at::text, p.full_name as author
       from client_messages m left join profiles p on p.id = m.sender_id
      where m.client_id = $1 and m.order_id is not distinct from $2::uuid order by m.created_at`, [clientId, order]);
  const [{ n }] = await q<{ n: number }>(userId, "select count(*)::int as n from client_user_list($1)", [clientId]);
  if (n === 0 && rows.length === 0) return null;
  if (canWrite && rows.some((m) => m.from_client)) await q(userId, "select client_messages_read($1, $2)", [clientId, order]);
  const [thread] = await q<{ status: string; assigned_to: string | null }>(userId, "select status, assigned_to from client_threads where client_id = $1 and order_id is not distinct from $2::uuid", [clientId, order]);
  const team = thread ? await q<{ id: string; full_name: string }>(userId, "select id, full_name from client_team()") : [];
  const I = S.inbox;
  return (
    <Card title={S.messages} id="client-messages">
      {thread && canWrite && (
        <form action={setClientThread} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="client_id" value={clientId} />
          {orderId && <input type="hidden" name="order_id" value={orderId} />}
          <label className="field"><span>{I.status}</span>
            <select name="status" defaultValue={thread.status} className="input">{(["open", "waiting", "solved"] as const).map((x) => <option key={x} value={x}>{I.statuses[x]}</option>)}</select>
          </label>
          <label className="field"><span>{I.assigned}</span>
            <select name="assigned_to" defaultValue={thread.assigned_to ?? ""} className="input"><option value="">{I.nobody}</option>{team.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
          </label>
          <button type="submit" className="btn btn-outline">{I.save}</button>
        </form>
      )}
      {rows.length === 0 && <Empty>{S.empty}</Empty>}
      {rows.map((m) => (
        <div key={m.id} className={`flex min-w-0 flex-col gap-0.5 ${m.from_client ? "items-start" : "items-end"}`}>
          <span className="text-xs text-ink-2">{m.author ?? ""} · {formatDate(locale, m.created_at.slice(0, 10))} {m.created_at.slice(11, 16)}</span>
          <p className={`m-0 max-w-[85%] min-w-0 rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap ${m.from_client ? "bg-neutral-tint" : "bg-ink text-white"}`}>{m.body}</p>
        </div>
      ))}
      {canWrite && (
        <ActionForm action={replyToClient} submitLabel={S.send}>
          <input type="hidden" name="client_id" value={clientId} />
          {orderId && <input type="hidden" name="order_id" value={orderId} />}
          <label className="field"><span className="sr-only">{S.placeholder}</span>
            <textarea name="body" required maxLength={4000} rows={3} placeholder={S.placeholder} className="input w-full resize-y" />
          </label>
        </ActionForm>
      )}
    </Card>
  );
}
