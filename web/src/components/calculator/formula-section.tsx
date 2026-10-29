"use client";

import { useMemo, useState } from "react";
import type { CalcResult } from "@/lib/calculator/calc";
import { isUnmatched, needsCheck } from "@/lib/calculator/catalogToCustom";
import { defaultUnitFor } from "@/lib/calculator/form";
import { parseNum } from "@/lib/calculator/numbers";
import { CAPSULE_SIZES, DOSE_UNITS, isCapsule, type CapsuleSize, type FormulaRow, type RawMaterial } from "@/lib/calculator/types";
import { fieldId } from "@/lib/calculator/validation";
import { fmt } from "@/lib/i18n";
import { Chip } from "@/components/ui";
import type { SectionProps } from "./client-sections";
import { Field, InfoLine, Notice, NumberField, RemoveButton, Section, SummaryBox, useCalcText } from "./kit";
import { AddMaterialPrompt } from "./add-material-dialog";
import { SearchCombobox } from "./search-combobox";

const materialText = (m: RawMaterial) => m.name;
const materialKey = (m: RawMaterial) => m.id;

/** Search-as-you-type list of active raw materials; one that is not there can be added with its price. */
function MaterialSearch({ materials, inFormula, onPick, id = "material-search", label, invalid }: {
  materials: RawMaterial[]; inFormula: Set<string>; onPick: (m: RawMaterial) => void; id?: string; label?: string; invalid?: boolean;
}) {
  const { t, eur } = useCalcText();
  return (
    <SearchCombobox
      id={id}
      items={materials}
      searchText={materialText}
      optionKey={materialKey}
      onPick={onPick}
      placeholder={t.formula.searchPlaceholder}
      listLabel={label ?? t.formula.search}
      invalid={invalid}
      noResults={t.formula.noResults}
      emptyAction={(query) => <AddMaterialPrompt query={query} onAdded={onPick} />}
      renderOption={(m) => (
        <>
          <span className="min-w-0 flex-1 break-words">
            {m.name}
            {inFormula.has(m.id) && <span className="ml-2 text-xs font-semibold text-amber-ink">({t.formula.duplicate})</span>}
            {m.manual && <span className="block text-xs font-semibold text-amber-ink">{t.formula.manualChip}</span>}
          </span>
          {m.regulatory_note && <span title={t.formula.regulatory} aria-label={t.formula.regulatory} className="text-amber">⚠</span>}
          <span className="shrink-0 text-ink-2 tabular-nums">{eur(m.price_eur_per_kg)}/kg</span>
        </>
      )}
    />
  );
}

interface Props extends SectionProps {
  materials: RawMaterial[];
  result: CalcResult;
}

