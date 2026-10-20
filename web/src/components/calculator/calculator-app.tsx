"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { reserveOfferNo, saveOffer, syncIfStale } from "@/app/calculator/actions";
import { calcInputFromForm, calculate } from "@/lib/calculator/calc";
import type { CrmClient } from "@/lib/calculator/db";
import { BASELINE_KEY, createEmptyForm, DRAFT_KEY, duplicateForm, normalizeForm } from "@/lib/calculator/form";
import { toOfferInput } from "@/lib/calculator/offerRecord";
import { readStorage, removeStorage, writeStorage } from "@/lib/calculator/storage";
import type { OfferForm, OfferRecord, RawMaterial, Settings } from "@/lib/calculator/types";
import { fieldId, firstError, validateOffer, type FieldKey } from "@/lib/calculator/validation";
import { fmt, type Locale } from "@/lib/i18n";
import { PageHeader } from "@/components/ui";
import { ClientSection, ContactSection, ProductTypeSection, type SectionProps } from "./client-sections";
import { FormulaSection } from "./formula-section";
import { CalcTextProvider, Notice, Toast, useCalcText, useToast, type CalcDict } from "./kit";
import { MarkupSection, OfferLinesSection, QuantitySection } from "./pricing-sections";
import { ResultsSection } from "./results-section";

type Props = {
  t: CalcDict;
  locale: Locale;
  materials: RawMaterial[];
  settings: Settings;
  clients: CrmClient[];
  /** A saved offer to open (or copy as a new one), from /calculator?open=… or ?copy=… */
  initial: { mode: "open" | "copy"; offer: OfferRecord } | null;
  tabs: ReactNode;
};

export function CalculatorApp(props: Props) {
  return (
    <CalcTextProvider t={props.t} locale={props.locale}>
      <Calculator {...props} />
    </CalcTextProvider>
  );
}

function Calculator({ materials, settings, clients, initial, tabs }: Props) {
  const { t } = useCalcText();
  const router = useRouter();
  const [form, setFormState] = useState<OfferForm | null>(null);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Set<FieldKey>>(new Set());
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast, show, clear } = useToast();
  const started = useRef(false);
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
          loadForm({ ...o.data, id: o.id, offer: { ...o.data.offer, offerNo: o.offer_no } }, true);
        } else {
          const res = await reserveOfferNo();
          if (!res.ok) setNumberError(res.error);
          loadForm(duplicateForm(normalizeForm(o.data, settings), res.ok ? res.data : ""), true);
        }
        window.history.replaceState(null, "", "/calculator");
        return;
      }
      const draft = readStorage<OfferForm>(DRAFT_KEY);
      if (draft) {
        loadForm(draft);
        setBaseline(readStorage<string>(BASELINE_KEY));
      } else await newOffer();
    })();
  }, [initial, loadForm, newOffer, settings]);

  // Price list older than 24 h: sync from the Google Sheet in the background, then reload the materials.
  useEffect(() => {
    void syncIfStale().then((res) => {
      if (res.ok && res.data?.status === "success") router.refresh();
    });
  }, [router]);

  // Keep the unsaved form so a page refresh doesn't lose work.
  useEffect(() => {
    if (form) writeStorage(DRAFT_KEY, form);
  }, [form]);
  useEffect(() => {
    if (baseline !== null) writeStorage(BASELINE_KEY, baseline);
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

  const save = async () => {
    if (!form || !result || !valid) return revealErrors();
    setBusy(true);
    try {
      let current = form;
      if (!current.offer.offerNo.trim()) {
        const no = await reserveOfferNo();
        if (!no.ok) throw new Error(no.error);
        current = { ...current, offer: { ...current.offer, offerNo: no.data } };
      }
      const res = await saveOffer(toOfferInput(current, result, settings.fixed_costs));
      if (!res.ok) throw new Error(res.error);
      loadForm({ ...res.data.data, id: res.data.id }, false, true);
      show("success", fmt(t.results.savedOk, { no: res.data.offer_no }));
    } catch (e) {
      show("error", `${t.results.saveFailed}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async () => {
    if (!form || !result || !valid) return revealErrors();
    setBusy(true);
    try {
      const { downloadOfferPdf } = await import("@/lib/calculator/pdf");
      await downloadOfferPdf(form, result, settings);
    } catch (e) {
      show("error", `${t.results.pdfFailed}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const startNew = async () => {
    setConfirmNew(false);
    await newOffer();
    window.scrollTo({ top: 0 });
  };

  const header = (
    <>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <button
            type="button"
            onClick={dirty ? () => setConfirmNew(true) : startNew}
            disabled={busy}
            aria-expanded={dirty ? confirmNew : undefined}
            className="btn btn-primary"
          >
            + {t.newOffer}
          </button>
        }
      />
      {confirmNew && (
        <div role="alertdialog" aria-labelledby="new-offer-confirm" className="flex flex-wrap items-center gap-3 rounded-sm border border-[#f0d9a8] bg-amber-tint px-4 py-3">
          <span id="new-offer-confirm" className="min-w-0 flex-[1_1_240px] text-sm font-semibold text-amber-ink">{t.unsavedConfirm}</span>
          <button type="button" autoFocus onClick={() => setConfirmNew(false)} className="btn btn-outline">{t.cancel}</button>
          <button type="button" onClick={startNew} className="btn btn-primary">{t.continue}</button>
        </div>
      )}
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
        <ContactSection {...sectionProps} email={settings.company_email} />
        <ClientSection {...sectionProps} clients={clients} />
        <ProductTypeSection {...sectionProps} fixedCosts={form.fixedCosts ?? settings.fixed_costs} />
        <FormulaSection {...sectionProps} materials={materials} result={result} />
        <QuantitySection {...sectionProps} result={result} />
        <MarkupSection {...sectionProps} result={result} />
        <OfferLinesSection {...sectionProps} presets={settings.service_presets} />
        <ResultsSection
          form={form}
          result={result}
          valid={valid}
          busy={busy}
          onSave={save}
          onDownloadPdf={downloadPdf}
          onInvalidAttempt={revealErrors}
        />
      </div>
      <Toast toast={toast} onClose={clear} closeLabel={t.close} />
    </div>
  );
}
