/**
 * VIES, the European Commission's check of EU VAT numbers (owner, Nov 2026): free, no key. With Nutrikal's own VAT
 * number sent along, VIES gives a request number that proves the check (for 0 % VAT supplies to other EU countries).
 */

/** EU countries in VIES by their VAT prefix (Greece is EL, Northern Ireland XI). */
const PREFIXES = new Set(["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT",
  "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI"]);

/** The VAT prefix of a country code (GR → EL, GB → XI). */
const prefixOf = (country: string) => ({ GR: "EL", GB: "XI" } as Record<string, string>)[country.toUpperCase()] ?? country.toUpperCase();

/** The country code of a VAT prefix (EL → GR, XI → GB). */
export const countryOfPrefix = (prefix: string) => ({ EL: "GR", XI: "GB" } as Record<string, string>)[prefix] ?? prefix;

/** A VAT number cleaned and split into the VIES prefix and the number; null when it is not an EU number. */
export function splitVat(vat: string, country?: string | null): { prefix: string; number: string } | null {
  const clean = vat.toUpperCase().replace(/[\s.\-/]/g, "");
  const m = /^([A-Z]{2})([0-9A-Z+*]{2,14})$/.exec(clean);
  if (m && PREFIXES.has(m[1] === "GR" ? "EL" : m[1])) return { prefix: m[1] === "GR" ? "EL" : m[1], number: m[2] };
  if (/^[0-9A-Z+*]{2,14}$/.test(clean) && country && PREFIXES.has(prefixOf(country))) return { prefix: prefixOf(country), number: clean };
  return null;
}

export type ViesAnswer = { valid: boolean; name: string | null; address: string | null; requestId: string | null };

/** VIES leaves out what a country does not give as "---". */
const value = (s: unknown) => {
  const v = typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
  return v && v !== "---" ? v : null;
};

/** Asks VIES; throws when the service or the country's system does not answer. */
export async function checkVies(prefix: string, number: string, requester?: string | null): Promise<ViesAnswer> {
  const own = requester ? splitVat(requester, "BG") : null;
  const res = await fetch("https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      countryCode: prefix, vatNumber: number,
      ...(own ? { requesterMemberStateCode: own.prefix, requesterNumber: own.number } : {}),
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !data || typeof data.valid !== "boolean") throw new Error("VIES unavailable");
  return { valid: data.valid, name: value(data.name), address: value(data.address), requestId: value(data.requestIdentifier) };
}
