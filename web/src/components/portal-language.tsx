"use client";

import { setPortalLocale } from "@/app/portal/actions";
import type { AnyLocale } from "@/lib/i18n";

/** The language of the panel: changes as soon as it is picked. */
export function PortalLanguage({ label, locale, options }: { label: string; locale: AnyLocale; options: { code: AnyLocale; label: string }[] }) {
  return (
    <form action={setPortalLocale}>
      <label>
        <span className="sr-only">{label}</span>
        <select name="locale" defaultValue={locale} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="p-lang">
          {options.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.label}</option>)}
        </select>
      </label>
    </form>
  );
}
