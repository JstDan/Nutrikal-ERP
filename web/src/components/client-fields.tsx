import { countryOptions } from "@/lib/calculator/countries";
import type { Dict } from "@/lib/i18n/en";
import type { Locale } from "@/lib/i18n";

/** Current values when editing a client. */
export type ClientValues = {
  legal_name: string; trade_name: string | null; status: string; country_code: string; vat_number: string | null;
  company_id: string | null; registration_address: string | null; address_line1: string | null; city: string | null;
  postal_code: string | null; billing_email: string | null; phone: string | null; website: string | null;
  preferred_locale: "bg" | "en"; credit_limit: string | null; notes: string | null;
};

/**
 * Every client detail an offer needs (company and invoice data, address, contact person) – the
 * calculator takes them from here. Used by New client (with the contact person) and Edit client.
 */
export function ClientFields({ t, locale, c, withContact }: { t: Dict; locale: Locale; c?: ClientValues; withContact?: boolean }) {
  const f = t.clients.form;
  const countries = countryOptions(locale);
  const v = (x: string | number | null | undefined) => (x == null ? "" : String(x));

  return (
    <>
      {withContact && (
        <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
          <legend className="mb-1 text-base font-bold">{f.contactSection}</legend>
          <p className="m-0 text-[13px] text-ink-2">{f.contactHint}</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="field"><span>{f.contactName} *</span><input name="contact_name" required autoComplete="off" className="input" /></label>
            <label className="field"><span>{t.clients.detail.email} *</span><input name="contact_email" type="email" required autoComplete="off" className="input" /></label>
            <label className="field"><span>{f.phone}</span><input name="contact_phone" type="tel" autoComplete="off" className="input" /></label>
          </div>
          <p className="m-0 text-[13px] text-ink-2">{f.laterHint}</p>
        </fieldset>
      )}

      <fieldset className={`m-0 flex flex-col gap-4 border-0 p-0 ${withContact ? "border-t border-mist pt-4" : ""}`}>
        <legend className="mb-2 text-base font-bold">{f.company}</legend>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="field"><span>{f.legalName}{c ? " *" : ""}</span><input name="legal_name" required={!!c} defaultValue={v(c?.legal_name)} className="input" /></label>
          <label className="field"><span>{f.tradeName}</span><input name="trade_name" defaultValue={v(c?.trade_name)} className="input" /></label>
          <label className="field"><span>{f.companyId}</span><input name="company_id" defaultValue={v(c?.company_id)} className="input" /></label>
          <label className="field"><span>{f.vatNumber}</span><input name="vat_number" defaultValue={v(c?.vat_number)} className="input" /></label>
          <label className="field md:col-span-2">
            <span>{f.registrationAddress}</span>
            <input name="registration_address" defaultValue={v(c?.registration_address)} className="input" aria-describedby="reg-address-hint" />
            <small id="reg-address-hint" className="text-xs text-ink-2">{f.registrationAddressHint}</small>
          </label>
          <label className="field"><span>{f.status}</span>
            <select name="status" className="input" defaultValue={c?.status ?? "lead"}>
              {(c ? ["lead", "active", "inactive"] as const : ["lead", "active"] as const).map((s) => (
                <option key={s} value={s}>{t.enums.clientStatus[s]}</option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-4 border-0 border-t border-mist p-0 pt-4">
        <legend className="mb-2 text-base font-bold">{f.addressSection}</legend>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="field md:col-span-2"><span>{f.address}</span><input name="address_line1" defaultValue={v(c?.address_line1)} className="input" /></label>
          <label className="field"><span>{f.city}</span><input name="city" defaultValue={v(c?.city)} className="input" /></label>
          <label className="field"><span>{f.postalCode}</span><input name="postal_code" defaultValue={v(c?.postal_code)} className="input" /></label>
          <label className="field"><span>{f.country}</span>
            <select name="country_code" className="input" defaultValue={c?.country_code ?? "BG"}>
              <optgroup label={t.calc.client.euCountries}>
                {countries.filter((x) => x.group === "eu").map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
              </optgroup>
              <optgroup label={t.calc.client.otherCountries}>
                {countries.filter((x) => x.group === "other").map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
              </optgroup>
            </select>
          </label>
          <label className="field"><span>{f.phone}</span><input name="phone" type="tel" defaultValue={v(c?.phone)} className="input" /></label>
          <label className="field"><span>{f.billingEmail}</span><input name="billing_email" type="email" defaultValue={v(c?.billing_email)} className="input" /></label>
          <label className="field"><span>{f.website}</span><input name="website" type="url" defaultValue={v(c?.website)} className="input" placeholder="https://" /></label>
        </div>
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-4 border-0 border-t border-mist p-0 pt-4">
        <legend className="mb-2 text-base font-bold">{f.terms}</legend>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="field"><span>{f.creditLimit}</span><input name="credit_limit" type="number" min={0} step="100" defaultValue={v(c?.credit_limit)} className="input" /></label>
        </div>
        <label className="field"><span>{f.notes}</span><textarea name="notes" defaultValue={v(c?.notes)} className="input" /></label>
      </fieldset>
    </>
  );
}
