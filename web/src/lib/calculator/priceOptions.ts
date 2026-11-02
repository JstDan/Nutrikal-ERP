import Decimal from 'decimal.js';
import { unitPriceFor, type CalcResult } from './calc';
import { catalogTiersFor } from './catalogCapsules';
import { catalogPrice } from './catalogImport';
import { parseNum } from './numbers';
import type { OfferForm, PriceTier } from './types';

type TierForm = Pick<OfferForm, 'mode' | 'catalog' | 'catalogCapsules' | 'jar' | 'lid'>;

const lessDiscount = (price: number, discount: number) =>
  new Decimal(price).mul(new Decimal(1).sub(new Decimal(discount).div(100))).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

/** The discount of a tier when it is a valid one (0 to below 100), else null. */
const tierDiscount = (tier: Pick<PriceTier, 'discount'>) => {
  const d = parseNum(tier.discount ?? '');
  return d !== null && d >= 0 && d < 100 ? d : null;
};

/**
 * Price per unit of a price tier: the unit price of the offer less the tier's discount, rounded like the offer
 * (owner, Nov 2026). Tiers saved before the discount existed keep their own markup on the unit cost. The database
 * checks an order at a tier the same way (create_order_from_calc_offers). Null while the tier is incomplete.
 */
export function tierUnitPrice(
  tier: Pick<PriceTier, 'discount' | 'markup'>,
  result: Pick<CalcResult, 'unitPrice' | 'unitCost'>,
): number | null {
  if (parseNum(tier.discount ?? '') !== null) {
    const d = tierDiscount(tier);
    return d === null ? null : lessDiscount(result.unitPrice, d);
  }
  const markup = parseNum(tier.markup ?? '');
  return markup !== null ? unitPriceFor(result.unitCost, markup) : null;
}

/**
 * Catalog product: the catalog price for the tier's quantity (the price step it falls in, after the capsules,
 * jar and lid of the offer) less the tier's discount (owner, Nov 2026). Null below the minimum or while incomplete.
 */
export function catalogTierUnitPrice(form: TierForm, tier: Pick<PriceTier, 'qty' | 'discount'>): number | null {
  const qty = parseNum(tier.qty);
  const d = tierDiscount(tier);
  if (!qty || qty <= 0 || d === null) return null;
  const step = catalogPrice(catalogTiersFor(form), qty);
  return step ? lessDiscount(step.price, d) : null;
}

/** One quantity of an offer and its price per unit (EUR). */
export type PriceOption = { units: number; price: number };

/**
 * Price per unit for each quantity of an offer: the offer quantity plus its price tiers (a catalog product: its
 * tiers with a discount, then its own price steps), smallest first, one per quantity. The sales prices of the offer
 * PDF, and the levels an order can be made at.
 */
export function offerPriceOptions(
  form: Pick<OfferForm, 'mode' | 'catalog' | 'catalogCapsules' | 'jar' | 'lid' | 'numberOfUnits' | 'priceTiers'>,
  result: Pick<CalcResult, 'complete' | 'unitPrice' | 'unitCost'>,
): PriceOption[] {
  const units = parseNum(form.numberOfUnits) ?? 0;
  const catalog = form.mode === 'catalog' && !!form.catalog;
  const tiers = (form.priceTiers ?? []).flatMap((tier) => {
    const qty = parseNum(tier.qty);
    const price = catalog ? catalogTierUnitPrice(form, tier) : tierUnitPrice(tier, result);
    return qty && qty > 0 && price !== null ? [{ units: qty, price }] : [];
  });
  const steps = catalog ? catalogTiersFor(form).map((x) => ({ units: x.min_qty, price: x.price })) : [];
  // the offer quantity first, then the tiers: a tier at a catalog step's quantity replaces the step
  return [...(units > 0 && result.complete ? [{ units, price: result.unitPrice }] : []), ...tiers, ...steps]
    .filter((p, i, all) => all.findIndex((q) => q.units === p.units) === i)
    .sort((a, b) => a.units - b.units);
}
