import { calcInputFromForm, calculate, type CalcResult } from './calc';
import { normalizeForm } from './form';
import type { FixedCosts, OfferForm, OfferInput, OfferRecord, Settings } from './types';

/** A saved offer as the calculator form and its result, recalculated from the stored snapshot (prices + fixed costs at the time of saving). */
export function fromOfferRecord(x: OfferRecord, settings: Settings): { form: OfferForm; result: CalcResult } {
  const form = normalizeForm({ ...x.data, offer: { ...x.data.offer, offerNo: x.offer_no } }, settings);
  return { form, result: calculate(calcInputFromForm(form, form.fixedCosts ?? settings.fixed_costs)) };
}

/** Build the database record for an offer. Stores a snapshot of prices and fixed costs used. */
export function toOfferInput(form: OfferForm, result: CalcResult, currentFixedCosts: FixedCosts): OfferInput {
  const data: OfferForm = { ...form, fixedCosts: form.fixedCosts ?? currentFixedCosts };
  return {
    id: form.id,
    offer_no: form.offer.offerNo.trim(),
    receiver_name: form.receiver.fullName.trim(),
    receiver_email: form.receiver.email.trim(),
    company_name: form.invoice.companyName.trim() || null,
    product_name: form.offer.productName.trim() || null,
    product_type: form.productType,
    total_excl_vat: result.totalPriceExclVat,
    total_incl_vat: result.totalInclVat,
    data,
    results: result,
  };
}
