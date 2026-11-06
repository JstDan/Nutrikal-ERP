"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveRegulatoryNote, updateRawMaterial } from "@/app/calculator/actions";
import { parseNum } from "@/lib/calculator/numbers";
import { matchesQuery } from "@/lib/calculator/search";
import type { RawMaterial } from "@/lib/calculator/types";
import { fmt, type Locale } from "@/lib/i18n";
import { Chip, Empty } from "@/components/ui";
import { AddMaterialDialog } from "./add-material-dialog";
import { CalcTextProvider, Notice, NumberField, Toast, useCalcText, useToast, type CalcDict } from "./kit";

type Props = {
  t: CalcDict;
  locale: Locale;
  materials: RawMaterial[];
  isAdmin: boolean;
};

export function MaterialsView(props: Props) {
  return (
    <CalcTextProvider t={props.t} locale={props.locale}>
      <Materials {...props} />
    </CalcTextProvider>
  );
}

const GRID = "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_130px_minmax(0,1.2fr)_130px]";

/**
 * The price list of the calculator. It lives in the database (owner, Nov 2026): Admin and Sales change names, prices
 * and status here; nothing is deleted. Every material is listed with its status. The regulatory note is Admin only.
 */
function Materials({ materials, isAdmin }: Props) {
  const { t } = useCalcText();
  const m = t.materials;
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const { toast, show, clear } = useToast();

  const filtered = useMemo(
    () => materials.filter((x) => matchesQuery(x.name, query)),
    [materials, query],
  );

  const saveNote = async (x: RawMaterial, note: string | null) => {
    const res = await saveRegulatoryNote(x.id, note);
    if (!res.ok) return show("error", res.error);
    show("success", fmt(m.noteSaved, { name: x.name }));
    router.refresh();
  };
  const save = async (x: RawMaterial, patch: Partial<{ name: string; price: number; active: boolean }>) => {
    const res = await updateRawMaterial(x.id, { name: x.name, price: x.price_eur_per_kg, active: x.active, ...patch });
    if (!res.ok) return show("error", res.error);
    show("success", fmt(m.saved, { name: res.data.name }));
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-5">
      <Notice>{m.managedHere}</Notice>

      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-[1_1_280px]">
          <label htmlFor="material-filter" className="sr-only">{m.search}</label>
          <input id="material-filter" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={m.search} className="input" />
        </div>
        <span className="text-sm text-ink-2">{fmt(m.count, { n: materials.filter((x) => x.active).length })}</span>
        <button type="button" onClick={() => setAdding(true)} className="btn btn-primary" aria-haspopup="dialog">{m.add}</button>
      </div>

      <section aria-label={m.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm ${GRID} border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2`}>
          <span>{m.name}</span>
          <span className="text-right">{m.price}</span>
          <span>{m.note}</span>
          <span>{m.status}</span>
        </div>
        {filtered.length === 0 && <div className="py-4"><Empty>{t.formula.noResults}</Empty></div>}
        {filtered.map((x) => (
          <EditRow key={x.id} x={x} onSave={(patch) => save(x, patch)} onNote={isAdmin ? (note) => saveNote(x, note) : undefined} />
        ))}
      </section>

      {adding && (
        <AddMaterialDialog initialName={query} onClose={() => setAdding(false)}
          onAdded={(x) => { setAdding(false); show("success", fmt(m.saved, { name: x.name })); }} />
      )}
      <Toast toast={toast} onClose={clear} closeLabel={t.close} />
    </div>
  );
}

function StatusChip({ active }: { active: boolean }) {
  const { t } = useCalcText();
  return active ? <Chip tone="green">{t.materials.statusActive}</Chip> : <Chip>{t.materials.statusInactive}</Chip>;
}

/**
 * Name and price save when leaving the field; the status button switches at once. The regulatory note is edited
 * only by Admin (onNote); Sales sees it as text.
 */
function EditRow({ x, onSave, onNote }: {
  x: RawMaterial;
  onSave: (patch: Partial<{ name: string; price: number; active: boolean }>) => void;
  onNote?: (note: string | null) => void;
}) {
  const { t, locale } = useCalcText();
  const m = t.materials;
  const priceText = (n: number) => String(n).replace(".", locale === "bg" ? "," : ".");
  const [name, setName] = useState(x.name);
  const [price, setPrice] = useState(priceText(x.price_eur_per_kg));
  const [seen, setSeen] = useState(x);
  if (seen !== x) {
    setSeen(x);
    setName(x.name);
    setPrice(priceText(x.price_eur_per_kg));
  }
  const p = parseNum(price);

  return (
    <div className={`row ${GRID} items-start border-b border-mist py-3 text-sm last:border-0`}>
      <input aria-label={`${m.name} – ${x.name}`} value={name} maxLength={200} onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name.trim() !== x.name ? onSave({ name: name.trim() }) : setName(x.name)}
        className={`input min-w-0 ${x.active ? "" : "text-ink-2"}`} />
      <NumberField aria-label={`${m.price} – ${x.name}`} value={price} onChange={setPrice} suffix="€" invalid={p === null || p <= 0}
        onBlur={() => (p !== null && p > 0 ? p !== x.price_eur_per_kg && onSave({ price: p }) : setPrice(priceText(x.price_eur_per_kg)))} />
      <div className="col-span-2 min-w-0 md:col-span-1">
        {onNote ? (
          <NoteCell material={x} label={`${m.note} – ${x.name}`} onSave={onNote} />
        ) : x.regulatory_note ? (
          <span className="block py-2.5 break-words text-amber-ink">⚠ {x.regulatory_note}</span>
        ) : (
          <span className="hide-sm block py-2.5 text-ink-2">–</span>
        )}
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1">
        <StatusChip active={x.active} />
        <button type="button" onClick={() => onSave({ active: !x.active })} className="btn btn-outline min-h-11">
          {x.active ? m.deactivate : m.activate}
        </button>
      </div>
    </div>
  );
}

/** The regulatory note saves when leaving the field. */
function NoteCell({ material, label, onSave }: { material: RawMaterial; label: string; onSave: (note: string | null) => void }) {
  const current = material.regulatory_note ?? "";
  const [value, setValue] = useState(current);
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setValue(current);
  }
  return (
    <textarea
      aria-label={label}
      rows={1}
      value={value}
      placeholder="–"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value.trim() !== current && onSave(value.trim() || null)}
      className={`input min-h-11! py-2.5! ${value ? "text-amber-ink!" : ""}`}
    />
  );
}
