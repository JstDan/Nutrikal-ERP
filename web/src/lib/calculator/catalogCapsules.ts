import Decimal from 'decimal.js';
import { parsePositiveInt } from './numbers';
import type { CatalogTier, OfferForm } from './types';

// Catalog capsule products: Sales may change the capsules per jar; the catalog prices are for the
// standard count (capsules_per_container) and change in proportion to it (owner, Oct 2026).

export const CATALOG_CAPSULES_MIN = 30;
export const CATALOG_CAPSULES_MAX = 180;
/** On top of the catalog price, EUR per jar (owner, Oct 2026): a glass jar, or an aluminium lid on a plastic jar. */
export const GLASS_JAR_EUR = 0.4;
export const ALUMINIUM_LID_EUR = 0.1;

type CatalogPart = Pick<OfferForm, 'mode' | 'catalog' | 'catalogCapsules'> & Partial<Pick<OfferForm, 'jar' | 'lid'>>;

/** Standard capsules per jar of the chosen catalog product; null when it is not a capsule product (or an older offer). */
export function standardCapsules(form: CatalogPart): number | null {
  return form.mode === 'catalog' ? (form.catalog?.capsules_per_container ?? null) : null;
}

/** Capsules per jar on the offer: the typed count, else the standard. Null when not a catalog capsule product. */
export function offerCapsules(form: CatalogPart): number | null {
  const std = standardCapsules(form);
  return std ? (parsePositiveInt(form.catalogCapsules) ?? std) : null;
}

/** Servings per jar for the capsules on the offer. */
export function offerServings(form: CatalogPart): number | null {
  const caps = offerCapsules(form);
  const perServing = form.catalog?.capsules_per_serving ?? null;
  return caps && perServing ? caps / perServing : null;
}

/** Catalog capsule product on a plastic jar with an aluminium lid (a glass jar has its own lid). */
export function hasAluminiumLid(form: CatalogPart): boolean {
  return !!standardCapsules(form) && form.jar !== 'glass' && form.lid === 'aluminium';
}

/** Extra EUR per jar for the jar and lid on the offer: glass jar, or aluminium lid on a plastic jar; else 0. */
export function packagingExtra(form: CatalogPart): number {
  if (!standardCapsules(form)) return 0;
  if (form.jar === 'glass') return GLASS_JAR_EUR;
  return form.lid === 'aluminium' ? ALUMINIUM_LID_EUR : 0;
}

/**
 * The catalog price steps for the capsules, jar and lid on the offer (prices rounded like the offer, 2 decimals
 * half up): in proportion to the capsules per jar, plus the glass jar or the aluminium lid.
 */
export function catalogTiersFor(form: CatalogPart): CatalogTier[] {
  const tiers = form.catalog?.tiers ?? [];
  const std = standardCapsules(form);
  const caps = offerCapsules(form);
  const extra = packagingExtra(form);
  if (!std || !caps || (caps === std && !extra)) return tiers;
  return tiers.map((x) => ({
    min_qty: x.min_qty,
    price: new Decimal(x.price).mul(caps).div(std).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).add(extra).toNumber(),
  }));
}

/** SQL: capsules per jar of a saved calculator offer (alias of calc_offers), for the order and the proforma; null for powders. */
export const calcOfferCapsulesSql = (co: string) => `case
    when ${co}.data ->> 'mode' = 'catalog' then
      case when ${co}.data ->> 'catalogCapsules' ~ '^[0-9]+$' then (${co}.data ->> 'catalogCapsules')::int
           else nullif(${co}.data -> 'catalog' ->> 'capsules_per_container', '')::int end
    when ${co}.data ->> 'productType' like 'capsules%' and ${co}.data ->> 'quantityPerUnit' ~ '^[0-9]+$'
      then (${co}.data ->> 'quantityPerUnit')::int
  end`;
