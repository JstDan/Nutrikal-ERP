"use client";

import { marginFromMarkup, unitPriceFor, type CalcResult } from "@/lib/calculator/calc";
import { catalogMinQty } from "@/lib/calculator/catalogImport";
import { parseNum } from "@/lib/calculator/numbers";
import { tierUnitPrice } from "@/lib/calculator/priceOptions";
import { isCapsule, type ExtraItem, type PriceTier, type ServicePreset } from "@/lib/calculator/types";
import { fieldId } from "@/lib/calculator/validation";
import { fmt } from "@/lib/i18n";
import type { SectionProps } from "./client-sections";
import { Field, Notice, NumberField, RemoveButton, Section, SubHeading, SummaryBox, Toggle, inputClass, useCalcText, type CalcDict } from "./kit";

export const quantityLabel = (t: CalcDict, type: string | null) =>
  type === "powder" ? t.quantity.dosesPerPouch : t.quantity.capsulesPerBottle;

export const unitsLabel = (t: CalcDict, type: string | null) =>
  !type ? t.units.units : type === "powder" ? t.units.pouches : t.units.bottles;

/** Step 5: capsules per bottle / doses per pouch. */
export function QuantitySection({ form, setForm, errorFor, touch, result }: SectionProps & { result: CalcResult }) {
  const { t, num } = useCalcText();
  const capsule = isCapsule(form.productType);
  const error = errorFor("quantityPerUnit");
  const notWhole = capsule && result.dosesPerUnit !== null && !Number.isInteger(result.dosesPerUnit);

  return (
    <Section step={5} title={t.quantity.section}>
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
        <Field
          label={quantityLabel(t, form.productType)}
          htmlFor={fieldId("quantityPerUnit")}
          required
          error={error}
          hint={!form.productType ? t.quantity.selectType : undefined}
        >
          <NumberField
            id={fieldId("quantityPerUnit")}
            integer
            value={form.quantityPerUnit}
            onChange={(v) => setForm((f) => ({ ...f, quantityPerUnit: v }))}
            onBlur={() => touch("quantityPerUnit")}
            invalid={!!error}
          />
        </Field>
        {/* Label above a box as tall as the input, so it lines up with the field on the left */}
        {form.productType ? (
          <div className="field">
            <span id="quantity-result">{capsule ? t.quantity.dosesPerBottle : t.quantity.netWeight}</span>
            <output aria-labelledby="quantity-result" className="flex min-h-11 items-center rounded-sm bg-canvas px-4 text-sm font-bold tabular-nums">
              {capsule
                ? result.dosesPerUnit !== null ? num(result.dosesPerUnit, 2) : "–"
                : result.netWeightPerPouchG !== null ? `${num(result.netWeightPerPouchG, 2)} g` : "–"}
            </output>
          </div>
        ) : (
          <SummaryBox>
            <p className="my-2 text-sm text-ink-2">{t.quantity.selectType}</p>
          </SummaryBox>
        )}
      </div>
      {notWhole && <Notice tone="warning">{t.quantity.notWhole}</Notice>}
    </Section>
  );
}

/** Step 6: number of units, markup, discount and optional price tiers. Prices are excl. VAT.
 *  Catalog product: number of units and discount only (the unit price comes from its price steps). */
