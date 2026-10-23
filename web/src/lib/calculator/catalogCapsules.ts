import Decimal from 'decimal.js';
import { parsePositiveInt } from './numbers';
import type { CatalogTier, OfferForm } from './types';

// Catalog capsule products: Sales may change the capsules per jar; the catalog prices are for the
// standard count (capsules_per_container) and change in proportion to it (owner, Oct 2026).

export const CATALOG_CAPSULES_MIN = 30;
export const CATALOG_CAPSULES_MAX = 180;

type CatalogPart = Pick<OfferForm, 'mode' | 'catalog' | 'catalogCapsules'>;

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

/** The catalog price steps for the capsules on the offer (prices rounded like the offer, 2 decimals half up). */
export function catalogTiersFor(form: CatalogPart): CatalogTier[] {
  const tiers = form.catalog?.tiers ?? [];
  const std = standardCapsules(form);
  const caps = offerCapsules(form);
  if (!std || !caps || caps === std) return tiers;
  return tiers.map((x) => ({
    min_qty: x.min_qty,
    price: new Decimal(x.price).mul(caps).div(std).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
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
