import type { CatalogTier } from './types';

/** Unit price for an order quantity: the largest step at or below it. Null below the smallest step. */
export function catalogPrice(tiers: CatalogTier[], units: number): CatalogTier | null {
  let hit: CatalogTier | null = null;
  for (const t of tiers) if (units >= t.min_qty && (!hit || t.min_qty > hit.min_qty)) hit = t;
  return hit;
}

/** Smallest quantity a catalog product can be offered at. */
export const catalogMinQty = (tiers: CatalogTier[]) => Math.min(...tiers.map((t) => t.min_qty));
