"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { offerState, reserveOfferNo, saveOffer } from "@/app/calculator/actions";
import { calcInputFromForm, calculate } from "@/lib/calculator/calc";
import type { CrmClient } from "@/lib/calculator/db";
import { BASELINE_KEY, createEmptyForm, DRAFT_KEY, duplicateForm, nextFormulaForm, normalizeForm } from "@/lib/calculator/form";
import { toOfferInput } from "@/lib/calculator/offerRecord";
import { readStorage, removeStorage, writeStorage } from "@/lib/calculator/storage";
import type { CatalogProduct, OfferForm, OfferRecord, RawMaterial, Settings } from "@/lib/calculator/types";
import { fieldId, firstError, validateOffer, type FieldKey } from "@/lib/calculator/validation";
import { fmt, type Locale } from "@/lib/i18n";
import { PageHeader } from "@/components/ui";
import { CatalogProductSection, FormulaModeSwitch } from "./catalog-section";
import { CopyRecipe } from "./copy-recipe";
import { ClientSection, ContactSection, ProductTypeSection, type SectionProps } from "./client-sections";
import { FormulaSection } from "./formula-section";
import { CalcTextProvider, Notice, Toast, useCalcText, useToast, type CalcDict } from "./kit";
import { BulkSection, MarkupSection, OfferLinesSection, QuantitySection } from "./pricing-sections";
import { isBulk } from "@/lib/calculator/types";
import { ResultsSection } from "./results-section";

type Props = {
  t: CalcDict;
  locale: Locale;
  materials: RawMaterial[];
  /** Active catalog products (catalog formula mode). */
  catalog: CatalogProduct[];
  settings: Settings;
  clients: CrmClient[];
  /** A saved offer to open (or copy as a new one), from /calculator?open=… or ?copy=… */
  initial: { mode: "open" | "copy" | "next"; offer: OfferRecord } | null;
  tabs: ReactNode;
};

export function CalculatorApp(props: Props) {
  return (
    <CalcTextProvider t={props.t} locale={props.locale}>
      <Calculator {...props} />
    </CalcTextProvider>
  );
}

/**
 * A form can point at an offer that can no longer be saved: deleted in the meantime, or in an order.
 * The work is kept as a new offer with a new number; `locked` names the offer that is in an order.
 */
async function asNewWhenNotEditable(f: OfferForm): Promise<{ form: OfferForm; locked: string | null }> {
  if (!f.id) return { form: f, locked: null };
  const state = await offerState(f.id);
  if (!state.ok || state.data === "ok") return { form: f, locked: null };
  const no = await reserveOfferNo();
  const offerNo = no.ok ? no.data : "";
  return state.data === "locked"
    ? { form: duplicateForm(f, offerNo), locked: f.offer.offerNo }
    : { form: { ...f, id: null, offer: { ...f.offer, offerNo } }, locked: null };
}

