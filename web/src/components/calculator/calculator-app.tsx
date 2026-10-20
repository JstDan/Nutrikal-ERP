"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { reserveOfferNo, saveOffer, syncIfStale } from "@/app/calculator/actions";
import { calcInputFromForm, calculate } from "@/lib/calculator/calc";
import type { CrmClient } from "@/lib/calculator/db";
import { createEmptyForm, DRAFT_KEY, duplicateForm, normalizeForm } from "@/lib/calculator/form";
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

  /** Replace the form; `fresh` marks a different offer (forgets touched fields). */
  const loadForm = useCallback(
    (f: OfferForm, fresh = false) => {
      if (fresh) {
        setTouched(new Set());
        setShowAllErrors(false);
      }
      setNumberError(null);
      setFormState(normalizeForm(f, settings));
    },
    [settings],
  );

  const newOffer = useCallback(async () => {
    removeStorage(DRAFT_KEY);
    const res = await reserveOfferNo();
    setNumberError(res.ok ? null : res.error);
    setFormState(createEmptyForm(settings, res.ok ? res.data : ""));
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
      if (draft) loadForm(draft);
      else await newOffer();
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
      loadForm({ ...res.data.data, id: res.data.id });
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
    await newOffer();
    window.scrollTo({ top: 0 });
  };

  const header = (
    <>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <button type="button" onClick={startNew} disabled={busy} className="btn btn-primary">
            + {t.newOffer}
          </button>
        }
      />
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
