import Decimal from 'decimal.js';
import { catalogPrice } from './catalogPrice';
import { ALUMINIUM_LID_EUR, GLASS_JAR_EUR, catalogTiersFor } from './catalogCapsules';
import { BULK_UNIT, bulkThousands, isBulk, isCapsule, type CatalogTier, type DoseUnit, type FixedCosts, type OfferForm, type ProductType } from './types';
import { parseNum, parsePositiveInt } from './numbers';

/** Custom formula, capsule jar with an aluminium lid: extra cost per unit, EUR (owner, Oct 2026). */
export const ALUMINIUM_LID_COST_EUR = 0.2;

type PackagingPart = Pick<OfferForm, 'mode' | 'productType' | 'lid' | 'catalogPackaging'>;

/** Custom formula from a catalog product, capsules: jar and lid at the catalog's prices. */
export const usesCatalogPackaging = (form: PackagingPart) =>
  form.mode !== 'catalog' && form.catalogPackaging && isCapsule(form.productType);

/**
 * Custom formula, capsules: jar and lid cost per unit on top of the fixed cost, EUR. At the catalog's prices
 * (custom formula from a catalog product): the glass jar with aluminium lid, or the aluminium lid; else the aluminium lid.
 */
export function packagingExtraCost(form: PackagingPart): number {
  if (form.mode === 'catalog' || !isCapsule(form.productType) || isBulk(form.productType)) return 0;
  if (usesCatalogPackaging(form)) {
    if (form.productType === 'capsules_glass') return GLASS_JAR_EUR;
    return form.lid === 'aluminium' ? ALUMINIUM_LID_EUR : 0;
  }
  return form.lid === 'aluminium' ? ALUMINIUM_LID_COST_EUR : 0;
}

/** Capsule jar closed with an aluminium lid (the catalog's glass jar always is). */
export const hasAluminiumCap = (form: PackagingPart) =>
  isCapsule(form.productType) && !isBulk(form.productType) && (form.lid === 'aluminium' || (usesCatalogPackaging(form) && form.productType === 'capsules_glass'));

/** Fixed costs per type; at the catalog's prices the glass jar costs as the plastic one plus its extra. */
export function fixedCostsFor(form: PackagingPart, fixedCosts: FixedCosts): FixedCosts {
  return usesCatalogPackaging(form) ? { ...fixedCosts, capsules_glass: fixedCosts.capsules_plastic } : fixedCosts;
}

const UNIT_TO_KG: Record<DoseUnit, Decimal> = {
  mcg: new Decimal('1e-9'),
  mg: new Decimal('1e-6'),
  g: new Decimal('1e-3'),
};

export interface CalcRowInput {
  name: string;
  amount: number | null;
  unit: DoseUnit;
  pricePerKg: number;
}

export interface CalcInput {
  productType: ProductType | null;
  rows: CalcRowInput[];
  capsulesPerDose: number | null;
  quantityPerUnit: number | null;
  numberOfUnits: number | null;
  markupPct: number | null;
  /**
   * Raw-material waste in production, % (none on new offers; 5 on offers saved before 29 Oct 2026): the raw
   * materials cost and the quantities to buy include it; the dose and fill weights do not. The recipe gets it too.
   */
  wastePct: number | null;
  addVat: boolean;
  vatRatePct: number | null;
  /** Discount % applied to the product line only (extra items are never discounted). */
  discountPct: number | null;
  extraItems: ExtraItemInput[];
  fixedCosts: FixedCosts;
  /** Jar and lid cost per unit on top of the fixed cost (glass jar, aluminium lid), added before markup. */
  packagingExtra?: number;
  /** Catalog product: unit price per quantity step instead of cost + markup (no formula, no fixed cost). */
  catalogTiers?: CatalogTier[] | null;
  /**
   * Capsules in bulk: one unit is 1,000 capsules. Instead of the bottled product's fixed cost, per unit: the
   * production rate + the capsule shells + the batch cost and the bulk packaging spread over the order. Each once.
   */
  bulk?: BulkCosts | null;
}