export function MarkupSection({ form, setForm, errorFor, touch, result, step = 6 }: SectionProps & { result: CalcResult; step?: number }) {
  const { t, eur, num, pct } = useCalcText();
  const markup = parseNum(form.markup) ?? 0;
  const discount = parseNum(form.discount);
  const discountInvalid = form.discount.trim() !== "" && (discount === null || discount < 0 || discount > 100);
  const unitsError = errorFor("numberOfUnits");
  const unitCost = result.unitCost;
  const costKnown = !!form.productType && unitCost > 0;
  const catalog = form.mode === "catalog";
  const minQty = catalog && form.catalog ? catalogMinQty(form.catalog.tiers) : null;

  const addTier = () => setForm((f) => ({ ...f, priceTiers: [...f.priceTiers, { key: crypto.randomUUID(), qty: "", discount: "", markup: "" }] }));
  const updateTier = (key: string, patch: Partial<PriceTier>) =>
    setForm((f) => ({ ...f, priceTiers: f.priceTiers.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  const removeTier = (key: string) => setForm((f) => ({ ...f, priceTiers: f.priceTiers.filter((x) => x.key !== key) }));

  return (
    <Section step={step} title={catalog ? t.markup.sectionCatalog : t.markup.section}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field
          label={catalog ? t.units.units : unitsLabel(t, form.productType)}
          htmlFor={fieldId("numberOfUnits")}
          required
          error={unitsError}
          hint={minQty ? fmt(t.catalog.minQty, { n: num(minQty) }) : undefined}
        >
          <NumberField
            id={fieldId("numberOfUnits")}
            integer
            value={form.numberOfUnits}
            onChange={(v) => setForm((f) => ({ ...f, numberOfUnits: v }))}
            onBlur={() => touch("numberOfUnits")}
            invalid={!!unitsError}
          />
        </Field>
        {catalog ? (
          <div className="flex min-w-0 flex-col gap-1 text-sm">
            <span className="label">{t.catalog.unitPrice}</span>
            <span className="flex min-h-11 items-center font-bold tabular-nums">{result.complete ? eur(result.unitPrice) : "–"}</span>
          </div>
        ) : (
          <Field
            label={t.markup.markup}
            htmlFor="markup"
            hint={<>{t.markup.margin}: <b className="text-ink">{pct(marginFromMarkup(markup))}</b> · {t.markup.markupHint}</>}
          >
            <NumberField id="markup" value={form.markup} onChange={(v) => setForm((f) => ({ ...f, markup: v }))} suffix="%" />
          </Field>
        )}
        <Field
          label={t.markup.discount}
          htmlFor={fieldId("discount")}
          error={discountInvalid || errorFor("discount") ? t.validation.discount : undefined}
          hint={t.markup.discountHint}
        >
          <NumberField
            id={fieldId("discount")}
            value={form.discount}
            onChange={(v) => setForm((f) => ({ ...f, discount: v }))}
            invalid={discountInvalid || !!errorFor("discount")}
            suffix="%"
          />
        </Field>
      </div>

      {!catalog && (
      <div className="flex flex-col gap-3 border-t border-mist pt-5">
        <SubHeading>{t.markup.tiers}</SubHeading>
        <p className="m-0 text-[13px] text-ink-2">{t.markup.tiersHint}</p>
        {form.priceTiers.map((tier) => {
          const tierDiscount = parseNum(tier.discount);
          const discountBad = tier.discount.trim() !== "" && (tierDiscount === null || tierDiscount < 0 || tierDiscount >= 100);
          const legacyMarkup = tier.discount.trim() === "" ? parseNum(tier.markup) : null;
          const price = costKnown ? tierUnitPrice(tier, { unitPrice: unitPriceFor(unitCost, markup), unitCost }) : null;
          return (
            <div key={tier.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3 rounded-sm border border-line p-3 md:grid-cols-[160px_160px_minmax(0,1fr)_auto]">
              <Field label={t.markup.tierQty} htmlFor={`tier-qty-${tier.key}`}>
                <NumberField id={`tier-qty-${tier.key}`} integer value={tier.qty} onChange={(v) => updateTier(tier.key, { qty: v })} suffix={t.results.pcs} />
              </Field>
              <Field label={t.markup.discount} htmlFor={`tier-discount-${tier.key}`} error={discountBad ? t.markup.tierDiscountInvalid : undefined}>
                {/* typing a discount replaces the markup of an older tier */}
                <NumberField id={`tier-discount-${tier.key}`} value={tier.discount} onChange={(v) => updateTier(tier.key, { discount: v, markup: "" })}
                  invalid={discountBad} suffix="%" />
              </Field>
              <div className="col-span-3 row-start-2 min-w-0 text-[13px] text-ink-2 md:col-span-1 md:row-start-auto md:self-center">
                {!costKnown ? (
                  t.markup.tierNeedsFormula
                ) : price !== null ? (
                  <>
                    <div className="font-semibold text-ink">{fmt(t.markup.tierPrice, { price: eur(price) })}</div>
                    {price > 0 && <div>{t.markup.margin}: {pct(((price - unitCost) / price) * 100)}</div>}
                    {legacyMarkup !== null && <div>{fmt(t.markup.tierLegacyMarkup, { pct: pct(legacyMarkup) })}</div>}
                  </>
                ) : null}
              </div>
              <div className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto">
                <RemoveButton label={t.markup.removeTier} onClick={() => removeTier(tier.key)} />
              </div>
            </div>
          );
        })}
        <div>
          <button type="button" onClick={addTier} className="btn btn-outline">+ {t.markup.addTier}</button>
        </div>
      </div>
      )}
    </Section>
  );
}

/** Step 7: payment terms and the PDF note. Extra services are added to the order (Orders), not to the offer. */
export function OfferLinesSection({ form, setForm, step = 7 }: SectionProps & { step?: number }) {
  const { t } = useCalcText();

  return (
    <Section step={step} title={t.lines.termsSection}>
      <div className="flex flex-col gap-4">
        <Field label={t.lines.paymentTerms} htmlFor="payment-terms">
          <input id="payment-terms" value={form.paymentTerms} onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))} className="input" />
        </Field>
        <Field label={t.markup.notes} htmlFor="offer-notes" hint={t.markup.notesHint}>
          <textarea
            id="offer-notes"
            rows={3}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            aria-describedby="offer-notes-msg"
            className="input"
          />
        </Field>
        <Toggle checked={form.includeComposition} onChange={(v) => setForm((f) => ({ ...f, includeComposition: v }))}>
          {t.markup.includeComposition}
        </Toggle>
      </div>
    </Section>
  );
}
