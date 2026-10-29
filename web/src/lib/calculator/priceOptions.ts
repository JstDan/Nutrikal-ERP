import { unitPriceFor, type CalcResult } from './calc';
import { catalogTiersFor } from './catalogCapsules';
import { parseNum } from './numbers';
import type { OfferForm } from './types';

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
        const markup = parseNum(tier.markup);
        return qty && qty > 0 && markup !== null ? [{ units: qty, price: unitPriceFor(result.unitCost, markup) }] : [];
      });
  return [...(units > 0 && result.complete ? [{ units, price: result.unitPrice }] : []), ...tiers]
    .filter((p, i, all) => all.findIndex((q) => q.units === p.units) === i)
    .sort((a, b) => a.units - b.units);
}
