import Decimal from 'decimal.js';
import { unitPriceFor, type CalcResult } from './calc';
import { catalogTiersFor } from './catalogCapsules';
import { parseNum } from './numbers';
import type { OfferForm, PriceTier } from './types';

/**
 * Price per unit of a price tier: the unit price of the offer less the tier's discount, rounded like the offer
 * (owner, Nov 2026). Tiers saved before the discount existed keep their own markup on the unit cost. The database
 * checks an order at a tier the same way (create_order_from_calc_offers). Null while the tier is incomplete.
 */
export function tierUnitPrice(
  tier: Pick<PriceTier, 'discount' | 'markup'>,
  result: Pick<CalcResult, 'unitPrice' | 'unitCost'>,
): number | null {
  const discount = parseNum(tier.discount ?? '');
  if (discount !== null) {
    if (discount < 0 || discount >= 100) return null;
    return new Decimal(result.unitPrice).mul(new Decimal(1).sub(new Decimal(discount).div(100)))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  }
  const markup = parseNum(tier.markup ?? '');
  return markup !== null ? unitPriceFor(result.unitCost, markup) : null;
}

/** One quantity of an offer and its price per unit (EUR). */
export type PriceOption = { units: number; price: number };

/**
 * Price per unit for each quantity of an offer: the offer quantity plus its price tiers (a catalog product:
 * its own price steps), smallest first, one per quantity. The sales prices of the offer PDF, and the levels
 * an order can be made at.
 */
export function offerPriceOptions(
  form: Pick<OfferForm, 'mode' | 'catalog' | 'catalogCapsules' | 'jar' | 'lid' | 'numberOfUnits' | 'priceTiers'>,
  result: Pick<CalcResult, 'complete' | 'unitPrice' | 'unitCost'>,
): PriceOption[] {
  const units = parseNum(form.numberOfUnits) ?? 0;
  const tiers = form.mode === 'catalog' && form.catalog
    ? catalogTiersFor(form).map((x) => ({ units: x.min_qty, price: x.price }))
    : (form.priceTiers ?? []).flatMap((tier) => {
        const qty = parseNum(tier.qty);
        const price = tierUnitPrice(tier, result);
        return qty && qty > 0 && price !== null ? [{ units: qty, price }] : [];
      });
  return [...(units > 0 && result.complete ? [{ units, price: result.unitPrice }] : []), ...tiers]
    .filter((p, i, all) => all.findIndex((q) => q.units === p.units) === i)
    .sort((a, b) => a.units - b.units);
}