/** Step 4: raw materials for one dose, capsule settings and dose summary. */
export function FormulaSection({ form, setForm, errorFor, touch, materials, result }: Props) {
  const { t, eur, num } = useCalcText();
  const capsule = isCapsule(form.productType);
  const rowsError = errorFor("rows");
  const capsError = errorFor("capsulesPerDose");

  const active = useMemo(() => materials.filter((m) => m.active), [materials]);
  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const idCounts = useMemo(() => {
    const counts = new Map<string, number>();
    form.rows.forEach((r) => r.materialId && counts.set(r.materialId, (counts.get(r.materialId) ?? 0) + 1));
    return counts;
  }, [form.rows]);
  const inFormula = useMemo(() => new Set(idCounts.keys()), [idCounts]);
  /** Row whose material is being changed (a matched catalog ingredient). */
  const [changing, setChanging] = useState<string | null>(null);

  const staleRows = form.rows.filter((r) => {
    const m = r.materialId ? byId.get(r.materialId) : undefined;
    return m && (m.price_eur_per_kg !== r.pricePerKg || (m.regulatory_note ?? null) !== r.regulatoryNote);
  });

  const addMaterial = (m: RawMaterial) => {
    const key = crypto.randomUUID();
    setForm((f) => ({
      ...f,
      rows: [
        ...f.rows,
        { key, materialId: m.id, name: m.name, pricePerKg: m.price_eur_per_kg, regulatoryNote: m.regulatory_note, amount: "", unit: defaultUnitFor(f) },
      ],
    }));
    touch("rows");
    // Focus the amount input of the new row once it renders.
    setTimeout(() => document.getElementById(`amount-${key}`)?.focus(), 0);
  };

  const updateRow = (key: string, patch: Partial<FormulaRow>) =>
    setForm((f) => ({ ...f, rows: f.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  /** Raw material for an ingredient taken from a catalog product (checked by hand from now on). */
  const setMaterial = (key: string, m: RawMaterial) => {
    updateRow(key, { materialId: m.id, name: m.name, pricePerKg: m.price_eur_per_kg, regulatoryNote: m.regulatory_note, catalogName: undefined });
    setChanging((s) => (s === key ? null : s));
  };
  const removeRow = (key: string) => setForm((f) => ({ ...f, rows: f.rows.filter((r) => r.key !== key) }));
  const refreshPrices = () =>
    setForm((f) => ({
      ...f,
      rows: f.rows.map((r) => {
        const m = r.materialId ? byId.get(r.materialId) : undefined;
        return m ? { ...r, name: m.name, pricePerKg: m.price_eur_per_kg, regulatoryNote: m.regulatory_note } : r;
      }),
    }));

  const doseG = result.doseWeightMg / 1000;
  const maxFill = parseNum(form.maxFillMg);
  const overfill = capsule && result.fillWeightPerCapsuleMg !== null && maxFill !== null && result.fillWeightPerCapsuleMg > maxFill;

  return (
    <Section step={4} title={t.formula.section} id={fieldId("rows")} required>
      <Field
        label={t.formula.search}
        htmlFor="material-search"
        hint={
          <>
            {t.formula.helper}
            {!form.productType && <span className="mt-1 block">{t.formula.selectTypeFirst}</span>}
          </>
        }
      >
        <MaterialSearch materials={active} inFormula={inFormula} onPick={addMaterial} />
      </Field>

      {staleRows.length > 0 && (
        <Notice
          action={
            <button type="button" onClick={refreshPrices} className="btn btn-outline whitespace-normal!">
              {t.formula.updatePrices}
            </button>
          }
        >
          {t.formula.pricesChanged}
        </Notice>
      )}

      {form.rows.length === 0 ? (
        <p className={`m-0 rounded-sm border border-dashed px-4 py-6 text-center text-sm ${rowsError ? "border-red text-red-ink" : "border-line-strong text-ink-2"}`}>
          {t.formula.empty}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t.formula.section}>
          {form.rows.map((row, i) => {
            const dup = !!row.materialId && (idCounts.get(row.materialId) ?? 0) > 1;
            const removed = !!row.materialId && byId.get(row.materialId)?.active === false;
            const manual = !!row.materialId && !!byId.get(row.materialId)?.manual;
            const amountInvalid = row.amount.trim() !== "" && (parseNum(row.amount) ?? 0) <= 0;
            const unmatched = isUnmatched(row);
            const check = needsCheck(row);
            return (
              <li
                key={row.key}
                className={`grid items-center gap-3 rounded-sm border p-3 [grid-template-areas:'name_name_remove'_'amount_unit_unit'_'price_cost_cost'] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:[grid-template-areas:'name_amount_unit_price_cost_remove'] md:grid-cols-[minmax(0,1fr)_130px_88px_96px_104px_44px] ${
                  unmatched ? "border-red" : dup ? "border-amber bg-amber-tint/40" : "border-line"
                }`}
              >
                <div className="min-w-0 [grid-area:name]">
                  <div className="text-sm font-semibold break-words">{row.name}</div>
                  {(row.regulatoryNote || dup || removed || manual || unmatched || check) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {unmatched && <Chip tone="red">{t.formula.notInList}</Chip>}
                      {check && <Chip tone="amber">{t.formula.checkMatch}</Chip>}
                      {dup && <Chip tone="amber">{t.formula.duplicate}</Chip>}
                      {removed && <Chip tone="red">{t.formula.removedFromList}</Chip>}
                      {manual && <Chip tone="amber">{t.formula.manualChip}</Chip>}
                    </div>
                  )}
                  {check && row.catalogName && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
                      <span className="min-w-0 break-words">{fmt(t.formula.fromCatalog, { name: row.catalogName })}</span>
                      <button
                        type="button"
                        onClick={() => setChanging((s) => (s === row.key ? null : row.key))}
                        aria-expanded={changing === row.key}
                        className="min-h-11 cursor-pointer font-semibold text-ink underline"
                      >
                        {t.formula.changeMaterial}
                      </button>
                    </div>
                  )}
                  {(unmatched || changing === row.key) && (
                    <div className="mt-2">
                      <label htmlFor={`material-${row.key}`} className="sr-only">{fmt(t.formula.materialFor, { name: row.catalogName ?? row.name })}</label>
                      <MaterialSearch
                        id={`material-${row.key}`}
                        label={fmt(t.formula.materialFor, { name: row.catalogName ?? row.name })}
                        materials={active}
                        inFormula={inFormula}
                        onPick={(m) => setMaterial(row.key, m)}
                        invalid={unmatched && !!rowsError}
                      />
                    </div>
                  )}
                  {row.regulatoryNote && (
                    <p className="mt-1.5 mb-0 text-xs break-words text-amber-ink">
                      <span aria-hidden="true">⚠ </span>
                      <b>{t.formula.regulatory}:</b> {row.regulatoryNote}
                    </p>
                  )}
                </div>
                <div className="min-w-0 [grid-area:amount]">
                  <label htmlFor={`amount-${row.key}`} className="mb-1 block text-xs text-ink-2 md:sr-only">{t.formula.amount}</label>
                  <NumberField
                    id={`amount-${row.key}`}
                    aria-label={`${t.formula.amount} – ${row.name}`}
                    value={row.amount}
                    onChange={(v) => updateRow(row.key, { amount: v })}
                    invalid={amountInvalid}
                  />
                </div>
                <div className="min-w-0 [grid-area:unit]">
                  <label htmlFor={`unit-${row.key}`} className="mb-1 block text-xs text-ink-2 md:sr-only">{t.formula.unit}</label>
                  <select
                    id={`unit-${row.key}`}
                    aria-label={`${t.formula.unit} – ${row.name}`}
                    value={row.unit}
                    onChange={(e) => updateRow(row.key, { unit: e.target.value as FormulaRow["unit"] })}
                    className="input"
                  >
                    {DOSE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="min-w-0 [grid-area:price] md:text-right">
                  <div className="text-xs text-ink-2">{t.formula.pricePerKg}</div>
                  <div className="text-sm tabular-nums">{eur(row.pricePerKg)}</div>
                </div>
                <div className="min-w-0 text-right [grid-area:cost]">
                  <div className="text-xs text-ink-2">{t.formula.costPerDose}</div>
                  <div className="text-sm font-semibold tabular-nums">{eur(result.rowCostsPerDose[i] ?? 0, 4)}</div>
                </div>
                <div className="justify-self-end [grid-area:remove]">
                  <RemoveButton label={`${t.remove} ${row.name}`} onClick={() => removeRow(row.key)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {rowsError && <p className="m-0 text-xs font-semibold text-red-ink">{rowsError}</p>}

      {capsule && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label={t.formula.capsulesPerDose} htmlFor={fieldId("capsulesPerDose")} required error={capsError} className="col-span-2 sm:col-span-1">
            <NumberField
              id={fieldId("capsulesPerDose")}
              integer
              value={form.capsulesPerDose}
              onChange={(v) => setForm((f) => ({ ...f, capsulesPerDose: v }))}
              onBlur={() => touch("capsulesPerDose")}
              invalid={!!capsError}
            />
          </Field>
          <Field label={t.formula.capsuleSize} htmlFor="capsule-size">
            <select
              id="capsule-size"
              value={form.capsuleSize}
              onChange={(e) => {
                const size = e.target.value as CapsuleSize;
                setForm((f) => ({ ...f, capsuleSize: size, maxFillMg: String(CAPSULE_SIZES[size]) }));
              }}
              className="input"
            >
              {(Object.keys(CAPSULE_SIZES) as CapsuleSize[]).map((s) => <option key={s} value={s}>{t.formula[s]}</option>)}
            </select>
          </Field>
          <Field label={t.formula.maxFill} htmlFor="max-fill">
            <NumberField id="max-fill" value={form.maxFillMg} onChange={(v) => setForm((f) => ({ ...f, maxFillMg: v }))} />
          </Field>
        </div>
      )}
      {overfill && <Notice tone="warning">⚠ {t.formula.overfill}</Notice>}

      <SummaryBox>
        <InfoLine label={t.formula.totalDoseWeight} value={`${num(result.doseWeightMg, 3)} mg · ${num(doseG, 4)} g`} />
        {capsule && result.fillWeightPerCapsuleMg !== null && (
          <InfoLine label={t.formula.fillWeight} value={`${num(result.fillWeightPerCapsuleMg, 1)} mg`} />
        )}
        {form.productType === "powder" && <InfoLine label={t.formula.scoopSize} value={`${num(doseG, 3)} g`} />}
        <InfoLine label={t.formula.rawCostPerDose} value={eur(result.costPerDose, 4)} strong />
      </SummaryBox>
    </Section>
  );
}
