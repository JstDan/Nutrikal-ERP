"use client";

import { useMemo, useState } from "react";
import { catalogMinQty, catalogPrice } from "@/lib/calculator/catalogImport";
import { ALUMINIUM_LID_EUR, CATALOG_CAPSULES_MAX, CATALOG_CAPSULES_MIN, catalogTiersFor, hasAluminiumLid, offerCapsules, offerServings, standardCapsules } from "@/lib/calculator/catalogCapsules";
import { catalogToCustom } from "@/lib/calculator/catalogToCustom";
import { parsePositiveInt } from "@/lib/calculator/numbers";
import type { CatalogProduct, FormulaMode, LidType, OfferForm, RawMaterial } from "@/lib/calculator/types";
import { fieldId } from "@/lib/calculator/validation";
import { fmt } from "@/lib/i18n";
import { Chip } from "@/components/ui";
import type { SectionProps } from "./client-sections";
import { Field, Notice, NumberField, Section, Toggle, useCalcText } from "./kit";
import { SearchCombobox } from "./search-combobox";

const MODES: FormulaMode[] = ["custom", "catalog"];
const LIDS: LidType[] = ["plastic", "aluminium"];

/** Above the form: custom formula (raw materials) or catalog product. The shared sections keep their data. */
export function FormulaModeSwitch({ form, setForm }: Pick<SectionProps, "form" | "setForm">) {
  const { t } = useCalcText();
  return (
    <fieldset className="card m-0 grid min-w-0 grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-5">
      <legend className="sr-only">{t.mode.label}</legend>
      <p aria-hidden="true" className="label m-0 sm:col-span-2">{t.mode.label}</p>
      {MODES.map((m) => {
        const selected = form.mode === m;
        return (
          <label
            key={m}
            className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-sm border-2 p-3 ${selected ? "border-ink bg-canvas" : "border-line hover:border-line-strong"}`}
          >
            <input
              type="radio"
              name="formula-mode"
              value={m}
              checked={selected}
              onChange={() => setForm((f) => ({ ...f, mode: m }))}
              className="mt-1 h-5 w-5 shrink-0 accent-ink"
            />
            <span className="flex min-w-0 flex-col gap-0.5 text-sm">
              <span className="font-semibold">{t.mode[m]}</span>
              <span className="text-ink-2">{t.mode[`${m}Hint`]}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

const productText = (p: CatalogProduct) => `${p.code} ${p.name} ${p.category ?? ""}`;
const productKey = (p: CatalogProduct) => p.id;
const sameTiers = (a: OfferForm["catalog"], b: CatalogProduct) =>
  !!a && a.name === b.name && JSON.stringify(a.tiers) === JSON.stringify(b.tiers);

/** Catalog mode, step 3: pick the product (search like raw materials); shows its price steps. */
export function CatalogProductSection({ form, setForm, errorFor, touch, catalog, materials }: SectionProps & { catalog: CatalogProduct[]; materials: RawMaterial[] }) {
  const { t, eur, num } = useCalcText();
  const c = t.catalog;
  const error = errorFor("catalogProduct");
  const picked = form.catalog;
  const current = useMemo(() => (picked ? catalog.find((p) => p.code === picked.code) : undefined), [catalog, picked]);
  const units = parsePositiveInt(form.numberOfUnits);
  const tiers = catalogTiersFor(form);
  const step = picked && units ? catalogPrice(tiers, units) : null;
  const std = standardCapsules(form);
  const servings = offerServings(form);
  const capsError = errorFor("catalogCapsules");
  const [confirmEdit, setConfirmEdit] = useState(false);
  const activeMaterials = useMemo(() => materials.filter((m) => m.active), [materials]);

  const pick = (p: CatalogProduct) => {
    const { active: _active, ...snapshot } = p;
    // Another product starts from its standard capsules per jar
    setForm((f) => ({ ...f, catalog: snapshot, catalogCapsules: f.catalog?.code === p.code ? f.catalogCapsules : "" }));
    touch("catalogProduct");
  };

  /** Custom formula from this product's ingredients, then scroll to them. */
  const editIngredients = () => {
    setConfirmEdit(false);
    setForm((f) => catalogToCustom(f, activeMaterials));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => document.getElementById(fieldId("rows"))?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }), 0);
  };

  return (
    <Section step={3} title={c.section} id={fieldId("catalogProduct")} required>
      <Field label={c.search} htmlFor="catalog-search" error={error} hint={catalog.length ? c.hint : c.empty}>
        <SearchCombobox
          id="catalog-search"
          items={catalog}
          searchText={productText}
          optionKey={productKey}
          onPick={pick}
          placeholder={c.searchPlaceholder}
          listLabel={c.search}
          noResults={c.noResults}
          invalid={!!error}
          renderOption={(p) => (
            <>
              <span className="min-w-0 flex-1 break-words">
                <span className="font-semibold">{p.code}</span> {p.name}
                {p.category && <span className="block text-xs text-ink-2">{p.category}</span>}
              </span>
              <span className="shrink-0 text-right text-ink-2 tabular-nums">
                {fmt(c.fromPrice, { price: eur(Math.min(...p.tiers.map((x) => x.price))) })}
              </span>
            </>
          )}
        />
      </Field>

      {picked && (
        <div className="flex flex-col gap-3 rounded-sm border-2 border-ink p-4">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-[1_1_240px]">
              <div className="text-xs text-ink-2">{c.code}: {picked.code}{picked.category && ` · ${picked.category}`}</div>
              <div className="text-base font-bold break-words">{picked.name}</div>
            </div>
            {!current && <Chip tone="red">{c.removed}</Chip>}
          </div>
          {std && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label={c.capsules}
                htmlFor={fieldId("catalogCapsules")}
                error={capsError}
                hint={fmt(c.capsulesHint, { std: num(std), min: num(CATALOG_CAPSULES_MIN), max: num(CATALOG_CAPSULES_MAX) })}
              >
                <NumberField
                  id={fieldId("catalogCapsules")}
                  integer
                  value={form.catalogCapsules}
                  placeholder={String(std)}
                  onChange={(v) => setForm((f) => ({ ...f, catalogCapsules: v }))}
                  onBlur={() => touch("catalogCapsules")}
                  invalid={!!capsError}
                />
              </Field>
              <div className="flex min-w-0 flex-col gap-1 text-sm">
                <span className="label">{c.servings}</span>
                <span className="flex min-h-11 items-center font-bold tabular-nums">
                  {servings ? fmt(c.servingsValue, { n: num(servings), caps: num(picked.capsules_per_serving ?? 0) }) : "–"}
                </span>
              </div>
            </div>
          )}
          {std && (
            <div className="flex flex-col gap-1">
              <Toggle checked={form.jar === "glass"} onChange={(v) => setForm((f) => ({ ...f, jar: v ? "glass" : "plastic" }))}>
                {c.glassJar}
              </Toggle>
              {/* A glass jar comes with its own lid */}
              {form.jar !== "glass" && (
                <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
                  <legend className="label mb-1 p-0">{c.lid}</legend>
                  <div className="flex flex-wrap gap-x-6">
                    {LIDS.map((l) => (
                      <label key={l} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                        <input
                          type="radio"
                          name="catalog-lid"
                          value={l}
                          checked={form.lid === l}
                          onChange={() => setForm((f) => ({ ...f, lid: l }))}
                          className="h-5 w-5 shrink-0 accent-ink"
                        />
                        <span>
                          {c[`lid_${l}`]}
                          {l === "aluminium" && <span className="text-ink-2"> ({fmt(c.lidExtra, { price: eur(ALUMINIUM_LID_EUR) })})</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>
          )}
          <div role="table" aria-label={c.steps} className="text-sm">
            <div role="row" className="row hide-sm grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-2 text-xs font-semibold tracking-[1px] uppercase text-ink-2">
              <span role="columnheader">{c.quantity}</span>
              <span role="columnheader" className="text-right">{c.unitPrice}</span>
            </div>
            {tiers.map((x) => {
              const applies = step?.min_qty === x.min_qty;
              return (
                <div role="row" key={x.min_qty} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-2 last:border-0 ${applies ? "font-bold" : ""}`}>
                  <span role="cell">
                    {fmt(c.fromQty, { n: num(x.min_qty) })}
                    {applies && <span className="ml-2"><Chip tone="green">{c.applies}</Chip></span>}
                  </span>
                  <span role="cell" className="text-right tabular-nums">{eur(x.price)}</span>
                </div>
              );
            })}
          </div>
          <p className="m-0 text-xs text-ink-2">
            {fmt(c.minQty, { n: num(catalogMinQty(picked.tiers)) })}
            {std && offerCapsules(form) !== std && <> · {fmt(c.pricesFor, { n: num(std) })}</>}
            {hasAluminiumLid(form) && <> · {fmt(c.lidIncluded, { price: eur(ALUMINIUM_LID_EUR) })}</>}
          </p>
          {picked.composition && picked.composition.length > 0 && (
            <details className="text-sm">
              <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{c.composition}</summary>
              <div role="table" aria-label={c.composition}>
                {picked.composition.map((x, i) => (
                  <div role="row" key={i} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-1.5 last:border-0">
                    <span role="cell" className="min-w-0 break-words">
                      {x.name}
                      {x.note && <span className="block text-xs text-ink-2">{x.note}</span>}
                    </span>
                    <span role="cell" className="text-right tabular-nums">{num(x.amount)} {x.unit}</span>
                  </div>
                ))}
              </div>
              <p className="m-0 mt-1 text-xs text-ink-2">{c.compositionHint}</p>
            </details>
          )}
          {picked.composition && picked.composition.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={form.rows.length ? () => setConfirmEdit(true) : editIngredients}
                  aria-expanded={form.rows.length ? confirmEdit : undefined}
                  aria-describedby="edit-ingredients-hint"
                  className="btn btn-outline whitespace-normal!"
                >
                  {c.editIngredients}
                </button>
                <span id="edit-ingredients-hint" className="min-w-0 flex-[1_1_240px] text-xs text-ink-2">{c.editIngredientsHint}</span>
              </div>
              {confirmEdit && (
                <div role="alertdialog" aria-label={c.editConfirm} className="flex flex-wrap items-center gap-3 rounded-sm border border-amber-line bg-amber-tint px-4 py-3">
                  <span className="min-w-0 flex-[1_1_240px] text-sm font-semibold text-amber-ink">{c.editConfirm}</span>
                  <button type="button" autoFocus onClick={() => setConfirmEdit(false)} className="btn btn-outline">{t.cancel}</button>
                  <button type="button" onClick={editIngredients} className="btn btn-primary">{c.replace}</button>
                </div>
              )}
            </div>
          )}
          {current && !sameTiers(picked, current) && (
            <Notice action={<button type="button" onClick={() => pick(current)} className="btn btn-outline whitespace-normal!">{c.updatePrices}</button>}>
              {c.pricesChanged}
            </Notice>
          )}
        </div>
      )}
    </Section>
  );
}
