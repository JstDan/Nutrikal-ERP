"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCatalogProduct, type CatalogProductInput } from "@/app/calculator/actions";
import { parseNum } from "@/lib/calculator/numbers";
import { matchesQuery } from "@/lib/calculator/search";
import { DOSE_UNITS, type CatalogProduct, type DoseUnit } from "@/lib/calculator/types";
import { fmt, type Locale } from "@/lib/i18n";
import { Chip, Empty } from "@/components/ui";
import { CalcTextProvider, Field, Notice, NumberField, RemoveButton, Toast, Toggle, useCalcText, useToast, type CalcDict } from "./kit";

type Props = {
  t: CalcDict;
  locale: Locale;
  /** All catalog products, inactive ones and those without a composition included. */
  products: CatalogProduct[];
  isAdmin: boolean;
};

/** Third calculator tab: the catalog products. They live in the database (owner, Nov 2026); Admin adds and edits them here. */
export function CatalogView(props: Props) {
  return (
    <CalcTextProvider t={props.t} locale={props.locale}>
      <Catalog {...props} />
    </CalcTextProvider>
  );
}

const GRID = "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1.2fr)_150px]";

function Catalog({ products, isAdmin }: Props) {
  const { t, eur, num } = useCalcText();
  const c = t.catalogTab;
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const { toast, show, clear } = useToast();

  const filtered = useMemo(
    () => products.filter((p) => (showInactive || p.active) && matchesQuery(`${p.code} ${p.name} ${p.category ?? ""}`, query)),
    [products, showInactive, query],
  );
  const done = (code: string) => { setEditing(null); show("success", fmt(c.saved, { code })); };

  return (
    <div className="flex flex-col gap-5">
      <Notice>{isAdmin ? c.managedHere : c.managedHereSales}</Notice>

      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-[1_1_280px]">
          <label htmlFor="catalog-filter" className="sr-only">{c.search}</label>
          <input id="catalog-filter" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={c.search} className="input" />
        </div>
        <Toggle checked={showInactive} onChange={setShowInactive}>{c.showInactive}</Toggle>
        <span className="text-sm text-ink-2">{fmt(c.count, { n: products.filter((p) => p.active).length })}</span>
        {isAdmin && editing !== "new" && <button type="button" onClick={() => setEditing("new")} className="btn btn-primary">{c.add}</button>}
      </div>

      {editing === "new" && (
        <section aria-label={c.add} className="card p-5 sm:p-6">
          <ProductForm product={null} nextOrder={Math.max(0, ...products.map((p) => p.sort_order ?? 0)) + 1}
            onCancel={() => setEditing(null)} onSaved={done} onError={(e) => show("error", e)} />
        </section>
      )}

      <section aria-label={c.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm ${GRID} border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2`}>
          <span>{t.catalog.code}</span>
          <span>{c.name}</span>
          <span>{t.catalog.steps}</span>
          <span>{c.status}</span>
        </div>
        {filtered.length === 0 && <div className="py-4"><Empty>{products.length ? t.catalog.noResults : t.catalog.empty}</Empty></div>}
        {filtered.map((p) => editing === p.id ? (
          <div key={p.id} className="border-b border-mist py-4 last:border-0">
            <ProductForm product={p} nextOrder={p.sort_order ?? 0} onCancel={() => setEditing(null)} onSaved={done} onError={(e) => show("error", e)} />
          </div>
        ) : (
          <div key={p.id} className={`row ${GRID} border-b border-mist py-3 text-sm last:border-0`}>
            <div className="min-w-0 md:contents">
              <span className="font-semibold">{p.code}</span>
              <span className={`block min-w-0 break-words md:inline ${p.active ? "" : "text-ink-2"}`}>
                {p.name}
                {p.category && <span className="block text-xs text-ink-2">{p.category}</span>}
              </span>
            </div>
            <span className="col-span-2 min-w-0 text-ink-2 tabular-nums md:col-span-1 md:text-ink">
              {p.tiers.map((x) => `${fmt(t.catalog.fromQty, { n: num(x.min_qty) })} ${eur(x.price)}`).join(" · ")}
            </span>
            <span className="col-start-2 row-start-1 flex flex-col items-end gap-1 md:col-start-4 md:items-start">
              {p.active ? <Chip tone="green">{c.statusActive}</Chip> : <Chip>{c.statusInactive}</Chip>}
              {!p.composition && <Chip tone="amber">{c.noComposition}</Chip>}
              {isAdmin && <button type="button" onClick={() => setEditing(p.id)} className="btn btn-outline min-h-11">{c.edit}</button>}
            </span>
          </div>
        ))}
      </section>
      <Toast toast={toast} onClose={clear} closeLabel={t.close} />
    </div>
  );
}

type Line = { name: string; amount: string; unit: DoseUnit; note: string };
const numText = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

/** All fields of a catalog product. Prices are per unit, EUR EXW excl. VAT, from the quantity up. */
function ProductForm({ product, nextOrder, onCancel, onSaved, onError }: {
  product: CatalogProduct | null; nextOrder: number; onCancel: () => void; onSaved: (code: string) => void; onError: (e: string) => void;
}) {
  const { t } = useCalcText();
  const c = t.catalogTab;
  const router = useRouter();
  const [pending, start] = useTransition();
  const id = product?.id ?? "new";
  const [code, setCode] = useState(product?.code ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [order, setOrder] = useState(String(product?.sort_order ?? nextOrder));
  const [active, setActive] = useState(product?.active ?? true);
  const [tiers, setTiers] = useState(product?.tiers.map((x) => ({ qty: String(x.min_qty), price: String(x.price) })) ?? [{ qty: "500", price: "" }]);
  const [capsServing, setCapsServing] = useState(numText(product?.capsules_per_serving));
  const [capsJar, setCapsJar] = useState(numText(product?.capsules_per_container));
  const [servingG, setServingG] = useState(numText(product?.serving_g));
  const [servings, setServings] = useState(numText(product?.servings_per_container));
  const [lines, setLines] = useState<Line[]>(product?.composition?.map((x) => ({ name: x.name, amount: String(x.amount), unit: x.unit, note: x.note ?? "" })) ?? []);
  const [error, setError] = useState<string | null>(null);

  const setTier = (i: number, patch: Partial<{ qty: string; price: string }>) => setTiers((v) => v.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setLine = (i: number, patch: Partial<Line>) => setLines((v) => v.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const optional = (s: string) => (s.trim() ? parseNum(s) : null);

  const save = () => {
    const steps = tiers.filter((x) => x.qty.trim() || x.price.trim()).map((x) => ({ min_qty: parseNum(x.qty) ?? 0, price: parseNum(x.price) ?? -1 }));
    const composition = lines.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), amount: parseNum(x.amount) ?? -1, unit: x.unit, note: x.note.trim() || null }));
    if (!code.trim() || !name.trim()) return setError(c.errCodeName);
    if (!steps.length || steps.some((x) => !(x.min_qty > 0) || x.price < 0)) return setError(c.errTiers);
    if (composition.some((x) => !(x.amount > 0))) return setError(c.errComposition);
    const input: CatalogProductInput = {
      id: product?.id ?? null, code, name, category: category.trim() || null, tiers: steps, sort_order: parseNum(order) ?? 0, active,
      capsules_per_serving: optional(capsServing), capsules_per_container: optional(capsJar), serving_g: optional(servingG),
      servings_per_container: optional(servings), composition: composition.length ? composition : null,
    };
    setError(null);
    start(async () => {
      const res = await saveCatalogProduct(input);
      if (!res.ok) return onError(res.error);
      onSaved(code.trim().toUpperCase());
      router.refresh();
    });
  };
  const f = (key: string) => `cp-${id}-${key}`;

  return (
    <div className="flex flex-col gap-5">
      <h3 className="m-0 text-base font-bold">{product ? fmt(c.editTitle, { code: product.code }) : c.add}</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label={t.catalog.code} htmlFor={f("code")} required>
          <input id={f("code")} className="input" value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label={c.name} htmlFor={f("name")} required className="sm:col-span-1 xl:col-span-2">
          <input id={f("name")} className="input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={c.category} htmlFor={f("cat")}>
          <input id={f("cat")} className="input" value={category} maxLength={100} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <Field label={c.order} htmlFor={f("order")}>
          <NumberField id={f("order")} integer value={order} onChange={setOrder} />
        </Field>
        <div className="flex items-end"><Toggle checked={active} onChange={setActive}>{c.statusActive}</Toggle></div>
      </div>

      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold">{c.tiersTitle}</legend>
        {tiers.map((x, i) => (
          <div key={i} className="flex flex-wrap items-end gap-3">
            <Field label={c.tierQty} htmlFor={f(`q${i}`)} className="min-w-0 flex-[1_1_140px]">
              <NumberField id={f(`q${i}`)} integer value={x.qty} onChange={(v) => setTier(i, { qty: v })} />
            </Field>
            <Field label={c.tierPrice} htmlFor={f(`p${i}`)} className="min-w-0 flex-[1_1_140px]">
              <NumberField id={f(`p${i}`)} value={x.price} onChange={(v) => setTier(i, { price: v })} suffix="€" />
            </Field>
            {tiers.length > 1 && <RemoveButton label={c.removeTier} onClick={() => setTiers((v) => v.filter((_, j) => j !== i))} />}
          </div>
        ))}
        <button type="button" onClick={() => setTiers((v) => [...v, { qty: "", price: "" }])} className="btn btn-outline self-start">{c.addTier}</button>
      </fieldset>

      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold">{c.servingTitle}</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={c.capsServing} htmlFor={f("cs")}><NumberField id={f("cs")} integer value={capsServing} onChange={setCapsServing} /></Field>
          <Field label={c.capsJar} htmlFor={f("cj")}><NumberField id={f("cj")} integer value={capsJar} onChange={setCapsJar} /></Field>
          <Field label={c.servingG} htmlFor={f("sg")}><NumberField id={f("sg")} value={servingG} onChange={setServingG} suffix="g" /></Field>
          <Field label={c.servings} htmlFor={f("sv")}><NumberField id={f("sv")} integer value={servings} onChange={setServings} /></Field>
        </div>
        <p className="m-0 text-xs text-ink-2">{c.servingHint}</p>
      </fieldset>

      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold">{c.compositionTitle}</legend>
        <p className="m-0 text-xs text-ink-2">{c.compositionHint}</p>
        {lines.map((x, i) => (
          <div key={i} className="flex flex-wrap items-end gap-3 border-b border-mist pb-3">
            <Field label={c.ingredient} htmlFor={f(`n${i}`)} className="min-w-0 flex-[2_1_200px]">
              <input id={f(`n${i}`)} className="input" value={x.name} maxLength={200} onChange={(e) => setLine(i, { name: e.target.value })} />
            </Field>
            <Field label={c.amount} htmlFor={f(`a${i}`)} className="min-w-0 flex-[1_1_110px]">
              <NumberField id={f(`a${i}`)} value={x.amount} onChange={(v) => setLine(i, { amount: v })} />
            </Field>
            <Field label={c.unit} htmlFor={f(`u${i}`)} className="min-w-0 flex-[0_1_100px]">
              <select id={f(`u${i}`)} className="input" value={x.unit} onChange={(e) => setLine(i, { unit: e.target.value as DoseUnit })}>
                {DOSE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
            <Field label={c.lineNote} htmlFor={f(`o${i}`)} className="min-w-0 flex-[2_1_180px]">
              <input id={f(`o${i}`)} className="input" value={x.note} maxLength={200} onChange={(e) => setLine(i, { note: e.target.value })} />
            </Field>
            <RemoveButton label={c.removeIngredient} onClick={() => setLines((v) => v.filter((_, j) => j !== i))} />
          </div>
        ))}
        <button type="button" onClick={() => setLines((v) => [...v, { name: "", amount: "", unit: "mg", note: "" }])} className="btn btn-outline self-start">
          {c.addIngredient}
        </button>
      </fieldset>

      {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-outline">{t.cancel}</button>
        <button type="button" onClick={save} disabled={pending} className="btn btn-primary">{pending ? "…" : c.save}</button>
      </div>
    </div>
  );
}
