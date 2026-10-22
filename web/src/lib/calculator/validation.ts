import { catalogMinQty } from './catalogImport';
import { parseNum, parsePositiveInt } from './numbers';
import { isCapsule, type OfferForm } from './types';

export type FieldKey =
  | 'client'
  | 'catalogProduct'
  | 'productType'
  | 'rows'
  | 'capsulesPerDose'
  | 'quantityPerUnit'
  | 'numberOfUnits'
  | 'discount'
  | 'extraItems';

/** Message keys in the calc.validation dictionary. */
export type ValidationCode =
  | 'required' | 'email' | 'client' | 'productType' | 'materials' | 'positiveInt' | 'discount' | 'extraItems' | 'catalogProduct' | 'belowMoq';

/** Field order = order on the page, used to scroll to the first error. */
export const FIELD_ORDER: FieldKey[] = [
  'client',
  'catalogProduct',
  'productType',
  'rows',
  'capsulesPerDose',
  'quantityPerUnit',
  'numberOfUnits',
  'discount',
  'extraItems',
];

export const fieldId = (key: FieldKey) => `field-${key.replace('.', '-')}`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export type ValidationErrors = Partial<Record<FieldKey, ValidationCode>>;

export function validateOffer(form: OfferForm): ValidationErrors {
  const errors: ValidationErrors = {};
  // The client comes from CRM (its details are edited in Clients)
  if (!form.clientId) errors.client = 'client';
  const units = parsePositiveInt(form.numberOfUnits);
  if (form.mode === 'catalog') {
    // Catalog product: no formula or packaging; the quantity must reach the product's smallest price step.
    if (!form.catalog) errors.catalogProduct = 'catalogProduct';
    if (!units) errors.numberOfUnits = 'positiveInt';
    else if (form.catalog && units < catalogMinQty(form.catalog.tiers)) errors.numberOfUnits = 'belowMoq';
  } else {
    if (!form.productType) errors.productType = 'productType';
    if (!form.rows.some((r) => (parseNum(r.amount) ?? 0) > 0)) errors.rows = 'materials';
    if (isCapsule(form.productType) && !parsePositiveInt(form.capsulesPerDose)) errors.capsulesPerDose = 'positiveInt';
    if (!parsePositiveInt(form.quantityPerUnit)) errors.quantityPerUnit = 'positiveInt';
    if (!units) errors.numberOfUnits = 'positiveInt';
  }
  const discount = parseNum(form.discount || '0');
  if (discount === null || discount < 0 || discount > 100) errors.discount = 'discount';
  const badItem = form.extraItems.some((x) => {
    const qty = parseNum(x.qty);
    const price = parseNum(x.price);
    return !x.description.trim() || qty === null || qty <= 0 || price === null || price < 0;
  });
  if (badItem) errors.extraItems = 'extraItems';
  return errors;
}

export function firstError(errors: ValidationErrors): FieldKey | null {
  return FIELD_ORDER.find((k) => errors[k]) ?? null;
}
