"use client";

import { useEffect, useState } from "react";
import { findRecipeSources, recipeSource, type RecipeSource } from "@/app/calculator/actions";
import { copyRecipe, normalizeForm } from "@/lib/calculator/form";
import { DEFAULT_SETTINGS, type OfferForm, type RawMaterial } from "@/lib/calculator/types";
import { fmt, formatDate } from "@/lib/i18n";
import { useCalcText } from "./kit";

/**
 * Copy the recipe of another offer, of any client (owner, Nov 2026): search by offer number, client, product or
 * ingredient, pick one; its formula comes into this offer, whose client and quantities stay (`copyRecipe`).
 */
export function CopyRecipe({ form, setForm, materials, onCopied }: {
  form: OfferForm; setForm: (u: (f: OfferForm) => OfferForm) => void; materials: RawMaterial[]; onCopied: (message: string) => void;
}) {
  const { t, locale } = useCalcText();
  const C = t.copyRecipe;
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [list, setList] = useState<RecipeSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<RecipeSource | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const timer = setTimeout(() => {
      findRecipeSources(term).then((r) => { if (live) setList(r.ok ? r.data.filter((x) => x.id !== form.id) : []); }).catch(() => { if (live) setList([]); });
    }, term ? 250 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [open, term, form.id]);

  const hasRecipe = form.rows.length > 0 || !!form.catalog;
  const take = async (x: RecipeSource) => {
    setAsking(null);
    setBusy(true);
    setError(null);
    try {
      const r = await recipeSource(x.id);
      if (!r.ok || !r.data) throw new Error();
      const source = normalizeForm(r.data.data, { ...DEFAULT_SETTINGS });
      setForm((f) => copyRecipe(f, source, materials));
      setOpen(false);
      onCopied(fmt(C.copied, { no: x.offer_no }));
    } catch {
      setError(C.failed);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="flex justify-end">
        <button type="button" onClick={() => setOpen(true)} className="btn btn-outline">⧉ {C.button}</button>
      </div>
    );
  }
  return (
    <section aria-labelledby="copy-recipe-h" className="card flex min-w-0 flex-col gap-3 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="copy-recipe-h" className="m-0 text-base font-bold">{C.title}</h2>
          <p className="m-0 text-[13px] text-ink-2">{C.hint}</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label={C.close} className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-xl text-ink-2 hover:bg-mist">×</button>
      </div>
      <label className="field"><span className="sr-only">{C.search}</span>
        <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={C.search} autoFocus className="input" />
      </label>
      {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
      {list === null ? <p className="m-0 text-sm text-ink-2">…</p> : list.length === 0 ? <p className="m-0 text-sm text-ink-2">{C.none}</p> : (
        <ul className="m-0 flex list-none flex-col p-0">
          {list.map((x) => (
            <li key={x.id} className="flex flex-col gap-2 border-b border-mist py-2.5 last:border-0">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold break-words">{x.product || "—"}</span>
                  <span className="block text-xs break-words text-ink-2">{x.offer_no} · {x.company || "—"} · {formatDate(locale, x.created_at.slice(0, 10))}</span>
                </span>
                <button type="button" disabled={busy} onClick={() => (hasRecipe ? setAsking(x) : take(x))} className="btn btn-outline shrink-0">{C.use}</button>
              </div>
              {asking?.id === x.id && (
                <div role="alertdialog" aria-label={fmt(C.replace, { no: x.offer_no })} className="flex flex-wrap items-center gap-2 rounded-sm border border-amber-line bg-amber-tint px-3 py-2">
                  <span className="min-w-0 flex-[1_1_200px] text-sm font-semibold text-amber-ink">{fmt(C.replace, { no: x.offer_no })}</span>
                  <button type="button" onClick={() => setAsking(null)} className="btn btn-outline">{t.cancel}</button>
                  <button type="button" autoFocus onClick={() => take(x)} className="btn btn-primary">{C.use}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
