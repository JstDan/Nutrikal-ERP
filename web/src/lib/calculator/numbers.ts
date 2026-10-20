/** Parse a user-typed number; accepts both comma and dot as decimal separator. Returns null when empty/invalid. */
export function parseNum(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  const s = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!s || !/^-?\d*\.?\d*$/.test(s) || s === '.' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Parse a positive whole number (> 0); null otherwise. */
export function parsePositiveInt(input: string | number | null | undefined): number | null {
  const n = parseNum(input);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
}

/** Keep only characters that can form a decimal number while typing. */
export function sanitizeDecimalInput(input: string, allowDecimals = true): string {
  const cleaned = input.replace(allowDecimals ? /[^\d.,]/g : /\D/g, '');
  if (!allowDecimals) return cleaned;
  // Allow a single decimal separator (the first one typed).
  const idx = cleaned.search(/[.,]/);
  return idx < 0 ? cleaned : cleaned.slice(0, idx + 1) + cleaned.slice(idx + 1).replace(/[.,]/g, '');
}

// The formatters below are for the English PDF offer. The interface uses formatMoney / formatNumber
// from @/lib/i18n so numbers follow the Bulgarian or English interface.

const eurFormatters = new Map<number, Intl.NumberFormat>();

export function formatEur(value: number, decimals = 2): string {
  let f = eurFormatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    eurFormatters.set(decimals, f);
  }
  return f.format(value);
}

export function formatNumber(value: number, maxDecimals = 2, minDecimals = 0): string {
  return new Intl.NumberFormat('en-IE', {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

/** Format an ISO date (yyyy-mm-dd) as dd.mm.yyyy. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Local date as yyyy-mm-dd, optionally shifted by a number of days. */
export function isoDate(daysFromToday = 0, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + daysFromToday);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
