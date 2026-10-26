import { offerCapsules } from './catalogCapsules';
import { CAPSULE_SIZES, type CapsuleSize, type CatalogIngredient, type FormulaRow, type OfferForm, type RawMaterial } from './types';

// "Change ingredients" on a catalog product: the offer becomes a custom formula with everything typed so far,
// its composition as raw-material rows (matched on name with the price list) and its serving and pack size.

const UNIT_TO_MG = { mcg: 0.001, mg: 1, g: 1000 } as const;
/** Words that say nothing about which raw material it is. */
const NOISE = new Set(['extract', 'powder', 'from', 'of', 'and', 'the']);

const words = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ®™'’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !NOISE.has(w));

const isWord = (w: string) => /\p{L}/u.test(w);

/** Same word, or one letter added, left out or different – the price list has typos ("Thistie", "Terrestis"). */
function nearly(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && long[i] === short[i]) i++;
  return long.slice(i + 1) === short.slice(long.length === short.length ? i + 1 : i);
}
const hasWord = (have: Set<string>, w: string) => have.has(w) || [...have].some((x) => nearly(x, w));

/** Same words in any order ("Vitamin B6 (P5P)" = "Vitamin B6 ( P5P )"). */
const sameName = (a: string, b: string) => words(a).sort().join(' ') === words(b).sort().join(' ');

/**
 * The price-list material for a catalog ingredient: every word of its name outside brackets must be in the
 * material's name; then the one sharing most of the other words (brackets, percentages), then the shortest.
 */
export function matchMaterial(name: string, materials: RawMaterial[]): RawMaterial | null {
  const exact = materials.find((m) => sameName(m.name, name));
  if (exact) return exact;
  const required = words(name.replace(/\([^)]*\)/g, ' ')).filter(isWord);
  if (!required.length) return null;
  const extra = words(name).filter((w) => !required.includes(w));
  let best: { m: RawMaterial; score: number } | null = null;
  for (const m of materials) {
    const have = new Set(words(m.name));
    if (!required.every((w) => hasWord(have, w))) continue;
    const shared = extra.filter((w) => hasWord(have, w)).length;
    const score = shared - (have.size - required.length - shared) / 100;
    if (!best || score > best.score) best = { m, score };
  }
  return best?.m ?? null;
}

/** One formula row per catalog ingredient. Not in the price list: no material and no price, to be picked by hand. */
export function compositionRows(composition: CatalogIngredient[], materials: RawMaterial[]): FormulaRow[] {
  return composition.map((x) => {
    const m = matchMaterial(x.name, materials);
    return {
      key: crypto.randomUUID(),
      materialId: m?.id ?? null,
      name: m?.name ?? x.name,
      pricePerKg: m?.price_eur_per_kg ?? 0,
      regulatoryNote: m?.regulatory_note ?? null,
      amount: String(x.amount),
      unit: x.unit,
      catalogName: x.name,
    };
  });
}

/** Smallest capsule size that holds the fill weight (size 00 when none does). */
export function capsuleSizeFor(fillMg: number): CapsuleSize {
  const sizes = (Object.keys(CAPSULE_SIZES) as CapsuleSize[]).sort((a, b) => CAPSULE_SIZES[a] - CAPSULE_SIZES[b]);
  return sizes.find((s) => fillMg <= CAPSULE_SIZES[s]) ?? sizes[sizes.length - 1];
}

/**
 * The catalog offer as a custom formula. Client, offer data, quantity, markup, VAT and the rest stay as typed;
 * the catalog product stays on the form so switching back to Catalog formula keeps it.
 * Capsule products leave the jar type (glass or plastic) to be chosen.
 */
export function catalogToCustom(form: OfferForm, materials: RawMaterial[]): OfferForm {
  const p = form.catalog;
  if (!p) return { ...form, mode: 'custom' };
  const rows = compositionRows(p.composition ?? [], materials);
  const productName = form.offer.productName.trim() || p.name;
  const next: OfferForm = { ...form, mode: 'custom', rows, offer: { ...form.offer, productName } };

  if (p.capsules_per_serving) {
    const doseMg = (p.composition ?? []).reduce((sum, x) => sum + x.amount * UNIT_TO_MG[x.unit], 0);
    const size = capsuleSizeFor(doseMg / p.capsules_per_serving);
    const caps = offerCapsules(form);
    return {
      ...next,
      productType: next.productType === 'capsules_glass' || next.productType === 'capsules_plastic' ? next.productType : null,
      capsulesPerDose: String(p.capsules_per_serving),
      capsuleSize: size,
      maxFillMg: String(CAPSULE_SIZES[size]),
      quantityPerUnit: caps ? String(caps) : next.quantityPerUnit,
    };
  }
  return {
    ...next,
    productType: 'powder',
    quantityPerUnit: p.servings_per_container ? String(p.servings_per_container) : next.quantityPerUnit,
  };
}

/** Rows still to be checked: not found in the price list, or matched to a material with another name. */
export const isUnmatched = (r: FormulaRow) => !!r.catalogName && !r.materialId;
export const needsCheck = (r: FormulaRow) => !!r.catalogName && !!r.materialId && !sameName(r.catalogName, r.name);