function Calculator({ materials, catalog, settings, clients, initial, tabs }: Props) {
  const { t } = useCalcText();
  const router = useRouter();
  const [form, setFormState] = useState<OfferForm | null>(null);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Set<FieldKey>>(new Set());
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast, show, clear } = useToast();
  const started = useRef(false);
  /** Set once the offer is created: the draft is cleared and must not be stored again. */
  const leaving = useRef(false);
  /** The form as last opened, started or saved (JSON); any difference means unsaved changes. */
  const [baseline, setBaseline] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);

  /** Replace the form; `fresh` marks a different offer (forgets touched fields), `clean` marks it as saved. */
  const loadForm = useCallback(
    (f: OfferForm, fresh = false, clean = fresh) => {
      if (fresh) {
        setTouched(new Set());
        setShowAllErrors(false);
      }
      setNumberError(null);
      const next = normalizeForm(f, settings);
      setFormState(next);
      if (clean) setBaseline(JSON.stringify(next));
    },
    [settings],
  );

  const newOffer = useCallback(async () => {
    removeStorage(DRAFT_KEY);
    const res = await reserveOfferNo();
    setNumberError(res.ok ? null : res.error);
    const next = createEmptyForm(settings, res.ok ? res.data : "");
    setFormState(next);
    setBaseline(JSON.stringify(next));
    setTouched(new Set());
    setShowAllErrors(false);
  }, [settings]);

  // First render in the browser: open the requested offer, the stored draft, or start a new offer.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      if (initial) {
        const o = initial.offer;
        if (initial.mode === "open") {
          const opened = await asNewWhenNotEditable({ ...o.data, id: o.id, offer: { ...o.data.offer, offerNo: o.offer_no } });
          loadForm(opened.form, true);
          if (opened.locked) show("success", fmt(t.results.lockedAsNew, { no: opened.locked }));
        } else {
          const res = await reserveOfferNo();
          if (!res.ok) setNumberError(res.error);
          const base = normalizeForm(o.data, settings);
          loadForm(initial.mode === "next" ? nextFormulaForm(base, settings, res.ok ? res.data : "") : duplicateForm(base, res.ok ? res.data : ""), true);
        }
        window.history.replaceState(null, "", "/calculator");
        return;
      }
      // The stored form comes back only with unsaved work in it (a page refresh); a created, opened or
      // untouched offer is not carried over, so the calculator starts empty (owner, Nov 2026)
      const draft = readStorage<OfferForm>(DRAFT_KEY);
      const base = readStorage<string>(BASELINE_KEY);
      const unsaved = (() => {
        if (!draft || !base) return false;
        try {
          return JSON.stringify(normalizeForm(draft, settings)) !== JSON.stringify(normalizeForm(JSON.parse(base) as OfferForm, settings));
        } catch {
          return false;
        }
      })();
      if (draft && unsaved) {
        const kept = await asNewWhenNotEditable(draft);
        loadForm(kept.form);
        setBaseline(base);
        if (kept.locked) show("success", fmt(t.results.lockedAsNew, { no: kept.locked }));
      } else {
        removeStorage(BASELINE_KEY);
        await newOffer();
      }
    })();
  }, [initial, loadForm, newOffer, settings, show, t]);

  // Keep the unsaved form so a page refresh doesn't lose work (not once the offer is created and the page is left).
  useEffect(() => {
    if (form && !leaving.current) writeStorage(DRAFT_KEY, form);
  }, [form]);
  useEffect(() => {
    if (baseline !== null && !leaving.current) writeStorage(BASELINE_KEY, baseline);
  }, [baseline]);

  const dirty = useMemo(() => !!form && JSON.stringify(form) !== baseline, [form, baseline]);

  const setForm = useCallback((updater: (f: OfferForm) => OfferForm) => setFormState((f) => (f ? updater(f) : f)), []);

  const result = useMemo(() => (form ? calculate(calcInputFromForm(form, settings.fixed_costs)) : null), [form, settings]);
  const errors = useMemo(() => (form ? validateOffer(form) : {}), [form]);
  const valid = !firstError(errors);

  const touch = useCallback((key: FieldKey) => setTouched((s) => (s.has(key) ? s : new Set(s).add(key))), []);
  const errorFor = useCallback(
    (key: FieldKey) => {
      const code = showAllErrors || touched.has(key) ? errors[key] : undefined;
      return code ? t.validation[code] : undefined;
    },
    [errors, showAllErrors, touched, t],
  );

  const revealErrors = () => {
    setShowAllErrors(true);
    const first = firstError(errors);
    if (!first) return;
    const el = document.getElementById(fieldId(first));
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (el instanceof HTMLInputElement) el.focus({ preventScroll: true });
  };

  /** Saves the offer under Offers and opens its summary (where the PDF is downloaded); the calculator starts fresh next time. */
  const create = async () => {
    if (!form || !result || !valid) return revealErrors();
    setBusy(true);
    try {
      const checked = await asNewWhenNotEditable(form);
      if (checked.locked) {
        // An offer in an order stays as it is: the form becomes a new offer, saved with the next press
        loadForm(checked.form);
        show("success", fmt(t.results.lockedAsNew, { no: checked.locked }));
        setBusy(false);
        return;
      }
      let current = checked.form;
      if (!current.offer.offerNo.trim()) {
        const no = await reserveOfferNo();
        if (!no.ok) throw new Error(no.error);
        current = { ...current, offer: { ...current.offer, offerNo: no.data } };
      }
      const res = await saveOffer(toOfferInput(current, result, settings.fixed_costs));
      if (!res.ok) throw new Error(res.error);
      leaving.current = true;
      removeStorage(DRAFT_KEY);
      removeStorage(BASELINE_KEY);
      router.push(`/offers/calc/${res.data.id}`);
    } catch (e) {
      show("error", `${t.results.saveFailed}: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  const startNew = async () => {
    setConfirmNew(false);
    await newOffer();
    window.scrollTo({ top: 0 });
  };

  const newButton = (className: string) => (
    <button
      type="button"
      onClick={dirty ? () => setConfirmNew(true) : startNew}
      disabled={busy}
      aria-expanded={dirty ? confirmNew : undefined}
      className={`btn btn-primary ${className}`}
    >
      + {t.newOffer}
    </button>
  );
  const confirm = (className: string) =>
    confirmNew && (
      <div role="alertdialog" aria-label={t.unsavedConfirm} className={`flex flex-wrap items-center gap-3 rounded-sm border border-amber-line bg-amber-tint px-4 py-3 ${className}`}>
        <span className="min-w-0 flex-[1_1_240px] text-sm font-semibold text-amber-ink">{t.unsavedConfirm}</span>
        <button type="button" autoFocus onClick={() => setConfirmNew(false)} className="btn btn-outline">{t.cancel}</button>
        <button type="button" onClick={startNew} className="btn btn-primary">{t.continue}</button>
      </div>
    );

  const header = (
    <>
      {/* Desktop: the New offer button stays at the top right while scrolling (zero-height sticky rail). */}
      <div className="sticky top-4 z-30 -mb-6 hidden h-0 self-end lg:block">
        <div className="flex w-[420px] flex-col items-end gap-2">
          {newButton("shadow-lg")}
          {confirm("w-full shadow-lg")}
        </div>
      </div>
      <PageHeader title={t.title} subtitle={t.subtitle} actions={newButton("lg:invisible")} />
      {confirm("lg:hidden")}
      {tabs}
    </>
  );

  if (!form || !result) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <p role="status" className="m-0 py-10 text-center text-sm text-ink-2">{t.loading}</p>
      </div>
    );
  }

  const sectionProps: SectionProps = { form, setForm, errorFor, touch };

  return (
    <div className="flex flex-col gap-6">
      {header}
      <div className="flex max-w-[960px] flex-col gap-5">
        {numberError && <Notice tone="error">{numberError}</Notice>}
        <p className="m-0 text-[13px] font-semibold text-red-ink">{t.requiredLegend}</p>
        <FormulaModeSwitch form={form} setForm={setForm} />
        <CopyRecipe form={form} setForm={setForm} materials={materials} onCopied={(msg) => show("success", msg)} />
        <ContactSection {...sectionProps} email={settings.company_email} />
        <ClientSection {...sectionProps} clients={clients} />
        {form.mode === "catalog" ? (
          <>
            {/* Catalog product: product instead of type, formula and quantity per pack; numbered 1–5 */}
            <CatalogProductSection {...sectionProps} catalog={catalog} materials={materials} />
            <MarkupSection {...sectionProps} result={result} step={4} />
            <OfferLinesSection {...sectionProps} step={5} />
          </>
        ) : (
          <>
            <ProductTypeSection {...sectionProps} fixedCosts={form.fixedCosts ?? settings.fixed_costs} bulkDefaults={settings} />
            <FormulaSection {...sectionProps} materials={materials} result={result} />
            {isBulk(form.productType) ? <BulkSection {...sectionProps} result={result} /> : <QuantitySection {...sectionProps} result={result} />}
            <MarkupSection {...sectionProps} result={result} />
            <OfferLinesSection {...sectionProps} />
          </>
        )}
        <ResultsSection
          form={form}
          result={result}
          valid={valid}
          busy={busy}
          onCreate={create}
          onInvalidAttempt={revealErrors}
        />
      </div>
      <Toast toast={toast} onClose={clear} closeLabel={t.close} />
    </div>
  );
}
