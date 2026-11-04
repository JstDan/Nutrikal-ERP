"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { addRawMaterial, deleteRawMaterial, saveRegulatoryNote, updateRawMaterial } from "@/app/calculator/actions";
import { parseNum } from "@/lib/calculator/numbers";
import { matchesQuery } from "@/lib/calculator/search";
import type { RawMaterial } from "@/lib/calculator/types";
import { fmt, type Locale } from "@/lib/i18n";
import { Chip, Empty } from "@/components/ui";
import { CalcTextProvider, Field, NumberField, Toast, Toggle, useCalcText, useToast, type CalcDict } from "./kit";

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

const GRID = "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_130px_minmax(0,1.2fr)_200px]";
const ICON_BTN = "grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-sm border border-line-strong bg-white text-ink-2";

/** The price list of the calculator, kept by hand: add, rename, change the price, delete (Admin, Sales). */
function Materials({ materials, isAdmin }: Props) {
  const { t, eur } = useCalcText();
  const m = t.materials;
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RawMaterial | null>(null);
  const { toast, show, clear } = useToast();

  const filtered = useMemo(
    () => materials.filter((x) => (showInactive || x.active) && matchesQuery(x.name, query)),
    [materials, showInactive, query],
  );

  const saveNote = async (x: RawMaterial, note: string | null) => {
    const res = await saveRegulatoryNote(x.id, note);
    if (!res.ok) return show("error", res.error);
    show("success", fmt(m.noteSaved, { name: x.name }));
    router.refresh();
  };

  const add = async (name: string, price: number) => {
    const res = await addRawMaterial(name, price);
    if (!res.ok) return res.error;
    setAdding(false);
    show("success", fmt(m.added, { name: res.data.name }));
    router.refresh();
    return null;
  };

  const update = async (x: RawMaterial, name: string, price: number) => {
    const res = await updateRawMaterial(x.id, name, price);
    if (!res.ok) return res.error;
    setEditing(null);
    show("success", fmt(m.updated, { name: name.trim() }));
    router.refresh();
    return null;
  };

  const remove = async (x: RawMaterial) => {
    const res = await deleteRawMaterial(x.id);
    setDeleting(null);
    if (!res.ok) return show("error", res.error);
    show("success", fmt(m.deleted, { name: x.name }));
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={() => setAdding(true)} disabled={adding} className="btn btn-primary">{m.add}</button>
        <div className="min-w-0 flex-[1_1_280px]">
          <label htmlFor="material-filter" className="sr-only">{m.search}</label>
          <input id="material-filter" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={m.search} className="input" />
        </div>
        <Toggle checked={showInactive} onChange={setShowInactive}>{m.showInactive}</Toggle>
        <span className="text-sm text-ink-2">{fmt(m.count, { n: materials.filter((x) => x.active).length })}</span>
      </div>

      {adding && (
        <section aria-labelledby="add-material-title" className="card flex flex-col gap-3 p-5">
          <h2 id="add-material-title" className="m-0 text-lg font-bold">{m.addTitle}</h2>
          <MaterialForm idPrefix="new-material" submitLabel={m.add} onSubmit={add} onCancel={() => setAdding(false)} />
        </section>
      )}

      <section aria-label={m.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm ${GRID} border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2`}>
          <span>{m.name}</span>
          <span className="text-right">{m.price}</span>
          <span>{m.note}</span>
          <span>{m.status}</span>
        </div>
        {filtered.length === 0 && <div className="py-4"><Empty>{t.formula.noResults}</Empty></div>}
        {filtered.map((x) =>
          editing === x.id ? (
            <div key={x.id} className="border-b border-mist py-3 last:border-0">
              <MaterialForm
                idPrefix={`edit-${x.id}`}
                initial={x}
                submitLabel={t.settings.saveSettings}
                onSubmit={(name, price) => update(x, name, price)}
                onCancel={() => setEditing(null)}
              />
            </div>
          ) : (
            <div key={x.id} className={`row ${GRID} border-b border-mist py-3 text-sm last:border-0`}>
              <span className={`min-w-0 font-medium break-words ${x.active ? "" : "text-ink-2"}`}>{x.name}</span>
              <span className="text-right tabular-nums">{eur(x.price_eur_per_kg)}</span>
              <div className="col-span-2 min-w-0 md:col-span-1">
                {isAdmin ? (
                  <NoteCell material={x} label={`${m.note} – ${x.name}`} onSave={(note) => saveNote(x, note)} />
                ) : x.regulatory_note ? (
                  <span className="break-words text-amber-ink">⚠ {x.regulatory_note}</span>
                ) : (
                  <span className="hide-sm text-ink-2">–</span>
                )}
              </div>
              <div className="col-span-2 flex min-w-0 items-center gap-2 md:col-span-1">
                <span className="min-w-0 flex-1">
                  {x.active ? <Chip tone="green">{m.statusActive}</Chip> : <Chip>{m.statusRemoved}</Chip>}
                </span>
                <button type="button" onClick={() => setEditing(x.id)} aria-label={fmt(m.editOf, { name: x.name })} title={m.edit} className={`${ICON_BTN} hover:border-ink hover:text-ink`}>
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="m13.5 6.5 4 4" />
                  </svg>
                </button>
                <button type="button" onClick={() => setDeleting(x)} aria-label={fmt(m.deleteOf, { name: x.name })} title={m.delete} className={`${ICON_BTN} hover:border-red hover:text-red-ink`}>
                  <span aria-hidden="true">✕</span>
                </button>
              </div>
            </div>
          ),
        )}
      </section>

      {deleting && <ConfirmDelete material={deleting} onConfirm={() => remove(deleting)} onCancel={() => setDeleting(null)} />}
      <Toast toast={toast} onClose={clear} closeLabel={t.close} />
    </div>
  );
}

/** Name and price per kg; used to add a raw material and to change one. Returns an error text or null. */
function MaterialForm({ idPrefix, initial, submitLabel, onSubmit, onCancel }: {
  idPrefix: string; initial?: RawMaterial; submitLabel: string;
  onSubmit: (name: string, price: number) => Promise<string | null>; onCancel: () => void;
}) {
  const { t, locale } = useCalcText();
  const m = t.materials;
  const [name, setName] = useState(initial?.name ?? "");
  const [price, setPrice] = useState(initial ? String(initial.price_eur_per_kg).replace(".", locale === "bg" ? "," : ".") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const value = parseNum(price);
  const valid = name.trim() !== "" && value !== null && value > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError((await onSubmit(name, value!)) ?? "");
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <Field label={m.name} htmlFor={`${idPrefix}-name`} required className="min-w-0 flex-[2_1_240px]">
        <input id={`${idPrefix}-name`} autoFocus required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className="input" />
      </Field>
      <Field label={m.price} htmlFor={`${idPrefix}-price`} required className="min-w-0 flex-[1_1_140px]">
        <NumberField id={`${idPrefix}-price`} required value={price} onChange={setPrice} suffix="€" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!valid || busy} className="btn btn-primary">{busy ? "…" : submitLabel}</button>
        <button type="button" onClick={onCancel} className="btn btn-outline">{m.cancel}</button>
      </div>
      {error && <p role="alert" className="m-0 w-full text-sm font-semibold text-red-ink">{error}</p>}
    </form>
  );
}

/** Asks once more before a raw material is deleted. */
function ConfirmDelete({ material, onConfirm, onCancel }: { material: RawMaterial; onConfirm: () => Promise<void>; onCancel: () => void }) {
  const { t } = useCalcText();
  const m = t.materials;
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#00000066] p-4" onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="delete-material-title" aria-describedby="delete-material-text" className="card flex w-full max-w-[440px] flex-col gap-3 p-5">
        <h2 id="delete-material-title" className="m-0 text-lg font-bold">{m.deleteTitle}</h2>
        <p id="delete-material-text" className="m-0 text-sm break-words">{fmt(m.deleteConfirm, { name: material.name })}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" autoFocus onClick={onCancel} disabled={busy} className="btn btn-outline">{m.cancel}</button>
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); }} className="btn btn-primary border-red! bg-red! text-[#fff]!">{busy ? "…" : m.delete}</button>
        </div>
      </div>
    </div>
  );
}

/** The regulatory note saves when leaving the field (Admin). */
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