/** Bulk costs, EUR: per 1,000 capsules (rate, shells), once per batch, and for the whole order (packaging). */
export interface BulkCosts {
  rate: number;
  shells: number;
  batch: number;
  packaging: number;
}

/** What a unit of 1,000 bulk capsules costs, part by part (the batch and packaging spread over the order). */
export interface BulkBreakdown {
  ratePerUnit: number;
  shellsPerUnit: number;
  batchPerUnit: number;
  packagingPerUnit: number;
  batch: number;
  packaging: number;
  capsules: number;
  pricePerCapsule: number;
}

export interface ExtraItemInput {
  description: string;
  qty: number | null;
  unit: string;
  price: number | null;
}

/** One priced line of the client offer. */
export interface OfferLine {
  description: string;
  qty: number;
  unit: string;
  price: number;
  discountPct: number;
  amount: number;
}

export interface RequirementLine {
  name: string;
  totalKg: number;
  cost: number;
}

export interface CalcResult {
  /** True when every input needed for prices is present and valid. */
  complete: boolean;
  rowCostsPerDose: number[];
  doseWeightMg: number;
  costPerDose: number;
  fillWeightPerCapsuleMg: number | null;
  dosesPerUnit: number | null;
  netWeightPerPouchG: number | null;
  fixedCostPerUnit: number;
  /** Glass jar / aluminium lid on top of the fixed cost, part of the unit cost. */
  packagingExtraPerUnit: number;
  rawCostPerUnit: number;
  unitCost: number;
  unitPrice: number;
  /** Product line after discount (unit price × units − discount). */
  productAmount: number;
  /** Extra lines at full price (only complete rows). */
  extraLines: OfferLine[];
  extrasTotal: number;
  /** Discount given on the product line. */
  discountAmount: number;
  totalCost: number;
  /** Sub total of all lines, excl. VAT. */
  totalPriceExclVat: number;
  /** Product profit (product line after discount − product cost); extra items are not included. */
  profit: number;
  marginPct: number;
  vatAmount: number;
  totalInclVat: number;
  requirements: RequirementLine[];
  requirementsTotalCost: number;
  /** Capsules in bulk only. */
  bulk: BulkBreakdown | null;
}

const ZERO = new Decimal(0);

