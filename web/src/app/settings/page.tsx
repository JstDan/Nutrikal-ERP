import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { SettingsTabs } from "@/components/settings-tabs";
import { saveGeneralSettings } from "@/app/batch-actions";

/** General settings of the system. */
export default async function SettingsPage() {
  const { user, t } = await requireRole("admin");
  const S = t.adminSettings;
  const { c, next } = await withUser(user.id, async (tx) => ({
    c: (await tx.query<{ production_variance_pct: string | null; require_waybill_photo: boolean; expiry_warning_days: number }>(
      "select production_variance_pct::text, require_waybill_photo, expiry_warning_days from company_settings limit 1")).rows[0],
    next: (await tx.query<{ next_number: string }>("select next_number::text from number_series where key = 'invoice'")).rows[0]?.next_number,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={S.title} subtitle={S.subtitle} />
      <SettingsTabs t={t} active="general" />
      <Card title={S.general} id="general-h">
        <ActionForm action={saveGeneralSettings} submitLabel={t.common.save} resetOnSuccess={false}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="field"><span>{S.tolerance}</span>
              <input name="tolerance" type="number" min={0} max={100} step="any" defaultValue={c?.production_variance_pct ?? 5} className="input" aria-describedby="tol-hint" />
              <small id="tol-hint" className="text-xs text-ink-2">{S.toleranceHint}</small>
            </label>
            <label className="field"><span>{S.expiryDays}</span>
              <input name="expiry_days" type="number" min={1} step={1} defaultValue={c?.expiry_warning_days ?? 90} className="input" />
            </label>
            <label className="field"><span>{S.nextInvoice}</span>
              <input name="next_invoice" type="number" min={1} step={1} defaultValue={next} className="input" aria-describedby="inv-hint" />
              <small id="inv-hint" className="text-xs text-ink-2">{S.nextInvoiceHint}</small>
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start text-sm font-semibold md:mt-6">
              <input name="waybill" type="checkbox" defaultChecked={c?.require_waybill_photo ?? true} className="h-5 w-5 shrink-0 accent-ink" />
              <span>{S.waybill}</span>
            </label>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
