import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { ActionForm } from "@/components/action-form";
import { Card, Chip, PageHeader } from "@/components/ui";
import { SettingsTabs } from "@/components/settings-tabs";
import { createUser, resetUserPassword, saveUser } from "@/app/user-actions";
import { supabaseConfigured } from "@/lib/supabase/server";
import { SignatureEditor } from "@/components/signature-editor";
import { cleanSignature } from "@/lib/signature";
import { fmt } from "@/lib/i18n";
import { AvatarEditor } from "@/components/avatar-editor";
import { UserAvatar } from "@/components/user-avatar";

const ROLES = ["admin", "sales", "bookkeeper", "accountant", "designer", "production"] as const;
type Row = { id: string; full_name: string; email: string; role: string; is_active: boolean; can_see_purchase_prices: boolean; signature: string | null; avatar_path: string | null; avatar_updated_at: string | null };

/** Who works in the system. Accounts are created here, with a first password to pass on. */
export default async function UsersPage() {
  const { user, t } = await requireRole("admin");
  const S = t.adminSettings;
  const U = S.users;
  const rows = await q<Row>(user.id,
    `select p.id, p.full_name, p.email::text, p.role::text, p.is_active, p.can_see_purchase_prices, s.html as signature, p.avatar_path, p.avatar_updated_at::text
       from profiles p left join mail_signatures s on s.user_id = p.id
      where p.role <> 'client' order by p.is_active desc, lower(p.full_name)`);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={S.title} subtitle={S.subtitle} />
      <SettingsTabs t={t} active="users" />
      <Card title={U.title} id="users-h">
        <p className="m-0 text-sm text-ink-2">{U.note}</p>
        {rows.map((x) => (
          <details key={x.id} className="min-w-0 border-t border-mist pt-2">
            <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <UserAvatar id={x.id} v={x.avatar_updated_at} size={28} />
              <span className="min-w-0 font-semibold break-words">{x.full_name}</span>
              <span className="min-w-0 text-ink-2 break-all">{x.email}</span>
              <Chip tone={x.is_active ? "green" : "neutral"}>{x.is_active ? t.enums.role[x.role as "admin"] : U.inactive}</Chip>
            </summary>
            {x.role === "developer" ? <p className="m-0 mt-2 text-sm text-ink-2">{U.developer}</p> : (
              <div className="mt-3 flex flex-col gap-3">
                <AvatarEditor userId={x.id} name={fmt(t.avatar.ofUser, { name: x.full_name })} version={x.avatar_updated_at} hasPhoto={!!x.avatar_path} T={t.avatar} />
                <ActionForm action={saveUser} submitLabel={t.common.save} resetOnSuccess={false}>
                  <input type="hidden" name="id" value={x.id} />
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="field"><span>{U.name} *</span><input name="full_name" required defaultValue={x.full_name} className="input" /></label>
                    <label className="field"><span>{U.role}</span>
                      <select name="role" defaultValue={x.role} className="input">{ROLES.map((r) => <option key={r} value={r}>{t.enums.role[r]}</option>)}</select>
                    </label>
                  </div>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                    <input type="checkbox" name="prices" defaultChecked={x.can_see_purchase_prices} className="h-5 w-5 shrink-0 accent-ink" /><span>{U.prices}</span>
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                    <input type="checkbox" name="active" defaultChecked={x.is_active} className="h-5 w-5 shrink-0 accent-ink" /><span>{U.active}</span>
                  </label>
                </ActionForm>
                {/* Admin can fill in anyone's e-mail signature; Production sends no documents */}
                {x.role !== "production" && (
                  <div className="border-t border-mist pt-3">
                    <SignatureEditor userId={x.id} initial={cleanSignature(x.signature ?? "")} text={t.signature} label={fmt(t.signature.ofUser, { name: x.full_name })} />
                  </div>
                )}
                {supabaseConfigured() && (
                  <ActionForm action={resetUserPassword} submitLabel={U.resetPassword} resetOnSuccess={false}>
                    <input type="hidden" name="id" value={x.id} />
                  </ActionForm>
                )}
              </div>
            )}
          </details>
        ))}
      </Card>
      <Card title={U.newTitle} id="new-user-h">
        {!supabaseConfigured() && <p className="m-0 text-sm font-semibold">{U.liveOnly}</p>}
        <p className="m-0 text-sm text-ink-2">{U.roles}</p>
        <ActionForm action={createUser} submitLabel={U.create}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="field"><span>{U.name} *</span><input name="full_name" required className="input" /></label>
            <label className="field"><span>{U.email} *</span><input name="email" type="email" required className="input" /></label>
            <label className="field"><span>{U.role}</span>
              <select name="role" defaultValue="sales" className="input">{ROLES.map((r) => <option key={r} value={r}>{t.enums.role[r]}</option>)}</select>
            </label>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
