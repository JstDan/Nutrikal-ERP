// Catalog sync: reads the catalog Google Sheet (Nutrikal's product list with prices per quantity step).
// Layout: a header row starting with "Product code", then category rows (no code; name in the second
// column, the quantity steps in the price columns, e.g. "500 pcs.", "1000+ pcs.", "MOQ 3000+ units") and
// product rows (code, name, a unit price per step; "-" where a step has no price).
import { parsePrice } from './materialImport';
import type { CatalogTier } from './types';

export interface CatalogRow {
  code: string;
  name: string;
  category: string | null;
  tiers: CatalogTier[];
  sort_order: number;
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
/** First whole number in a step label: "1000+ pcs." → 1000, "MOQ 3000+ units" → 3000, "2,500+" → 2500. */
const stepQty = (label: string) => {
  const m = /(\d[\d,.\s]*)/.exec(label);
  const n = m ? Number(m[1].replace(/[,.\s]/g, '')) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Turn the sheet (rows as arrays, as SheetJS sheet_to_json with header: 1 gives them) into catalog
 * products. Throws when there is no "Product code" header or no product with a price, so a broken
 * sheet never empties the catalog.
 */
export function parseCatalogSheet(rows: unknown[][]): CatalogRow[] {
  const header = rows.findIndex((r) => text(r[0]).toLowerCase().replace(/[^a-z]/g, '') === 'productcode');
  if (header < 0) throw new Error('The catalog sheet has no "Product code" column');
  const width = Math.max(...rows.slice(header).map((r) => r.length));
  const priceCols = Array.from({ length: Math.max(0, width - 2) }, (_, i) => i + 2);

  let category: string | null = null;
  let steps: (number | null)[] = priceCols.map(() => null);
  const out = new Map<string, CatalogRow>();
  for (const r of rows.slice(header + 1)) {
    const code = text(r[0]);
    const name = text(r[1]);
    if (!code) {
      // Category row: its name and the quantity steps of the products under it
      const labels = priceCols.map((c) => stepQty(text(r[c])));
      if (name && labels.some((q) => q !== null)) {
        category = name;
        steps = labels;
      }
      continue;
    }
    if (!name) continue;
    const tiers = priceCols
      .map((c, i) => {
        const price = parsePrice(r[c]);
        // Some cells hold formulas (5.3913…) shown as €5.39: use the price as shown
        return { min_qty: steps[i], price: price === null ? null : Math.round(price * 100) / 100 };
      })
      .filter((x): x is CatalogTier => x.min_qty !== null && x.price !== null && x.price > 0)
      .sort((a, b) => a.min_qty - b.min_qty);
    if (tiers.length) out.set(code, { code, name, category, tiers, sort_order: out.size });
  }
  if (!out.size) throw new Error('The catalog sheet has no products with prices');
  return [...out.values()];
}

/** What a sync will change: new codes, changed name/category/prices, unchanged, and active products no longer in the sheet. */
export function catalogStats(sheet: CatalogRow[], current: { code: string; name: string; category: string | null; tiers: CatalogTier[]; active: boolean }[]) {
  const byCode = new Map(current.map((p) => [p.code, p]));
  const inSheet = new Set(sheet.map((p) => p.code));
  // jsonb reorders keys, so prices are compared by value
  const steps = (tiers: CatalogTier[]) => tiers.map((x) => `${Number(x.min_qty)}:${Number(x.price)}`).join();
  let added = 0, changed = 0, unchanged = 0;
  for (const p of sheet) {
    const was = byCode.get(p.code);
    if (!was) added++;
    else if (!was.active || was.name !== p.name || was.category !== p.category || steps(was.tiers) !== steps(p.tiers)) changed++;
    else unchanged++;
  }
  const removed = current.filter((p) => p.active && !inSheet.has(p.code)).length;
  return { added, changed, unchanged, removed };
}

/** Unit price for an order quantity: the largest step at or below it. Null below the smallest step. */
export function catalogPrice(tiers: CatalogTier[], units: number): CatalogTier | null {
  let hit: CatalogTier | null = null;
  for (const t of tiers) if (units >= t.min_qty && (!hit || t.min_qty > hit.min_qty)) hit = t;
  return hit;
}

/** Smallest quantity a catalog product can be offered at. */
export const catalogMinQty = (tiers: CatalogTier[]) => Math.min(...tiers.map((t) => t.min_qty));
