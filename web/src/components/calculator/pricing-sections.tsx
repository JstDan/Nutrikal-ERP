"use client";

import { marginFromMarkup, unitPriceFor, type CalcResult } from "@/lib/calculator/calc";
import { catalogMinQty } from "@/lib/calculator/catalogImport";
import { parseNum } from "@/lib/calculator/numbers";
import { isCapsule, type ExtraItem, type PriceTier, type ServicePreset } from "@/lib/calculator/types";
import { fieldId } from "@/lib/calculator/validation";
import { fmt } from "@/lib/i18n";
import type { SectionProps } from "./client-sections";
import { Field, InfoLine, Notice, NumberField, RemoveButton, Section, SubHeading, SummaryBox, Toggle, inputClass, useCalcText, type CalcDict } from "./kit";

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
        <SummaryBox>
          {capsule && (
            <InfoLine label={t.quantity.dosesPerBottle} value={result.dosesPerUnit !== null ? num(result.dosesPerUnit, 2) : "–"} />
          )}
          {form.productType === "powder" && (
            <InfoLine label={t.quantity.netWeight} value={result.netWeightPerPouchG !== null ? `${num(result.netWeightPerPouchG, 2)} g` : "–"} />
          )}
          {!form.productType && <p className="my-2 text-sm text-ink-2">{t.quantity.selectType}</p>}
        </SummaryBox>
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

  const addTier = () => setForm((f) => ({ ...f, priceTiers: [...f.priceTiers, { key: crypto.randomUUID(), qty: "", markup: "" }] }));
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
          const tierMarkup = parseNum(tier.markup);
          const price = costKnown && tierMarkup !== null ? unitPriceFor(unitCost, tierMarkup) : null;
          return (
            <div key={tier.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3 rounded-sm border border-line p-3 md:grid-cols-[160px_160px_minmax(0,1fr)_auto]">
              <Field label={t.markup.tierQty} htmlFor={`tier-qty-${tier.key}`}>
                <NumberField id={`tier-qty-${tier.key}`} integer value={tier.qty} onChange={(v) => updateTier(tier.key, { qty: v })} suffix={t.results.pcs} />
              </Field>
              <Field label={t.markup.markup} htmlFor={`tier-markup-${tier.key}`}>
                <NumberField id={`tier-markup-${tier.key}`} value={tier.markup} onChange={(v) => updateTier(tier.key, { markup: v })} suffix="%" />
              </Field>
              <div className="col-span-3 row-start-2 min-w-0 text-[13px] text-ink-2 md:col-span-1 md:row-start-auto md:self-center">
                {!costKnown ? (
                  t.markup.tierNeedsFormula
                ) : price !== null && tierMarkup !== null ? (
                  <>
                    <div className="font-semibold text-ink">{fmt(t.markup.tierPrice, { price: eur(price) })}</div>
                    <div>{t.markup.margin}: {pct(marginFromMarkup(tierMarkup))}</div>
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

/** Step 7: extra offer lines (certificates, design…), payment terms and the PDF note. */
export function OfferLinesSection({ form, setForm, errorFor, presets, step = 7 }: SectionProps & { presets: ServicePreset[]; step?: number }) {
  const { t, eur } = useCalcText();
  const error = errorFor("extraItems");

  const addItem = (item: Omit<ExtraItem, "key">) =>
    setForm((f) => ({ ...f, extraItems: [...f.extraItems, { key: crypto.randomUUID(), ...item }] }));
  const updateItem = (key: string, patch: Partial<ExtraItem>) =>
    setForm((f) => ({ ...f, extraItems: f.extraItems.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  const removeItem = (key: string) => setForm((f) => ({ ...f, extraItems: f.extraItems.filter((x) => x.key !== key) }));

  return (
    <Section step={step} title={t.lines.section} id={fieldId("extraItems")}>
      <div className="flex flex-col gap-3">
        <SubHeading>{t.lines.extraItems}</SubHeading>
        <p className="m-0 text-[13px] text-ink-2">{t.lines.extraHint}</p>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.description}
              type="button"
              onClick={() => addItem({ description: p.description, qty: "1", unit: p.unit, price: String(p.price) })}
              className="btn btn-outline h-auto! py-2! text-left whitespace-normal!"
            >
              + {p.description} · {eur(p.price)}
            </button>
          ))}
          <button type="button" onClick={() => addItem({ description: "", qty: "1", unit: "pcs.", price: "" })} className="btn btn-outline">
            + {t.lines.customItem}
          </button>
        </div>

        {form.extraItems.map((item) => {
          const qty = parseNum(item.qty);
          const price = parseNum(item.price);
          const amount = qty && price !== null ? qty * price : 0;
          return (
            <div
              key={item.key}
              className="grid items-end gap-3 rounded-sm border border-line p-3 [grid-template-areas:'desc_desc_remove'_'qty_unit_unit'_'price_amount_amount'] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:[grid-template-areas:'desc_qty_unit_price_amount_remove'] md:grid-cols-[minmax(0,1fr)_80px_88px_120px_100px_44px]"
            >
              <Field label={t.lines.description} htmlFor={`item-desc-${item.key}`} className="[grid-area:desc]">
                <input
                  id={`item-desc-${item.key}`}
                  value={item.description}
                  onChange={(e) => updateItem(item.key, { description: e.target.value })}
                  className={inputClass(!!error && !item.description.trim())}
                />
              </Field>
              <Field label={t.lines.qty} htmlFor={`item-qty-${item.key}`} className="[grid-area:qty]">
                <NumberField id={`item-qty-${item.key}`} value={item.qty} onChange={(v) => updateItem(item.key, { qty: v })} invalid={!!error && !(qty && qty > 0)} />
              </Field>
              <Field label={t.lines.unit} htmlFor={`item-unit-${item.key}`} className="[grid-area:unit]">
                <input id={`item-unit-${item.key}`} value={item.unit} onChange={(e) => updateItem(item.key, { unit: e.target.value })} className="input" />
              </Field>
              <Field label={t.lines.price} htmlFor={`item-price-${item.key}`} className="[grid-area:price]">
                <NumberField id={`item-price-${item.key}`} value={item.price} onChange={(v) => updateItem(item.key, { price: v })} invalid={!!error && price === null} suffix="€" />
              </Field>
              <div className="flex min-h-11 flex-col justify-center text-right [grid-area:amount]">
                <div className="text-xs text-ink-2">{t.lines.amount}</div>
                <div className="text-sm font-semibold tabular-nums">{eur(amount)}</div>
              </div>
              <div className="justify-self-end [grid-area:remove]">
                <RemoveButton label={`${t.remove} ${item.description}`} onClick={() => removeItem(item.key)} />
              </div>
            </div>
          );
        })}
        {error && <p className="m-0 text-xs font-semibold text-red-ink">{error}</p>}
      </div>

      <div className="flex flex-col gap-4 border-t border-mist pt-5">
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
        {form.mode !== "catalog" && <Toggle checked={form.includeComposition} onChange={(v) => setForm((f) => ({ ...f, includeComposition: v }))}>
          {t.markup.includeComposition}
        </Toggle>}
      </div>
    </Section>
  );
}
