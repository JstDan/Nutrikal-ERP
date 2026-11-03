import { bg } from "./bg";
import { en, type Dict } from "./en";

export type Locale = "bg" | "en";
/** The open catalog also speaks these; the app does not. */
export type AnyLocale = Locale | "de" | "fr" | "it" | "ro" | "el";
export const LOCALES: Locale[] = ["bg", "en"];
export const DEFAULT_LOCALE: Locale = "bg";
export const LOCALE_COOKIE = "nk_locale";

const dicts: Record<Locale, Dict> = { bg, en };

export function getDict(locale: Locale): Dict {
  return dicts[locale] ?? dicts[DEFAULT_LOCALE];
}

export function isLocale(v: unknown): v is Locale {
  return v === "bg" || v === "en";
}

/** Replace {name} placeholders. */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

const intlLocale = (l: AnyLocale) => (l === "bg" ? "bg-BG" : l === "en" ? "en-GB" : l);

export function formatNumber(l: AnyLocale, n: number | string | null | undefined, maxFrac = 2, minFrac = 0): string {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat(intlLocale(l), { maximumFractionDigits: maxFrac, minimumFractionDigits: minFrac }).format(v);
}

export function formatQty(l: Locale, n: number | string | null | undefined, unit: string): string {
  const u = unit === "pcs" ? (l === "bg" ? "бр." : "pcs") : unit === "kg" && l === "bg" ? "кг" : unit;
  return `${formatNumber(l, n, 3)} ${u}`;
}

/** A mass given in mg, shown as mcg, mg or g, whichever reads best. */
export function formatMass(l: Locale, mg: number | string | null | undefined): string {
  const v = Number(mg ?? 0);
  if (v !== 0 && Math.abs(v) < 1) return `${formatNumber(l, v * 1000, 1)} mcg`;
  if (Math.abs(v) >= 1000) return `${formatNumber(l, v / 1000, 2)} g`;
  return `${formatNumber(l, v, 1)} mg`;
}

export function formatMoney(l: AnyLocale, n: number | string | null | undefined, currency = "EUR", decimals = 0): string {
  return new Intl.NumberFormat(intlLocale(l), {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(n ?? 0));
}

/** Unit prices and costs: always shows `frac` decimals. */
export function formatPrice(l: AnyLocale, n: number | string | null | undefined, currency = "EUR", frac = 2): string {
  return new Intl.NumberFormat(intlLocale(l), { style: "currency", currency, minimumFractionDigits: frac, maximumFractionDigits: frac }).format(Number(n ?? 0));
}

export function formatDate(l: AnyLocale, d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" }): string {
  if (!d) return "—";
  // Postgres text timestamps look like "2026-10-16 11:00:00.12+00"
  const date =
    typeof d === "string"
      ? new Date(d.length === 10 ? d + "T00:00:00" : d.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"))
      : d;
  if (Number.isNaN(date.getTime())) return "—";
  // A month or year alone (calendar headings) keeps its words
  if (!opts.day) return new Intl.DateTimeFormat(intlLocale(l), { timeZone: "Europe/Sofia", ...opts }).format(date);
  // Every date is day/month/year, e.g. 03/11/2026, in every language (owner, Nov 2026); a time is added as 14:05
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Sofia", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((x) => [x.type, x.value]));
  let out = `${p.day}/${p.month}/${p.year}`;
  if (opts.hour) out += ` ${p.hour}:${p.minute}`;
  if (opts.weekday) out = `${new Intl.DateTimeFormat(intlLocale(l), { timeZone: "Europe/Sofia", weekday: opts.weekday }).format(date)}, ${out}`;
  return out;
}
