import { DEFAULT_COUNTRY } from './countries';
import { isoDate } from './numbers';
import type { OfferForm, Settings } from './types';

/** localStorage key of the unsaved calculator form (survives a page refresh). */
export const DRAFT_KEY = 'nk.calc.draft';
/** The draft as last opened, started or saved – tells whether the draft has unsaved changes. */
export const BASELINE_KEY = 'nk.calc.draftBaseline';

/** Earlier default payment terms – unsaved drafts that still carry one get the current default. */
const OLD_DEFAULT_TERMS = [
  '100% advance payment',
  '50% Down Payment and 50% Balance Payment when goods are ready to be shipped',
];

export function createEmptyForm(settings: Settings, offerNo: string): OfferForm {
  return {
    id: null,
    mode: 'custom',
    catalog: null,
    contact: { name: '', phone: '' },
    receiver: { fullName: '', address: '', city: '', zip: '', country: DEFAULT_COUNTRY, phone: '', email: '' },
    invoice: { companyName: '', identificationNo: '', registrationAddress: '', vatNumber: '' },
    offer: { offerNo, offerDate: isoDate(0), validUntil: isoDate(30), productName: '' },
    productType: null,
    rows: [],
    capsulesPerDose: '1',
    capsuleSize: 'size0',
    maxFillMg: '500',
    quantityPerUnit: '',
    numberOfUnits: '',
    markup: String(settings.default_markup),
    addVat: false,
    vatRate: String(settings.default_vat_rate),
    discount: '0',
    extraItems: [],
    priceTiers: [],
    paymentTerms: settings.default_payment_terms,
    includeComposition: true,
    notes: '',
    fixedCosts: null,
  };
}

/** Fill fields added after a draft/offer was saved, so older offers keep working. */
export function normalizeForm(f: OfferForm, settings: Settings): OfferForm {
  const empty = createEmptyForm(settings, f.offer?.offerNo ?? '');
  return {
    ...empty,
    ...f,
    contact: { ...empty.contact, ...f.contact },
    receiver: { ...empty.receiver, ...f.receiver },
    invoice: { ...empty.invoice, ...f.invoice },
    offer: { ...empty.offer, ...f.offer },
    mode: f.mode === 'catalog' ? 'catalog' : 'custom',
    catalog: f.catalog ?? null,
    extraItems: f.extraItems ?? [],
    // Tiers from before the markup field existed come back with an empty markup.
    priceTiers: (f.priceTiers ?? []).map((x) => ({ key: x.key, qty: x.qty ?? '', markup: x.markup ?? '' })),
    discount: f.discount ?? '0',
    paymentTerms:
      f.paymentTerms == null || (!f.id && OLD_DEFAULT_TERMS.includes(f.paymentTerms))
        ? settings.default_payment_terms
        : f.paymentTerms,
  };
}

/** Copy of a saved offer as a new, unsaved offer with a fresh number and dates. */
export function duplicateForm(form: OfferForm, offerNo: string): OfferForm {
  return {
    ...structuredClone(form),
    id: null,
    fixedCosts: null,
    offer: { ...form.offer, offerNo, offerDate: isoDate(0), validUntil: isoDate(30) },
  };
}

export function defaultUnitFor(form: Pick<OfferForm, 'productType'>) {
  return form.productType === 'powder' ? 'g' : 'mg';
}
