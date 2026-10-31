"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveCatalogSheetUrl } from "@/app/calculator/actions";
import { extractSheetId } from "@/lib/calculator/materialImport";
import type { Settings } from "@/lib/calculator/types";
import type { Locale } from "@/lib/i18n";
import { CalcTextProvider, Field, Toast, inputClass, useCalcText, useToast, type CalcDict } from "./kit";
import { SettingsPanel } from "./settings-panel";

export function CalculatorSettings({ t, locale, settings }: { t: CalcDict; locale: Locale; settings: Settings }) {
  return (
    <CalcTextProvider t={t} locale={locale}>
      <Inner settings={settings} />
    </CalcTextProvider>
  );
}

function Inner({ settings }: { settings: Settings }) {
  const { t } = useCalcText();
  const { toast, show, clear } = useToast();
  const router = useRouter();
  const c = t.catalogTab;
  const [url, setUrl] = useState(settings.catalog_sheet_url);
  const [saving, setSaving] = useState(false);
  const urlOk = !!extractSheetId(url);
  const editable = !settings.catalog_sheet_from_env;

  const saveUrl = async () => {
    setSaving(true);
    const res = await saveCatalogSheetUrl(url);
    setSaving(false);
    if (!res.ok) return show("error", res.error);
    show("success", c.linkSaved);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsPanel settings={settings} isAdmin onSaved={(message) => show("success", message)} />
      <section aria-labelledby="catalog-link-title" className="card flex flex-col gap-4 p-5 sm:p-6">
        <h2 id="catalog-link-title" className="m-0 text-lg font-bold">{c.syncTitle}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label={c.sheetUrl}
            htmlFor="catalog-sheet-url"
            error={urlOk ? undefined : t.sync.sheetUrlInvalid}
            hint={settings.catalog_sheet_from_env ? c.sheetUrlFromEnv : c.sheetUrlHint}
            className="min-w-0 flex-[1_1_320px]"
          >
            <input
              id="catalog-sheet-url"
              readOnly={!editable}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-describedby="catalog-sheet-url-msg"
              aria-invalid={!urlOk || undefined}
              className={inputClass(!urlOk)}
            />
          </Field>
          {editable && (
            <button type="button" onClick={saveUrl} disabled={!urlOk || saving || url.trim() === settings.catalog_sheet_url} className="btn btn-outline">
              {saving ? "…" : t.settings.saveSettings}
            </button>
          )}
        </div>
      </section>
      <Toast toast={toast} onClose={clear} closeLabel={t.close} />
    </div>
  );
}
