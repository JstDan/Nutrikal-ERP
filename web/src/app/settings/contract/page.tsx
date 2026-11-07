import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { formatDate } from "@/lib/i18n";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { SettingsTabs } from "@/components/settings-tabs";
import { saveContractTemplate } from "@/app/contract-actions";

/** Settings > Contract: the text of the production contract in both languages (Admin). */
export default async function ContractSettingsPage() {
  const { user, locale, t } = await requireRole("admin");
  const S = t.contract.settings;
  const rows = await q<{ locale: "bg" | "en"; body: string; updated_at: string; name: string | null }>(user.id,
    "select t.locale, t.body, t.updated_at::text, p.full_name as name from contract_templates t left join profiles p on p.id = t.updated_by order by t.locale");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.adminSettings.title} subtitle={t.adminSettings.subtitle} />
      <SettingsTabs t={t} active="contract" />
      <Card title={S.title} id="contract-tpl-h">
        <p className="m-0 text-sm text-ink-2">{S.hint}</p>
        <p className="m-0 rounded-sm bg-amber-tint p-3 text-sm text-amber-ink">{S.lawyer}</p>
        {rows.map((r) => (
          <ActionForm key={r.locale} action={saveContractTemplate} submitLabel={S.save} resetOnSuccess={false}>
            <input type="hidden" name="locale" value={r.locale} />
            <label className="field"><span>{r.locale === "bg" ? S.bg : S.en} · {formatDate(locale, r.updated_at)}{r.name ? ` · ${r.name}` : ""}</span>
              <textarea name="body" className="input font-mono text-[13px]" rows={22} defaultValue={r.body} readOnly={user.readOnly} />
            </label>
          </ActionForm>
        ))}
      </Card>
    </div>
  );
}
