"use client";

import type { CalcResult } from "@/lib/calculator/calc";
import { parseNum } from "@/lib/calculator/numbers";
import { catalogPrice } from "@/lib/calculator/catalogImport";
import { catalogTiersFor, hasAluminiumLid, offerCapsules } from "@/lib/calculator/catalogCapsules";
import { productName } from "@/lib/calculator/offerRecord";
import { isCapsule, type OfferForm } from "@/lib/calculator/types";
import { fmt } from "@/lib/i18n";
import { Chip } from "@/components/ui";
import { InfoLine, Notice, Section, SubHeading, useCalcText } from "./kit";
import { quantityLabel, unitsLabel } from "./pricing-sections";

interface Props {
  form: OfferForm;
  result: CalcResult;
  valid: boolean;
  busy: boolean;
  /** Creates the offer (or saves the changes of an opened one) and opens its summary under Offers. */
  onCreate: () => void;
  /** Called when a disabled action is clicked: reveal errors and scroll to the first one. */
  onInvalidAttempt: () => void;
}

const GRID = "grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_130px_130px]";
const LINES_GRID = "grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_90px_100px_110px]";

export function ResultsSection({ form, result: r, valid, busy, onCreate, onInvalidAttempt }: Props) {
  const { t, eur, num, pct } = useCalcText();
  const markup = parseNum(form.markup) ?? 0;
  const catalog = form.mode === "catalog";
  const kg = (v: number) => (v > 0 && v < 1 ? `${num(v * 1000, 2)} g` : `${num(v, 3)} kg`);

  return (
    <Section title={t.results.section}>
      {!r.complete && <Notice>{t.results.incomplete}</Notice>}

      {/* A) Internal breakdown – never goes to the PDF (a catalog product has no cost breakdown) */}
      {!catalog && <div className="flex flex-col gap-4 rounded-sm border border-amber-line bg-amber-soft p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 text-base font-bold">A) {t.results.internalTitle}</h3>
          <Chip tone="amber">🔒 {t.results.internal}</Chip>
        </div>
        <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          <div>
            <InfoLine label={t.results.rawCostPerDose} value={eur(r.costPerDose, 4)} />
            <InfoLine label={t.results.dosesPerUnit} value={r.dosesPerUnit !== null ? num(r.dosesPerUnit, 2) : "–"} />
            <InfoLine label={t.results.rawCostPerUnit} value={eur(r.rawCostPerUnit, 4)} />
            <InfoLine label={t.results.fixedCostPerUnit} value={eur(r.fixedCostPerUnit)} />
            <InfoLine label={t.results.unitCost} value={eur(r.unitCost, 4)} strong />
          </div>
          <div>
            <InfoLine label={t.results.markupMargin} value={`${pct(markup)} / ${pct(r.marginPct)}`} />
            <InfoLine label={t.results.totalCost} value={eur(r.totalCost)} />
            <InfoLine label={t.results.totalProfit} value={eur(r.profit)} strong />
            {r.discountAmount > 0 && <InfoLine label={t.results.discountGiven} value={eur(r.discountAmount)} />}
            {r.extrasTotal > 0 && <InfoLine label={t.results.extrasTotal} value={eur(r.extrasTotal)} />}
          </div>
        </div>

        {form.rows.length > 0 && (
          <div className="flex flex-col gap-1">
            <SubHeading>{t.results.requirement}</SubHeading>
            <div role="table" aria-label={t.results.requirement} className="text-sm">
              <div role="row" className={`row ${GRID} hide-sm border-b border-amber-line py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2`}>
                <span role="columnheader">{t.formula.material}</span>
                <span role="columnheader" className="text-right">{t.results.requirementKg}</span>
                <span role="columnheader" className="text-right">{t.results.requirementCost}</span>
              </div>
              {r.requirements.map((line, i) => (
                <div role="row" key={form.rows[i]?.key ?? i} className={`row ${GRID} border-b border-amber-line py-2`}>
                  <span role="cell" className="min-w-0 break-words">{line.name}</span>
                  <span role="cell" className="text-right tabular-nums">
                    {kg(line.totalKg)}
                    <span className="block text-xs text-ink-2 sm:hidden">{eur(line.cost)}</span>
                  </span>
                  <span role="cell" className="hide-sm text-right tabular-nums">{eur(line.cost)}</span>
                </div>
              ))}
              <div role="row" className={`row ${GRID} py-2 font-bold`}>
                <span role="cell">{t.results.requirementTotal}</span>
                <span role="cell" className="hide-sm" />
                <span role="cell" className="text-right tabular-nums">{eur(r.requirementsTotalCost)}</span>
              </div>
            </div>
          </div>
        )}
      </div>}

      {/* B) Client offer summary – what the client sees */}
      <div className="flex flex-col gap-4 rounded-sm border-2 border-ink p-4 sm:p-5">
        <h3 className="m-0 text-base font-bold">{catalog ? "" : "B) "}{t.results.client}</h3>
        <ClientSummary form={form} result={r} />
      </div>

      <div className="flex flex-col gap-3">
        {!valid && <Notice tone="warning">{t.results.fixErrors}</Notice>}
        {/* While the form is incomplete the button stays focusable and clicking it shows what's missing. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <span className="text-xs text-ink-2 sm:mr-auto">{t.results.pdfLanguage}</span>
          <button
            type="button"
            onClick={valid ? onCreate : onInvalidAttempt}
            disabled={busy}
            aria-disabled={!valid || undefined}
            className={`btn btn-primary ${valid ? "" : "opacity-55"}`}
          >
            {form.id ? t.results.updateOffer : t.results.createOffer}
          </button>
        </div>
      </div>
    </Section>
  );
}

/** What the client sees: product, quantity, prices and the offer lines (calculator and the offer summary under Offers). */
export function ClientSummary({ form, result: r }: { form: OfferForm; result: CalcResult }) {
  const { t, eur, num, pct } = useCalcText();
  const type = form.productType;
  const units = parseNum(form.numberOfUnits) ?? 0;
  const discount = Math.min(100, Math.max(0, parseNum(form.discount) ?? 0));
  const catalog = form.mode === "catalog" ? form.catalog : null;
  const step = catalog && units ? catalogPrice(catalogTiersFor(form), units) : null;
  const caps = offerCapsules(form);

  const lines = [
    {
      key: "product",
      description: catalog
        ? caps ? fmt(t.catalog.withCapsules, { name: productName(form), n: num(caps) }) : productName(form)
        : type ? form.offer.productName || t.productType[type] : "–",
      qty: units,
      unit: t.results.pcs,
      price: r.unitPrice,
      amount: r.productAmount,
    },
    ...r.extraLines.map((l, i) => ({ key: `x${i}`, description: l.description, qty: l.qty, unit: l.unit, price: l.price, amount: l.amount })),
  ];

  return (
    <>
      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {form.mode === "catalog" ? (
          <div>
            <InfoLine label={t.results.product} value={<span className="break-words">{productName(form) || "–"}</span>} />
            <InfoLine label={t.catalog.code} value={catalog?.code ?? "–"} />
            {caps && <InfoLine label={t.catalog.capsules} value={num(caps)} />}
            {caps && (
              <InfoLine
                label={t.results.packaging}
                value={hasAluminiumLid(form) ? fmt(t.catalog.withAluminiumLid, { jar: t.productType.packaging_capsules_plastic }) : t.productType[form.jar === "glass" ? "packaging_capsules_glass" : "packaging_capsules_plastic"]}
              />
            )}
            <InfoLine label={t.results.quantity} value={units ? num(units) : "–"} />
            <InfoLine label={t.catalog.step} value={step ? fmt(t.catalog.fromQty, { n: num(step.min_qty) }) : "–"} />
          </div>
        ) : (
          <div>
            <InfoLine label={t.results.product} value={form.offer.productName || "–"} />
            <InfoLine label={t.results.type} value={type ? t.productType[type] : "–"} />
            <InfoLine label={t.results.packaging} value={type ? t.productType[`packaging_${type}`] : "–"} />
            <InfoLine label={quantityLabel(t, type)} value={form.quantityPerUnit || "–"} />
            {isCapsule(type) && <InfoLine label={t.formula.capsulesPerDose} value={form.capsulesPerDose || "–"} />}
            <InfoLine label={`${t.results.quantity} (${unitsLabel(t, type).toLowerCase()})`} value={units ? num(units) : "–"} />
          </div>
        )}
        <div>
          <InfoLine label={t.results.unitPrice} value={eur(r.unitPrice)} />
          {discount > 0 && <InfoLine label={t.results.discount} value={pct(discount, 2)} />}
          <InfoLine label={t.results.subTotal} value={eur(r.totalPriceExclVat)} strong />
        </div>
      </div>
  
      {r.complete && (
        <div className="flex flex-col gap-1">
          <SubHeading>{t.results.offerLines}</SubHeading>
          <div role="table" aria-label={t.results.offerLines} className="text-sm">
            <div role="row" className={`row ${LINES_GRID} hide-sm border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2`}>
              <span role="columnheader">{t.lines.description}</span>
              <span role="columnheader" className="text-right">{t.lines.qty}</span>
              <span role="columnheader" className="text-right">{t.lines.price}</span>
              <span role="columnheader" className="text-right">{t.lines.amount}</span>
            </div>
            {lines.map((l) => (
              <div role="row" key={l.key} className={`row ${LINES_GRID} border-b border-mist py-2 last:border-0`}>
                <span role="cell" className="min-w-0 break-words">
                  {l.description}
                  <span className="block text-xs text-ink-2 sm:hidden">
                    {num(l.qty)} {l.unit} × {eur(l.price)}
                  </span>
                </span>
                <span role="cell" className="hide-sm text-right tabular-nums">{num(l.qty)} {l.unit}</span>
                <span role="cell" className="hide-sm text-right tabular-nums">{eur(l.price)}</span>
                <span role="cell" className="text-right font-semibold tabular-nums">{eur(l.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
