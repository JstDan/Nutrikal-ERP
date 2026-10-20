import Decimal from 'decimal.js';
import { isCapsule, type DoseUnit, type FixedCosts, type OfferForm, type ProductType } from './types';
import { parseNum, parsePositiveInt } from './numbers';

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
  addVat: boolean;
  vatRatePct: number | null;
  /** Discount % applied to the product line only (extra items are never discounted). */
  discountPct: number | null;
  extraItems: ExtraItemInput[];
  fixedCosts: FixedCosts;
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
}

const ZERO = new Decimal(0);

/** All money maths uses decimal.js. Unit price is rounded to 2 decimals before multiplying by quantity. */
export function calculate(input: CalcInput): CalcResult {
  const capsule = isCapsule(input.productType);

  const rowKg = input.rows.map((r) => (r.amount && r.amount > 0 ? new Decimal(r.amount).mul(UNIT_TO_KG[r.unit]) : ZERO));
  const rowCost = rowKg.map((kg, i) => kg.mul(input.rows[i].pricePerKg || 0));
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
  const complete = !!input.productType && !!dosesPerUnit && !!units && hasMaterial;

  const fixedCostPerUnit = input.productType ? new Decimal(input.fixedCosts[input.productType] ?? 0) : ZERO;
  const rawCostPerUnit = dosesPerUnit ? costPerDose.mul(dosesPerUnit) : ZERO;
  const unitCost = rawCostPerUnit.add(fixedCostPerUnit);
  const markup = new Decimal(input.markupPct ?? 0);
  const unitPrice = unitCost.mul(markup.div(100).add(1)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

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
    const totalKg = rowKg[i].mul(orderDoses);
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
  return {
    productType: form.productType,
    rows: form.rows.map((r) => ({ name: r.name, amount: parseNum(r.amount), unit: r.unit, pricePerKg: r.pricePerKg })),
    capsulesPerDose: parsePositiveInt(form.capsulesPerDose),
    quantityPerUnit: parsePositiveInt(form.quantityPerUnit),
    numberOfUnits: parsePositiveInt(form.numberOfUnits),
    markupPct: parseNum(form.markup),
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
    fixedCosts: form.fixedCosts ?? fixedCosts,
  };
}
