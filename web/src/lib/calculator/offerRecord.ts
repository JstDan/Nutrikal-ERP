import { calcInputFromForm, calculate, type CalcResult } from './calc';
import { LEGACY_WASTE_PCT, normalizeForm } from './form';
import type { FixedCosts, OfferForm, OfferInput, OfferRecord, Settings } from './types';

/** A saved offer as the calculator form and its result, recalculated from the stored snapshot (prices + fixed costs at the time of saving). */
export function fromOfferRecord(x: OfferRecord, settings: Settings): { form: OfferForm; result: CalcResult } {
  const form = normalizeForm({ ...x.data, waste: x.data.waste ?? LEGACY_WASTE_PCT, offer: { ...x.data.offer, offerNo: x.offer_no } }, settings);
  return { form, result: calculate(calcInputFromForm(form, form.fixedCosts ?? settings.fixed_costs)) };
}

/** The product as named on the offer: the typed name, else (catalog) the catalog product's code and name. */
export function productName(form: OfferForm): string {
  const typed = form.offer.productName.trim();
  if (typed || form.mode !== 'catalog' || !form.catalog) return typed;
  return `${form.catalog.code} ${form.catalog.name}`;
}

/** Build the database record for an offer. Stores a snapshot of prices and fixed costs used. */
export function toOfferInput(form: OfferForm, result: CalcResult, currentFixedCosts: FixedCosts): OfferInput {
  const data: OfferForm = { ...form, fixedCosts: form.fixedCosts ?? currentFixedCosts };
  return {
    id: form.id,
    offer_no: form.offer.offerNo.trim(),
    receiver_name: form.receiver.fullName.trim() || form.invoice.companyName.trim(),
    receiver_email: form.receiver.email.trim(),
    client_id: form.clientId,
    company_name: form.invoice.companyName.trim() || null,
    product_name: productName(form) || null,
    product_type: form.mode === 'catalog' ? null : form.productType,
    total_excl_vat: result.totalPriceExclVat,
    total_incl_vat: result.totalInclVat,
    data,
    results: result,
  };
}
