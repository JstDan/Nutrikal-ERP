"use client";

import Link from "next/link";
import { fixedCostsFor, packagingExtraCost, usesCatalogPackaging } from "@/lib/calculator/calc";
import { ALUMINIUM_LID_EUR, GLASS_JAR_EUR } from "@/lib/calculator/catalogCapsules";
import type { CrmClient } from "@/lib/calculator/db";
import { SALES_PERSONS } from "@/lib/calculator/salesPersons";
import { PRODUCT_TYPES, isCapsule, type FixedCosts, type LidType, type OfferForm, type ProductType } from "@/lib/calculator/types";
import { fieldId, type FieldKey } from "@/lib/calculator/validation";
import { fmt } from "@/lib/i18n";
import { Field, Section, SubHeading, inputClass, useCalcText } from "./kit";
import { SearchCombobox } from "./search-combobox";

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

const clientText = (c: CrmClient) => `${c.name} ${c.contactName} ${c.email} ${c.contactEmail} ${c.vatNumber}`;
const clientKey = (c: CrmClient) => c.id;

/**
 * Step 2: the client (from CRM, searchable) and the offer number / dates. The client's details are
 * kept in Clients; picking the client copies them into the offer (snapshot for the PDF).
 */
export function ClientSection({ form, setForm, errorFor, touch, clients }: SectionProps & { clients: CrmClient[] }) {
  const { t } = useCalcText();
  const setOffer = (patch: Partial<OfferForm["offer"]>) => setForm((f) => ({ ...f, offer: { ...f.offer, ...patch } }));
  const error = errorFor("client");
  const picked = form.clientId ? clients.find((c) => c.id === form.clientId) : undefined;
  const r = form.receiver;
  const inv = form.invoice;

  const pick = (c: CrmClient) => {
    setForm((f) => ({
      ...f,
      clientId: c.id,
      receiver: {
        fullName: c.contactName,
        email: c.contactEmail || c.email,
        phone: c.contactPhone || c.phone,
        address: c.address,
        city: c.city,
        zip: c.zip,
        country: c.country,
      },
      invoice: {
        companyName: c.companyName,
        identificationNo: c.identificationNo,
        vatNumber: c.vatNumber,
        registrationAddress: c.registrationAddress || [c.address, [c.zip, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      },
    }));
    touch("client");
  };

  return (
    <Section step={2} title={t.client.section} id={fieldId("client")} required>
      <Field
        label={t.client.pick}
        htmlFor="crm-client"
        required
        error={error}
        hint={<>{clients.length ? t.client.pickHint : t.client.noClients} <Link href="/clients/new" className="font-semibold text-ink">+ {t.client.newClient}</Link></>}
      >
        <SearchCombobox
          id="crm-client"
          items={clients}
          searchText={clientText}
          optionKey={clientKey}
          onPick={pick}
          placeholder={t.client.pickPlaceholder}
          listLabel={t.client.pick}
          noResults={t.client.noResults}
          invalid={!!error}
          renderOption={(c) => (
            <span className="min-w-0 flex-1 break-words">
              {c.name}
              {(c.contactName || c.country) && <span className="block text-xs text-ink-2">{[c.contactName, c.country].filter(Boolean).join(" · ")}</span>}
            </span>
          )}
        />
      </Field>

      {form.clientId && (
        <div className="flex flex-col gap-2 rounded-sm border-2 border-ink p-4 text-sm">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-[1_1_240px]">
              <div className="text-base font-bold break-words">{inv.companyName || r.fullName}</div>
              <div className="text-ink-2 break-words">
                {[inv.registrationAddress || [r.address, [r.zip, r.city].filter(Boolean).join(" ")].filter(Boolean).join(", "), r.country].filter(Boolean).join(" · ")}
              </div>
            </div>
            <Link href={`/clients/${form.clientId}`} className="btn btn-outline">{t.client.editInClients}</Link>
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            <div className="min-w-0 break-words"><span className="text-ink-2">{t.client.contactPerson}: </span>{r.fullName || "–"}</div>
            <div className="min-w-0 break-all"><span className="text-ink-2">{t.client.email}: </span>{r.email || "–"}</div>
            <div className="min-w-0 break-words"><span className="text-ink-2">{t.client.phone}: </span>{r.phone || "–"}</div>
            <div className="min-w-0 break-words"><span className="text-ink-2">{t.client.vatNumber}: </span>{inv.vatNumber || "–"}</div>
            <div className="min-w-0 break-words"><span className="text-ink-2">{t.client.identificationNo}: </span>{inv.identificationNo || "–"}</div>
          </div>
          {!picked && <p className="m-0 text-xs text-amber-ink">{t.client.notInCrm}</p>}
        </div>
      )}

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

const LIDS: LidType[] = ["plastic", "aluminium"];

/** Step 3: product type (capsules in glass / plastic, or powder) with its fixed cost per unit; then the lid of a jar. */
export function ProductTypeSection({ form, setForm, errorFor, fixedCosts: settingsCosts }: SectionProps & { fixedCosts: FixedCosts }) {
  const { t, eur } = useCalcText();
  const error = errorFor("productType");
  // From a catalog product: jar and lid at the catalog's prices (glass jar = plastic + its extra, with aluminium lid)
  const catalogPrices = usesCatalogPackaging(form);
  const fixedCosts = fixedCostsFor({ ...form, productType: "capsules_plastic" }, settingsCosts);
  const lidChoice = isCapsule(form.productType) && !(catalogPrices && form.productType === "capsules_glass");
  const alu = packagingExtraCost({ ...form, productType: "capsules_plastic", lid: "aluminium" });

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
                {form.catalogPackaging && p === "capsules_glass" && <span className="text-ink-2">{fmt(t.productType.glassExtra, { price: eur(GLASS_JAR_EUR) })}</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
      <p id="product-type-msg" className={`m-0 text-xs ${error ? "font-semibold text-red-ink" : "text-ink-2"}`}>
        {error ?? t.productType.fixedCostHint}
      </p>
      {catalogPrices && (
        <p className="m-0 text-xs text-ink-2">
          {fmt(t.productType.catalogPackaging, { lid: eur(ALUMINIUM_LID_EUR), glass: eur(GLASS_JAR_EUR) })}
        </p>
      )}
      {lidChoice && (
        <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 border-t border-mist p-0 pt-4">
          <legend className="contents">
            <SubHeading>{t.catalog.lid}</SubHeading>
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {LIDS.map((l) => {
              const selected = form.lid === l;
              return (
                <label
                  key={l}
                  className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-sm border-2 p-3 ${selected ? "border-ink bg-canvas" : "border-line hover:border-line-strong"}`}
                >
                  <input type="radio" name="custom-lid" value={l} checked={selected} onChange={() => setForm((f) => ({ ...f, lid: l }))} className="mt-1 h-5 w-5 shrink-0 accent-ink" />
                  <span className="flex min-w-0 flex-col gap-0.5 text-sm">
                    <span className="font-semibold">{t.catalog[`lid_${l}`]}</span>
                    <span className="text-ink-2">{l === "aluminium" ? fmt(t.productType.lidCost, { price: eur(alu) }) : t.productType.lidIncluded}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
    </Section>
  );
}
