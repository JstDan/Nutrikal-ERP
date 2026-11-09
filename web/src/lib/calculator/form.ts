import { DEFAULT_COUNTRY } from './countries';
import { isoDate } from './numbers';
import { CAPSULE_SIZE, CAPSULE_SIZES, type OfferForm, type RawMaterial, type Settings } from './types';

/** A new offer is valid for two weeks from its date (owner, Nov 2026; was 30 days). */
export const OFFER_VALID_DAYS = 14;

/** localStorage key of the unsaved calculator form (survives a page refresh). */
export const DRAFT_KEY = 'nk.calc.draft';
/** The draft as last opened, started or saved – tells whether the draft has unsaved changes. */
export const BASELINE_KEY = 'nk.calc.draftBaseline';

/** Waste of the offers saved before 29 Oct 2026 (it was added automatically): their prices stay. New offers have none. */
export const LEGACY_WASTE_PCT = '5';

/** Earlier default payment terms – unsaved drafts that still carry one get the current default. */
const OLD_DEFAULT_TERMS = [
  '100% advance payment',
  '50% Down Payment and 50% Balance Payment when goods are ready to be shipped',
  '70% Down Payment and 30% Balance Payment when goods are ready to be shipped',
];

export function createEmptyForm(settings: Settings, offerNo: string): OfferForm {
  return {
    id: null,
    mode: 'custom',
    catalog: null,
    catalogCapsules: '',
    jar: 'plastic',
    lid: 'plastic',
    catalogPackaging: false,
    clientId: null,
    contact: { name: '', phone: '' },
    receiver: { fullName: '', address: '', city: '', zip: '', country: DEFAULT_COUNTRY, phone: '', email: '' },
    invoice: { companyName: '', identificationNo: '', registrationAddress: '', vatNumber: '' },
    offer: { offerNo, offerDate: isoDate(0), validUntil: isoDate(OFFER_VALID_DAYS), productName: '' },
    productType: null,
    rows: [],
    capsulesPerDose: '1',
    capsuleSize: CAPSULE_SIZE,
    maxFillMg: String(CAPSULE_SIZES[CAPSULE_SIZE]),
    quantityPerUnit: '',
    numberOfUnits: '',
    markup: String(settings.default_markup),
    waste: '',
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
    catalogCapsules: f.catalogCapsules ?? '',
    jar: f.jar === 'glass' ? 'glass' : 'plastic',
    lid: f.lid === 'aluminium' ? 'aluminium' : 'plastic',
    catalogPackaging: f.catalogPackaging === true,
    clientId: f.clientId ?? null,
    // Extra services are added to the order now, not to the offer: unsaved drafts drop them (saved offers keep theirs).
    extraItems: f.id ? (f.extraItems ?? []) : [],
    // Tiers from before the discount (or the markup) field existed come back with it empty.
    priceTiers: (f.priceTiers ?? []).map((x) => ({ key: x.key, qty: x.qty ?? '', discount: x.discount ?? '', markup: x.markup ?? '' })),
    discount: f.discount ?? '0',
    // Size 00 only: an older size's standard fill becomes the size 00 fill (a fill typed by hand stays)
    capsuleSize: CAPSULE_SIZE,
    maxFillMg: !f.maxFillMg || (f.capsuleSize && f.maxFillMg === String(CAPSULE_SIZES[f.capsuleSize])) ? String(CAPSULE_SIZES[CAPSULE_SIZE]) : f.maxFillMg,
    waste: f.waste ?? (f.id ? LEGACY_WASTE_PCT : ''),
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
    offer: { ...form.offer, offerNo, offerDate: isoDate(0), validUntil: isoDate(OFFER_VALID_DAYS) },
  };
}

export function defaultUnitFor(form: Pick<OfferForm, 'productType'>) {
  return form.productType === 'powder' ? 'g' : 'mg';
}

/**
 * The next formula for the same client (owner, Nov 2026: a client often needs two or more formulas costed): a new,
 * empty offer that keeps the client, the contact person, the receiver, the invoice details and the payment terms.
 */
export function nextFormulaForm(prev: OfferForm, settings: Settings, offerNo: string): OfferForm {
  const f = createEmptyForm(settings, offerNo);
  return {
    ...f,
    clientId: prev.clientId,
    contact: { ...prev.contact },
    receiver: { ...prev.receiver },
    invoice: { ...prev.invoice },
    paymentTerms: prev.paymentTerms || f.paymentTerms,
  };
}

/**
 * The recipe of another offer, of any client, into this one (owner, Nov 2026): the formula type, catalog product,
 * ingredients, capsules, pack, jar and lid and the product name. This offer's client, quantities, markup and extra
 * lines stay. Raw materials take today's price and regulatory note from the price list.
 */
export function copyRecipe(target: OfferForm, source: OfferForm, materials: RawMaterial[]): OfferForm {
  const byId = new Map(materials.map((m) => [m.id, m]));
  return {
    ...target,
    mode: source.mode ?? 'custom',
    catalog: source.catalog ? structuredClone(source.catalog) : null,
    catalogCapsules: source.catalogCapsules ?? '',
    jar: source.jar ?? 'plastic',
    lid: source.lid ?? 'plastic',
    catalogPackaging: !!source.catalogPackaging,
    productType: source.productType ?? null,
    rows: (source.rows ?? []).map((r, i) => {
      const m = r.materialId ? byId.get(r.materialId) : undefined;
      return { ...r, key: `copy-${Date.now()}-${i}`, pricePerKg: m ? m.price_eur_per_kg : r.pricePerKg, regulatoryNote: m ? m.regulatory_note : r.regulatoryNote };
    }),
    capsulesPerDose: source.capsulesPerDose ?? target.capsulesPerDose,
    capsuleSize: source.capsuleSize ?? target.capsuleSize,
    maxFillMg: source.maxFillMg ?? target.maxFillMg,
    quantityPerUnit: source.quantityPerUnit ?? '',
    includeComposition: source.includeComposition ?? true,
    offer: { ...target.offer, productName: source.offer?.productName ?? '' },
  };
}
