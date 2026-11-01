import { ActionForm } from "@/components/action-form";
import { Card, Empty } from "@/components/ui";
import { createClientUser, resetUserPassword, setClientUserActive } from "@/app/user-actions";
import { q } from "@/lib/db/engine";
import type { Dict } from "@/lib/i18n/en";

type Row = { user_id: string; full_name: string; email: string; is_active: boolean };

/** Who of this client can sign in to the customer panel. Admin makes and stops the accounts. */
export async function ClientPortalAccess({ clientId, userId, isAdmin, t }: { clientId: string; userId: string; isAdmin: boolean; t: Dict }) {
  const S = t.portal.staff;
  const rows = await q<Row>(userId, "select user_id, full_name, email, is_active from client_user_list($1)", [clientId]);
  return (
    <Card title={S.accessTitle} id="portal-access">
      {rows.length === 0 && <Empty>{S.accessEmpty}</Empty>}
      {rows.map((x) => (
        <div key={x.user_id} className="flex flex-wrap items-center justify-between gap-x-3 border-b border-mist py-1 text-sm last:border-0">
          <span className="flex min-h-11 min-w-0 flex-col justify-center">
            <span className="font-semibold break-words">{x.full_name}{x.is_active ? "" : ` · ${S.stopped}`}</span>
            <span className="text-xs break-all text-ink-2">{x.email}</span>
          </span>
          {isAdmin && (
            <span className="flex flex-col gap-1">
              <form action={setClientUserActive}>
                <input type="hidden" name="id" value={x.user_id} />
                <input type="hidden" name="active" value={x.is_active ? "" : "on"} />
                <button type="submit" className="min-h-11 text-xs text-ink-2 underline">{x.is_active ? S.stop : S.restore}</button>
              </form>
              <ActionForm action={resetUserPassword} submitLabel={S.reset} resetOnSuccess={false}>
                <input type="hidden" name="id" value={x.user_id} />
              </ActionForm>
            </span>
          )}
        </div>
      ))}
      {isAdmin && (
        <ActionForm action={createClientUser} submitLabel={S.create}>
          <input type="hidden" name="client_id" value={clientId} />
          <label className="field"><span>{S.name} *</span><input name="full_name" required className="input" /></label>
          <label className="field"><span>{S.email} *</span><input name="email" type="email" required className="input" /></label>
        </ActionForm>
      )}
    </Card>
  );
}
