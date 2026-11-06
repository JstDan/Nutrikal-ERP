import { q } from "@/lib/db/engine";
import type { DocSeller } from "@/lib/order-docs";

/** The company's name and address in Bulgarian (Settings), for documents downloaded in Bulgarian. */
export type CompanyBg = { name: string; address: string };

export async function loadCompanyBg(userId: string): Promise<CompanyBg> {
  const [row] = await q<{ b: CompanyBg | null }>(userId, "select company_bg() as b");
  return { name: row?.b?.name ?? "", address: row?.b?.address ?? "" };
}

/** The seller of an order document with the Bulgarian name and address (an empty one keeps the English). */
export function bgSeller<T extends DocSeller | undefined>(s: T, bg: CompanyBg): T {
  if (!s) return s;
  return { ...s, company_name: bg.name || s.company_name, company_address: bg.address || s.company_address };
}

/** The seller snapshot of an invoice (name, address) with the Bulgarian name and address. */
export function bgInvoiceSeller<T extends Record<string, string | boolean | null>>(s: T, bg: CompanyBg): T {
  return { ...s, name: bg.name || s.name, address: bg.address || s.address };
}
