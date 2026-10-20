"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { saveSettings } from "@/app/calculator/actions";
import { extractSheetId } from "@/lib/calculator/materialImport";
import { parseNum } from "@/lib/calculator/numbers";
import { PRODUCT_TYPES, type ProductType, type Settings } from "@/lib/calculator/types";
import { Field, Notice, NumberField, RemoveButton, Section, SubHeading, inputClass, useCalcText } from "./kit";

const MAX_LOGO_BYTES = 500 * 1024;

type PresetDraft = { description: string; unit: string; price: string };

type Draft = Omit<Settings, "fixed_costs" | "default_markup" | "default_vat_rate" | "service_presets"> & {
  service_presets: PresetDraft[];
  fixed_costs: Record<ProductType, string>;
  default_markup: string;
  default_vat_rate: string;
};

const toDraft = (s: Settings): Draft => ({
  ...s,
  fixed_costs: {
    capsules_glass: String(s.fixed_costs.capsules_glass),
    capsules_plastic: String(s.fixed_costs.capsules_plastic),
    powder: String(s.fixed_costs.powder),
  },
  default_markup: String(s.default_markup),
  default_vat_rate: String(s.default_vat_rate),
  service_presets: s.service_presets.map((p) => ({ ...p, price: String(p.price) })),
});

type TextKey = {
  [K in keyof Draft]: Draft[K] extends string ? K : never;
}[keyof Draft];