/** All money maths uses decimal.js. Unit price is rounded to 2 decimals before multiplying by quantity. */
export function calculate(input: CalcInput): CalcResult {
  const capsule = isCapsule(input.productType);

  const waste = new Decimal(1).add(Decimal.max(0, new Decimal(input.wastePct ?? 0)).div(100));
  const rowKg = input.rows.map((r) => (r.amount && r.amount > 0 ? new Decimal(r.amount).mul(UNIT_TO_KG[r.unit]) : ZERO));
  const rowCost = rowKg.map((kg, i) => kg.mul(waste).mul(input.rows[i].pricePerKg || 0));
  const doseKg = rowKg.reduce((a, b) => a.add(b), ZERO);
  const costPerDose = rowCost.reduce((a, b) => a.add(b), ZERO);
  const doseWeightMg = doseKg.mul(1e6);

  const capsulesPerDose = input.capsulesPerDose && input.capsulesPerDose > 0 ? input.capsulesPerDose : null;
  const fillWeightPerCapsuleMg = capsule && capsulesPerDose ? doseWeightMg.div(capsulesPerDose) : null;

  let dosesPerUnit: Decimal | null = null;
  if (input.quantityPerUnit && input.quantityPerUnit > 0) {
    if (capsule) dosesPerUnit = capsulesPerDose ? new Decimal(input.quantityPerUnit).div(capsulesPerDose) : null;
    else if (input.productType === 'powder') dosesPerUnit = new Decimal(input.quantityPerUnit);
  }
  const netWeightPerPouchG =
    input.productType === 'powder' && dosesPerUnit ? doseKg.mul(1000).mul(dosesPerUnit) : null;

  const units = input.numberOfUnits && input.numberOfUnits > 0 ? input.numberOfUnits : null;
  const hasMaterial = rowKg.some((kg) => kg.gt(0));
  const catalogStep = input.catalogTiers && units ? catalogPrice(input.catalogTiers, units) : null;
  const complete = input.catalogTiers ? !!catalogStep : !!input.productType && !!dosesPerUnit && !!units && hasMaterial;

  // Bulk: no bottled-product fixed cost; the bulk costs instead, the batch and the packaging spread over the units
  const b = input.bulk && isBulk(input.productType) ? input.bulk : null;
  const nonNeg = (n: number) => Decimal.max(0, new Decimal(Number.isFinite(n) ? n : 0));
  const bulkParts = b
    ? {
        rate: nonNeg(b.rate), shells: nonNeg(b.shells),
        batch: units ? nonNeg(b.batch).div(units) : ZERO, packaging: units ? nonNeg(b.packaging).div(units) : ZERO,
      }
    : null;
  const fixedCostPerUnit = bulkParts
    ? bulkParts.rate.add(bulkParts.shells).add(bulkParts.batch).add(bulkParts.packaging)
    : input.productType ? new Decimal(input.fixedCosts[input.productType] ?? 0) : ZERO;
  const rawCostPerUnit = dosesPerUnit ? costPerDose.mul(dosesPerUnit) : ZERO;
  const packagingExtraPerUnit = capsule ? new Decimal(input.packagingExtra ?? 0) : ZERO;
  const unitCost = rawCostPerUnit.add(fixedCostPerUnit).add(packagingExtraPerUnit);
  const markup = new Decimal(input.markupPct ?? 0);
  const unitPrice = catalogStep
    ? new Decimal(catalogStep.price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : unitCost.mul(markup.div(100).add(1)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const discount = Decimal.max(0, Decimal.min(100, new Decimal(input.discountPct ?? 0)));
  const keep = new Decimal(1).sub(discount.div(100));

  // Product line: amount = qty × unit price − discount (rounded per line, like the printed offer).
  const qty = new Decimal(complete ? units! : 0);
  const totalCost = unitCost.mul(qty);
  const productGross = unitPrice.mul(qty);
  const productAmount = round2(productGross.mul(keep));
  const profit = productAmount.sub(totalCost);
  const marginPct = productAmount.gt(0) ? profit.div(productAmount).mul(100) : ZERO;

  // Extra lines: only rows with a description, a positive quantity and a price. Never discounted.
  const extraLines: OfferLine[] = [];
  for (const item of input.extraItems) {
    if (!item.description.trim() || !item.qty || item.qty <= 0 || item.price === null || item.price < 0) continue;
    const gross = new Decimal(item.price).mul(item.qty);
    extraLines.push({
      description: item.description.trim(),
      qty: item.qty,
      unit: item.unit,
      price: item.price,
      discountPct: 0,
      amount: round2(gross).toNumber(),
    });
  }
  const extrasTotal = extraLines.reduce((a, l) => a.add(l.amount), ZERO);

  const subtotal = productAmount.add(extrasTotal);
  const discountAmount = productGross.sub(productAmount);
  const vatAmount = input.addVat ? round2(subtotal.mul(new Decimal(input.vatRatePct ?? 0).div(100))) : ZERO;

  const orderDoses = dosesPerUnit && units ? dosesPerUnit.mul(units) : ZERO;
  const requirements = input.rows.map((r, i) => {
    const totalKg = rowKg[i].mul(waste).mul(orderDoses);
    return { name: r.name, totalKg: totalKg.toNumber(), cost: totalKg.mul(r.pricePerKg || 0).toNumber() };
  });

  return {
    complete,
    rowCostsPerDose: rowCost.map((c) => c.toNumber()),
    doseWeightMg: doseWeightMg.toNumber(),
    costPerDose: costPerDose.toNumber(),
    fillWeightPerCapsuleMg: fillWeightPerCapsuleMg?.toNumber() ?? null,
    dosesPerUnit: dosesPerUnit?.toNumber() ?? null,
    netWeightPerPouchG: netWeightPerPouchG?.toNumber() ?? null,
    fixedCostPerUnit: fixedCostPerUnit.toNumber(),
    packagingExtraPerUnit: packagingExtraPerUnit.toNumber(),
    rawCostPerUnit: rawCostPerUnit.toNumber(),
    unitCost: unitCost.toNumber(),
    unitPrice: complete ? unitPrice.toNumber() : 0,
    productAmount: productAmount.toNumber(),
    extraLines,
    extrasTotal: extrasTotal.toNumber(),
    discountAmount: discountAmount.toNumber(),
    totalCost: totalCost.toNumber(),
    totalPriceExclVat: subtotal.toNumber(),
    profit: profit.toNumber(),
    marginPct: marginPct.toNumber(),
    vatAmount: vatAmount.toNumber(),
    totalInclVat: subtotal.add(vatAmount).toNumber(),
    requirements,
    requirementsTotalCost: requirements.reduce((a, r) => a.add(r.cost), ZERO).toNumber(),
    bulk: b && bulkParts
      ? {
          ratePerUnit: bulkParts.rate.toNumber(), shellsPerUnit: bulkParts.shells.toNumber(),
          batchPerUnit: bulkParts.batch.toNumber(), packagingPerUnit: bulkParts.packaging.toNumber(),
          batch: nonNeg(b.batch).toNumber(), packaging: nonNeg(b.packaging).toNumber(),
          capsules: units ? units * BULK_UNIT : 0,
          pricePerCapsule: complete ? unitPrice.div(BULK_UNIT).toNumber() : 0,
        }
      : null,
  };
}

/** Margin % that results from a markup % applied on cost. */
/** Price per unit from a unit cost and a markup, rounded like the offer (2 decimals, half up). */
export function unitPriceFor(unitCost: number, markupPct: number): number {
  return new Decimal(unitCost).mul(new Decimal(markupPct).div(100).add(1)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

export function marginFromMarkup(markupPct: number): number {
  if (markupPct <= -100) return 0;
  return new Decimal(markupPct).div(new Decimal(markupPct).add(100)).mul(100).toNumber();
}

export function calcInputFromForm(form: OfferForm, fixedCosts: FixedCosts): CalcInput {
  // A catalog product has no formula, packaging or fixed cost: its price comes from the catalog steps
  // (in proportion to the capsules per jar when Sales changed them).
  const catalog = form.mode === 'catalog';
  const bulk = !catalog && isBulk(form.productType);
  return {
    productType: catalog ? null : form.productType,
    rows: catalog ? [] : form.rows.map((r) => ({ name: r.name, amount: parseNum(r.amount), unit: r.unit, pricePerKg: r.pricePerKg })),
    catalogTiers: catalog ? catalogTiersFor(form) : null,
    capsulesPerDose: parsePositiveInt(form.capsulesPerDose),
    // Bulk: a unit is 1,000 capsules, and the units are the total capsules typed
    quantityPerUnit: bulk ? BULK_UNIT : parsePositiveInt(form.quantityPerUnit),
    numberOfUnits: bulk ? bulkThousands(form) : parsePositiveInt(form.numberOfUnits),
    bulk: bulk
      ? { rate: parseNum(form.bulkRate ?? '') ?? 0, shells: parseNum(form.bulkShells ?? '') ?? 0, batch: parseNum(form.bulkBatch ?? '') ?? 0, packaging: parseNum(form.bulkPackaging ?? '') ?? 0 }
      : null,
    markupPct: parseNum(form.markup),
    // A catalog product's price comes from its steps: no raw materials, no waste.
    wastePct: catalog ? null : parseNum(form.waste ?? ''),
    // VAT is no longer added: offers are always excl. VAT (older saved offers included).
    addVat: false,
    vatRatePct: null,
    discountPct: parseNum(form.discount ?? ''),
    extraItems: (form.extraItems ?? []).map((x) => ({
      description: x.description,
      qty: parseNum(x.qty),
      unit: x.unit,
      price: parseNum(x.price),
    })),
    fixedCosts: fixedCostsFor(form, form.fixedCosts ?? fixedCosts),
    packagingExtra: packagingExtraCost(form),
  };
}
