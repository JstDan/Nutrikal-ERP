"use client";

import { useId, useMemo, useState } from "react";
import type { CalcResult } from "@/lib/calculator/calc";
import { defaultUnitFor } from "@/lib/calculator/form";
import { parseNum } from "@/lib/calculator/numbers";
import { matchesQuery } from "@/lib/calculator/search";
import { CAPSULE_SIZES, DOSE_UNITS, isCapsule, type CapsuleSize, type FormulaRow, type RawMaterial } from "@/lib/calculator/types";
import { fieldId } from "@/lib/calculator/validation";
import { Chip } from "@/components/ui";
import type { SectionProps } from "./client-sections";
import { Field, InfoLine, Notice, NumberField, RemoveButton, Section, SummaryBox, useCalcText } from "./kit";

const MAX_OPTIONS = 60;

/** Search-as-you-type list of active raw materials (combobox pattern, keyboard friendly). */
function MaterialSearch({ materials, inFormula, onPick }: { materials: RawMaterial[]; inFormula: Set<string>; onPick: (m: RawMaterial) => void }) {
  const { t, eur } = useCalcText();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const options = useMemo(
    () => (query.trim() ? materials.filter((m) => matchesQuery(m.name, query)) : materials).slice(0, MAX_OPTIONS),
    [materials, query],
  );

  const pick = (m: RawMaterial) => {
    onPick(m);
    setQuery("");
    setOpen(false);
    setActive(0);
  };

  return (
    <div className="relative">
      <input
        id="material-search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        aria-describedby="material-search-msg"
        autoComplete="off"
        placeholder={t.formula.searchPlaceholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && options[active]) {
            e.preventDefault();
            pick(options[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="input pl-10!"
      />
      <span aria-hidden="true" className="pointer-events-none absolute top-0 left-3 flex h-11 items-center text-ink-2">⌕</span>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t.formula.search}
          className="absolute inset-x-0 top-12 z-20 m-0 max-h-80 list-none overflow-y-auto rounded-sm border border-line-strong bg-white p-1 shadow-lg"
        >
          {options.length === 0 && <li className="px-3 py-3 text-sm text-ink-2">{t.formula.noResults}</li>}
          {options.map((m, i) => (
            <li
              key={m.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the input
                pick(m);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm ${i === active ? "bg-canvas" : ""}`}
            >
              <span className="min-w-0 flex-1 break-words">
                {m.name}
                {inFormula.has(m.id) && <span className="ml-2 text-xs font-semibold text-amber-ink">({t.formula.duplicate})</span>}
              </span>
              {m.regulatory_note && <span title={t.formula.regulatory} aria-label={t.formula.regulatory} className="text-amber">⚠</span>}
              <span className="shrink-0 text-ink-2 tabular-nums">{eur(m.price_eur_per_kg)}/kg</span>
            </li>
          ))}
        </ul>
      )}
    </div>
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
            const amountInvalid = row.amount.trim() !== "" && (parseNum(row.amount) ?? 0) <= 0;
            return (
              <li
                key={row.key}
                className={`grid items-center gap-3 rounded-sm border p-3 [grid-template-areas:'name_name_remove'_'amount_unit_unit'_'price_cost_cost'] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:[grid-template-areas:'name_amount_unit_price_cost_remove'] md:grid-cols-[minmax(0,1fr)_130px_88px_96px_104px_44px] ${
                  dup ? "border-amber bg-amber-tint/40" : "border-line"
                }`}
              >
                <div className="min-w-0 [grid-area:name]">
                  <div className="text-sm font-semibold break-words">{row.name}</div>
                  {(row.regulatoryNote || dup || removed) && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {dup && <Chip tone="amber">{t.formula.duplicate}</Chip>}
                      {removed && <Chip tone="red">{t.formula.removedFromList}</Chip>}
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