export function SettingsPanel({ settings, isAdmin, onSaved }: { settings: Settings; isAdmin: boolean; onSaved: (message: string) => void }) {
  const { t, eur } = useCalcText();
  const s = t.settings;
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isAdmin) {
    return (
      <Section title={s.title}>
        <Notice>{s.adminOnly}</Notice>
        <div className="grid grid-cols-1 gap-x-8 text-sm sm:grid-cols-3">
          {PRODUCT_TYPES.map((p) => (
            <div key={p} className="flex justify-between gap-3 border-b border-mist py-2">
              <span className="text-ink-2">{t.productType[p]}</span>
              <span className="font-semibold tabular-nums">{eur(settings.fixed_costs[p])}</span>
            </div>
          ))}
        </div>
      </Section>
    );
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setPreset = (i: number, patch: Partial<PresetDraft>) =>
    setDraft((d) => ({ ...d, service_presets: d.service_presets.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));

  const numbers = {
    capsules_glass: parseNum(draft.fixed_costs.capsules_glass),
    capsules_plastic: parseNum(draft.fixed_costs.capsules_plastic),
    powder: parseNum(draft.fixed_costs.powder),
    markup: parseNum(draft.default_markup),
  };
  const sheetIdOk = !!extractSheetId(draft.google_sheet_url);
  const presetsOk = draft.service_presets.every((p) => p.description.trim() && (parseNum(p.price) ?? -1) >= 0);
  const valid = Object.values(numbers).every((n) => n !== null && n >= 0) && sheetIdOk && presetsOk;

  const pickLogo = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) return setError(s.logoTooLarge);
    const reader = new FileReader();
    reader.onload = () => {
      setError(null);
      set({ logo_data_url: String(reader.result) });
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const res = await saveSettings({
      ...draft,
      fixed_costs: { capsules_glass: numbers.capsules_glass!, capsules_plastic: numbers.capsules_plastic!, powder: numbers.powder! },
      default_markup: numbers.markup!,
      default_vat_rate: parseNum(draft.default_vat_rate) ?? 0,
      service_presets: draft.service_presets.map((p) => ({ description: p.description.trim(), unit: p.unit.trim(), price: parseNum(p.price)! })),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onSaved(s.savedOk);
    router.refresh();
  };

  const text = (key: TextKey, label: string, className = "") => (
    <Field label={label} htmlFor={`setting-${key}`} className={className}>
      <input id={`setting-${key}`} value={(draft[key] as string) ?? ""} onChange={(e) => set({ [key]: e.target.value } as Partial<Draft>)} className="input" />
    </Field>
  );

  return (
    <Section title={s.title}>
      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-col gap-3">
        <SubHeading>{s.fixedCosts}</SubHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PRODUCT_TYPES.map((p) => (
            <Field key={p} label={t.productType[p]} htmlFor={`fixed-${p}`}>
              <NumberField
                id={`fixed-${p}`}
                value={draft.fixed_costs[p]}
                onChange={(v) => set({ fixed_costs: { ...draft.fixed_costs, [p]: v } })}
                invalid={numbers[p] === null}
                suffix="€"
              />
            </Field>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-mist pt-5">
        <SubHeading>{s.defaults}</SubHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={s.defaultMarkup} htmlFor="default-markup">
            <NumberField id="default-markup" value={draft.default_markup} onChange={(v) => set({ default_markup: v })} invalid={numbers.markup === null} suffix="%" />
          </Field>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-mist pt-5">
        <SubHeading>{s.supplier}</SubHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {text("company_name", s.companyName, "sm:col-span-2")}
          {text("company_id", s.companyId)}
          {text("company_vat", s.companyVat)}
          {text("company_address", s.companyAddress, "sm:col-span-2")}
          {text("company_email", s.companyEmail, "sm:col-span-2")}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-mist pt-5">
        <SubHeading>{s.bank}</SubHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {text("bank_iban", s.bankIban, "sm:col-span-2")}
          {text("bank_name", s.bankName)}
          {text("bank_bic", s.bankBic)}
          {text("bank_address", s.bankAddress, "sm:col-span-4")}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-mist pt-5">
        <SubHeading>{s.offerTexts}</SubHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {text("default_payment_terms", s.paymentTerms)}
          {text("vat_exemption_text", s.vatExemption)}
          {text("footer_text", s.footerText)}
          {text("websites", s.websites)}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-mist pt-5">
        <SubHeading>{s.presets}</SubHeading>
        <p className="m-0 text-[13px] text-ink-2">{s.presetsHint}</p>
        {draft.service_presets.map((p, i) => (
          <div
            key={i}
            className="grid items-end gap-3 [grid-template-areas:'d_d_r'_'u_p_p'] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:[grid-template-areas:'d_u_p_r'] sm:grid-cols-[minmax(0,1fr)_100px_130px_44px]"
          >
            <Field label={s.presetDescription} htmlFor={`preset-d-${i}`} className="[grid-area:d]">
              <input
                id={`preset-d-${i}`}
                value={p.description}
                onChange={(e) => setPreset(i, { description: e.target.value })}
                className={inputClass(!p.description.trim())}
              />
            </Field>
            <Field label={s.presetUnit} htmlFor={`preset-u-${i}`} className="[grid-area:u]">
              <input id={`preset-u-${i}`} value={p.unit} onChange={(e) => setPreset(i, { unit: e.target.value })} className="input" />
            </Field>
            <Field label={s.presetPrice} htmlFor={`preset-p-${i}`} className="[grid-area:p]">
              <NumberField id={`preset-p-${i}`} value={p.price} onChange={(v) => setPreset(i, { price: v })} invalid={parseNum(p.price) === null} suffix="€" />
            </Field>
            <div className="justify-self-end [grid-area:r]">
              <RemoveButton
                label={`${t.remove} ${p.description}`}
                onClick={() => set({ service_presets: draft.service_presets.filter((_, j) => j !== i) })}
              />
            </div>
          </div>
        ))}
        <div>
          <button
            type="button"
            onClick={() => set({ service_presets: [...draft.service_presets, { description: "", unit: "pcs.", price: "" }] })}
            className="btn btn-outline"
          >
            + {s.addPreset}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-mist pt-5">
        <SubHeading>{s.logo}</SubHeading>
        <p className="m-0 text-[13px] text-ink-2">{s.logoHint}</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-16 w-[180px] place-items-center rounded-sm border border-line bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={draft.logo_data_url ?? "/calculator/logo-nutrikal.png"} alt={draft.logo_data_url ? s.logo : "Nutrikal"} className="max-h-full max-w-full" />
          </div>
          <label className="btn btn-outline">
            {s.uploadLogo}
            <input type="file" accept="image/png,image/jpeg" onChange={pickLogo} className="sr-only" />
          </label>
          {draft.logo_data_url && (
            <button type="button" onClick={() => set({ logo_data_url: null })} className="btn btn-outline">{s.removeLogo}</button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t border-mist pt-5">
        <Field label={t.sync.sheetUrl} htmlFor="sheet-url" error={sheetIdOk ? undefined : t.sync.sheetUrlInvalid} hint={t.sync.sheetUrlHint}>
          <input
            id="sheet-url"
            value={draft.google_sheet_url}
            onChange={(e) => set({ google_sheet_url: e.target.value })}
            aria-describedby="sheet-url-msg"
            aria-invalid={!sheetIdOk || undefined}
            className={inputClass(!sheetIdOk)}
          />
        </Field>
        <Field label={s.terms} htmlFor="terms-text">
          <textarea id="terms-text" rows={4} value={draft.terms_text} onChange={(e) => set({ terms_text: e.target.value })} className="input" />
        </Field>
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={!valid || busy} className="btn btn-primary">
          {busy ? "…" : s.saveSettings}
        </button>
      </div>
    </Section>
  );
}
