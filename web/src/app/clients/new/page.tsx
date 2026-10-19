import Link from "next/link";
import { requireRole } from "@/lib/session";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { createClient } from "@/app/actions";

export default async function NewClientPage() {
  const { t } = await requireRole("admin", "sales");
  const f = t.clients.form;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={f.title} crumb={<Link href="/clients" className="text-ink-2">{t.clients.title}</Link>} />
      <Card>
        <ActionForm action={createClient} submitLabel={f.submit} resetOnSuccess={false}>
          <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
            <legend className="mb-2 text-base font-bold">{f.company}</legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="field"><span>{f.legalName} *</span><input name="legal_name" required className="input" /></label>
              <label className="field"><span>{f.tradeName}</span><input name="trade_name" className="input" /></label>
              <label className="field"><span>{f.country} *</span><input name="country_code" required maxLength={2} defaultValue="BG" className="input uppercase" aria-describedby="cc-hint" /><small id="cc-hint" className="text-xs text-ink-2">{f.countryHint}</small></label>
              <label className="field"><span>{f.vatNumber}</span><input name="vat_number" className="input" /></label>
              <label className="field"><span>{f.companyId}</span><input name="company_id" className="input" /></label>
              <label className="field"><span>{f.status}</span>
                <select name="status" className="input" defaultValue="lead">
                  <option value="lead">{t.enums.clientStatus.lead}</option>
                  <option value="active">{t.enums.clientStatus.active}</option>
                </select>
              </label>
              <label className="field md:col-span-2"><span>{f.address}</span><input name="address_line1" className="input" /></label>
              <label className="field"><span>{f.city}</span><input name="city" className="input" /></label>
              <label className="field"><span>{f.postalCode}</span><input name="postal_code" className="input" /></label>
              <label className="field"><span>{f.billingEmail}</span><input name="billing_email" type="email" className="input" /></label>
              <label className="field"><span>{f.phone}</span><input name="phone" type="tel" className="input" /></label>
              <label className="field"><span>{f.website}</span><input name="website" type="url" className="input" placeholder="https://" /></label>
              <label className="field"><span>{f.locale}</span>
                <select name="preferred_locale" className="input" defaultValue="en">
                  <option value="en">{t.enums.locale.en}</option>
                  <option value="bg">{t.enums.locale.bg}</option>
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="m-0 flex flex-col gap-4 border-0 border-t border-mist p-0 pt-4">
            <legend className="mb-1 text-base font-bold">{f.terms}</legend>
            <p className="m-0 text-[13px] text-ink-2">{f.termsHint}</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <label className="field"><span>{f.depositPct}</span><input name="deposit_pct" type="number" min={0} max={100} step="1" className="input" /></label>
              <label className="field"><span>{f.balanceTerms}</span>
                <select name="balance_terms" className="input" defaultValue="">
                  <option value="">—</option>
                  <option value="before_dispatch">{t.enums.balanceTermsOption.before_dispatch}</option>
                  <option value="net_days">{t.enums.balanceTermsOption.net_days}</option>
                </select>
              </label>
              <label className="field"><span>{f.netDays}</span><input name="balance_net_days" type="number" min={0} className="input" /></label>
              <label className="field"><span>{f.creditLimit}</span><input name="credit_limit" type="number" min={0} step="100" className="input" /></label>
            </div>
            <label className="field"><span>{f.notes}</span><textarea name="notes" className="input" /></label>
          </fieldset>
        </ActionForm>
      </Card>
    </div>
  );
}
