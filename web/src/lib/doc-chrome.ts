import type { Dict } from "@/lib/i18n/en";

/** The contacts under the logo and the strip at the foot, the same on every document. */
export function docChrome(doc: Dict, s: { name: string; companyId: string; address: string; email: string; phone: string }) {
  // "133 Street, 9000 Varna, Bulgaria" gives "Varna, Bulgaria"
  const place = s.address.split(",").slice(-2).join(",").trim().replace(/^\d+\s*/, "");
  return {
    contact: [[s.email, s.phone].filter(Boolean).join(" · "), s.address].filter(Boolean),
    base: [s.name, s.companyId && `${doc.orders.proforma.companyId}: ${s.companyId}`, place].filter(Boolean).join(" · "),
    pageOf: doc.invoices.doc.page,
  };
}
