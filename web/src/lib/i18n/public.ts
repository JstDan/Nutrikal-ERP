import { getDict, type AnyLocale, type Locale } from "@/lib/i18n";
import { de, fr } from "./public-de-fr";
import { el, it, ro } from "./public-it-ro-el";

/** The open catalog speaks more languages than the app. What a language leaves out stays in English. */
export const PUBLIC_LOCALES: { code: AnyLocale; label: string }[] = [
  { code: "en", label: "English" }, { code: "bg", label: "Български" }, { code: "de", label: "Deutsch" }, { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" }, { code: "ro", label: "Română" }, { code: "el", label: "Ελληνικά" },
];
const extra = { de, fr, it, ro, el };

export function publicDict(locale: AnyLocale) {
  const base = getDict(locale === "bg" ? "bg" : "en");
  if (locale === "bg" || locale === "en") return { text: base.publicCatalog, formats: base.enums.productFormat, categories: {} as Record<string, string> };
  const x = extra[locale as Exclude<AnyLocale, Locale>];
  return { text: { ...base.publicCatalog, ...x.text } as typeof base.publicCatalog, formats: x.formats as typeof base.enums.productFormat, categories: x.categories as Record<string, string> };
}
