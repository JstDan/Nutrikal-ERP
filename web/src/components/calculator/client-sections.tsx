"use client";

import { useMemo } from "react";
import type { CrmClient } from "@/lib/calculator/db";
import { countryOptions } from "@/lib/calculator/countries";
import { SALES_PERSONS } from "@/lib/calculator/salesPersons";
import { PRODUCT_TYPES, isCapsule, type FixedCosts, type OfferForm, type ProductType } from "@/lib/calculator/types";
import { fieldId, type FieldKey } from "@/lib/calculator/validation";
import { Field, Section, SubHeading, inputClass, useCalcText } from "./kit";

export interface SectionProps {
  form: OfferForm;
  setForm: (updater: (f: OfferForm) => OfferForm) => void;
  /** Error message to show for a field (only once touched or after a save/PDF attempt). */
  errorFor: (key: FieldKey) => string | undefined;
  touch: (key: FieldKey) => void;
}

/** Step 1: Nutrikal contact person for the offer (name, phone) and the shared sales email. */
export function ContactSection({ form, setForm, email }: SectionProps & { email: string }) {
  const { t } = useCalcText();
  const c = form.contact;
  const setContact = (patch: Partial<OfferForm["contact"]>) => setForm((f) => ({ ...f, contact: { ...f.contact, ...patch } }));

  return (
    <Section step={1} title={t.contact.section}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
        <Field label={t.contact.name} htmlFor="contact-name" className="sm:col-span-5">
          <input
            id="contact-name"
            list="sales-persons"
            autoComplete="off"
            value={c.name}
            onChange={(e) => {
              // Picking a sales person fills in their phone number.
              const person = SALES_PERSONS.find((p) => p.name === e.target.value);
              setContact(person ? { name: person.name, phone: person.phone } : { name: e.target.value });
            }}
            className="input"
          />
          <datalist id="sales-persons">
            {SALES_PERSONS.map((p) => <option key={p.name} value={p.name} />)}
          </datalist>
        </Field>
        <Field label={t.contact.phone} htmlFor="contact-phone" className="sm:col-span-4">
          <input id="contact-phone" type="tel" autoComplete="off" value={c.phone} onChange={(e) => setContact({ phone: e.target.value })} className="input" />
        </Field>
        <Field label={t.contact.email} htmlFor="contact-email" className="sm:col-span-3">
          <input id="contact-email" value={email} readOnly className="input bg-canvas!" />
        </Field>
      </div>
    </Section>
  );
}

