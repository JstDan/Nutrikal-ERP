"use client";

import type { Settings } from "@/lib/calculator/types";
import type { Locale } from "@/lib/i18n";
import { CalcTextProvider, Toast, useCalcText, useToast, type CalcDict } from "./kit";
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
  return (
    <div className="flex flex-col gap-6">
      <SettingsPanel settings={settings} isAdmin onSaved={(message) => show("success", message)} />
      <Toast toast={toast} onClose={clear} closeLabel={t.close} />
    </div>
  );
}