/** Step 2: receiver, invoice details and offer number / dates. */
export function ClientSection({ form, setForm, errorFor, touch, clients }: SectionProps & { clients: CrmClient[] }) {
  const { t, locale } = useCalcText();
  const countries = useMemo(() => countryOptions(locale), [locale]);
  const setReceiver = (patch: Partial<OfferForm["receiver"]>) => setForm((f) => ({ ...f, receiver: { ...f.receiver, ...patch } }));
  const setInvoice = (patch: Partial<OfferForm["invoice"]>) => setForm((f) => ({ ...f, invoice: { ...f.invoice, ...patch } }));
  const setOffer = (patch: Partial<OfferForm["offer"]>) => setForm((f) => ({ ...f, offer: { ...f.offer, ...patch } }));

  const r = form.receiver;
  const nameError = errorFor("receiver.fullName");
  const emailError = errorFor("receiver.email");
  const known = countries.some((c) => c.name === r.country);

  const fillFromClient = (id: string) => {
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    setForm((f) => ({
      ...f,
      receiver: {
        ...f.receiver,
        fullName: c.contactName || f.receiver.fullName,
        email: c.contactEmail || c.email || f.receiver.email,
        phone: c.contactPhone || c.phone || f.receiver.phone,
        address: c.address,
        city: c.city,
        zip: c.zip,
        country: c.country,
      },
      invoice: {
        companyName: c.companyName,
        identificationNo: c.identificationNo,
        vatNumber: c.vatNumber,
        registrationAddress: [c.address, [c.zip, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      },
    }));
  };

  return (
    <Section step={2} title={t.client.section}>
      {clients.length > 0 && (
        <Field label={t.client.fromCrm} htmlFor="crm-client" hint={t.client.fromCrmHint}>
          <select
            id="crm-client"
            value=""
            onChange={(e) => fillFromClient(e.target.value)}
            aria-describedby="crm-client-msg"
            className="input"
          >
            <option value="">{t.client.fromCrmNone}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}

      <div className="flex flex-col gap-3">
        <SubHeading>{t.client.receiver}</SubHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
          <Field label={t.client.fullName} htmlFor={fieldId("receiver.fullName")} required error={nameError} className="sm:col-span-6">
            <input
              id={fieldId("receiver.fullName")}
              autoComplete="off"
              value={r.fullName}
              onChange={(e) => setReceiver({ fullName: e.target.value })}
              onBlur={() => touch("receiver.fullName")}
              aria-invalid={!!nameError || undefined}
              aria-describedby={nameError ? `${fieldId("receiver.fullName")}-msg` : undefined}
              className={inputClass(!!nameError)}
            />
          </Field>
          <Field label={t.client.email} htmlFor={fieldId("receiver.email")} required error={emailError} className="sm:col-span-6">
            <input
              id={fieldId("receiver.email")}
              type="email"
              autoComplete="off"
              value={r.email}
              onChange={(e) => setReceiver({ email: e.target.value })}
              onBlur={() => touch("receiver.email")}
              aria-invalid={!!emailError || undefined}
              aria-describedby={emailError ? `${fieldId("receiver.email")}-msg` : undefined}
              className={inputClass(!!emailError)}
            />
          </Field>
          <Field label={t.client.address} htmlFor="receiver-address" className="sm:col-span-12">
            <input id="receiver-address" value={r.address} onChange={(e) => setReceiver({ address: e.target.value })} className="input" />
          </Field>
          <Field label={t.client.city} htmlFor="receiver-city" className="sm:col-span-5">
            <input id="receiver-city" value={r.city} onChange={(e) => setReceiver({ city: e.target.value })} className="input" />
          </Field>
          <Field label={t.client.zip} htmlFor="receiver-zip" className="sm:col-span-3">
            <input id="receiver-zip" value={r.zip} onChange={(e) => setReceiver({ zip: e.target.value })} className="input" />
          </Field>
          <Field label={t.client.country} htmlFor="receiver-country" className="sm:col-span-4">
            <select id="receiver-country" value={r.country} onChange={(e) => setReceiver({ country: e.target.value })} className="input">
              <option value="">—</option>
              {!known && r.country && <option value={r.country}>{r.country}</option>}
              <optgroup label={t.client.euCountries}>
                {countries.filter((c) => c.group === "eu").map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
              </optgroup>
              <optgroup label={t.client.otherCountries}>
                {countries.filter((c) => c.group === "other").map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
              </optgroup>
            </select>
          </Field>
          <Field label={t.client.phone} htmlFor="receiver-phone" className="sm:col-span-6">
            <input id="receiver-phone" type="tel" value={r.phone} onChange={(e) => setReceiver({ phone: e.target.value })} className="input" />
          </Field>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-mist pt-5">
        <SubHeading>{t.client.invoice}</SubHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t.client.companyName} htmlFor="invoice-company">
            <input id="invoice-company" value={form.invoice.companyName} onChange={(e) => setInvoice({ companyName: e.target.value })} className="input" />
          </Field>
          <Field label={t.client.identificationNo} htmlFor="invoice-id">
            <input id="invoice-id" value={form.invoice.identificationNo} onChange={(e) => setInvoice({ identificationNo: e.target.value })} className="input" />
          </Field>
          <Field label={t.client.vatNumber} htmlFor="invoice-vat">
            <input id="invoice-vat" value={form.invoice.vatNumber} onChange={(e) => setInvoice({ vatNumber: e.target.value })} className="input" />
          </Field>
          <Field label={t.client.registrationAddress} htmlFor="invoice-address" className="sm:col-span-2">
            <input
              id="invoice-address"
              value={form.invoice.registrationAddress}
              onChange={(e) => setInvoice({ registrationAddress: e.target.value })}
              className="input"
            />
          </Field>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-mist pt-5">
        <SubHeading>{t.client.offerDetails}</SubHeading>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label={t.client.offerNo} htmlFor="offer-no" className="col-span-2 sm:col-span-1">
            <input id="offer-no" value={form.offer.offerNo} onChange={(e) => setOffer({ offerNo: e.target.value })} className="input" />
          </Field>
          <Field label={t.client.offerDate} htmlFor="offer-date">
            <input id="offer-date" type="date" value={form.offer.offerDate} onChange={(e) => setOffer({ offerDate: e.target.value })} className="input" />
          </Field>
          <Field label={t.client.validUntil} htmlFor="offer-valid">
            <input id="offer-valid" type="date" value={form.offer.validUntil} onChange={(e) => setOffer({ validUntil: e.target.value })} className="input" />
          </Field>
          <Field label={t.client.productName} htmlFor="offer-product" className="col-span-2 sm:col-span-3">
            <input
              id="offer-product"
              placeholder={t.client.productNamePlaceholder}
              value={form.offer.productName}
              onChange={(e) => setOffer({ productName: e.target.value })}
              className="input"
            />
          </Field>
        </div>
      </div>
    </Section>
  );
}

/** Step 3: product type (capsules in glass / plastic, or powder) with its fixed cost per unit. */
export function ProductTypeSection({ form, setForm, errorFor, fixedCosts }: SectionProps & { fixedCosts: FixedCosts }) {
  const { t, eur } = useCalcText();
  const error = errorFor("productType");

  const select = (p: ProductType) =>
    setForm((f) => {
      // Switching between capsules and powder: rows without an amount follow the new default unit.
      const unitChanged = isCapsule(p) !== isCapsule(f.productType) || !f.productType;
      const unit = p === "powder" ? "g" : "mg";
      return { ...f, productType: p, rows: unitChanged ? f.rows.map((r) => (r.amount.trim() ? r : { ...r, unit })) : f.rows };
    });

  return (
    <Section step={3} title={t.productType.section} id={fieldId("productType")} required>
      <fieldset className="m-0 grid grid-cols-1 gap-3 border-0 p-0 sm:grid-cols-3" aria-describedby="product-type-msg">
        <legend className="sr-only">{t.productType.section}</legend>
        {PRODUCT_TYPES.map((p) => {
          const selected = form.productType === p;
          return (
            <label
              key={p}
              className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-sm border-2 p-3 ${
                selected ? "border-ink bg-canvas" : error ? "border-red" : "border-line hover:border-line-strong"
              }`}
            >
              <input type="radio" name="product-type" value={p} checked={selected} onChange={() => select(p)} className="mt-1 h-5 w-5 shrink-0 accent-ink" />
              <span className="flex min-w-0 flex-col gap-0.5 text-sm">
                <span className="font-semibold">{t.productType[p]}</span>
                <span className="text-ink-2">{t.productType.packaging}: {t.productType[`packaging_${p}`]}</span>
                <span className="text-ink-2">{t.productType.fixedCost}: <b className="text-ink">{eur(fixedCosts[p])}</b></span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <p id="product-type-msg" className={`m-0 text-xs ${error ? "font-semibold text-red-ink" : "text-ink-2"}`}>
        {error ?? t.productType.fixedCostHint}
      </p>
    </Section>
  );
}
