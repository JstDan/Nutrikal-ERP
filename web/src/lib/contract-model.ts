// The production contract as a document model (for the PDF), from the stored contract, in its own language.
import { fmt, formatDate, formatNumber, formatPrice, getDict } from "@/lib/i18n";
import type { ContractPdfModel } from "@/lib/contract-pdf";

/** What is made on a row of Schedule A (from its offer; no prices). */
export type ContractProduct = { pack: string; format: string; portion: string; composition: { name: string; amount: string }[] };

export type ContractRow = {
  number: string; locale: "bg" | "en"; body: string; status: string; client: string;
  schedule: {
    currency: string; rows: { description: string; quantity: number; unit_price: number; amount: number; product?: ContractProduct | null }[];
    subtotal: number; vat_pct: number; vat: number; total: number; deposit_pct: number; deposit: number; balance: number;
  };
  accepted_at: string | null; accepted_name: string | null; accepted_title: string | null; accepted_email?: string | null; accepted_ip?: string | null;
  signed_at: string | null; created_at?: string;
};
export type ContractSeller = { name: string; address: string; email: string; phone: string; companyId: string };

export function contractModel(k: ContractRow, seller: ContractSeller): ContractPdfModel {
  const l = k.locale;
  const C = getDict(l).contract;
  const P = C.pdf;
  const s = k.schedule;
  const money = (n: number) => formatPrice(l, n, s.currency);
  const when = (d: string) => formatDate(l, d, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return {
    fileName: `${k.number}.pdf`,
    title: P.title,
    meta: [`№ ${k.number}`, ...(k.created_at ? [formatDate(l, k.created_at)] : [])],
    contact: [seller.address, [seller.email, seller.phone].filter(Boolean).join(" · ")].filter(Boolean),
    body: k.body,
    schedule: {
      title: P.schedule,
      head: P.head as [string, string, string, string],
      rows: s.rows.map((r) => [r.description, formatNumber(l, Number(r.quantity)), money(Number(r.unit_price)), money(Number(r.amount))]),
      totals: [
        [P.subtotal, money(Number(s.subtotal))],
        [fmt(P.vat, { pct: formatNumber(l, Number(s.vat_pct)) }), money(Number(s.vat))],
        [P.total, money(Number(s.total))],
        [fmt(P.deposit, { pct: formatNumber(l, Number(s.deposit_pct)) }), money(Number(s.deposit))],
        [P.balance, money(Number(s.balance))],
      ],
    },
    // What is made: only the rows that come from an offer
    spec: {
      title: P.spec,
      products: s.rows.filter((r) => r.product).map((r) => ({
        name: r.description,
        facts: ([[P.pack, r.product!.pack], [P.format, r.product!.format], [P.portion, r.product!.portion]] as [string, string][]).filter(([, v]) => v),
        compositionTitle: P.composition,
        composition: r.product!.composition.map((c) => [c.name, c.amount] as [string, string]),
      })),
    },
    stamp: k.accepted_at
      ? fmt(P.stamp, { name: k.accepted_name ?? "", title: k.accepted_title ? `, ${k.accepted_title}` : "", email: k.accepted_email ?? "", date: when(k.accepted_at), ip: k.accepted_ip ?? "—" })
      : k.signed_at ? `${P.signedStamp} · ${when(k.signed_at)}` : null,
    sign: [P.manufacturer, P.client],
    signNames: [seller.name, k.client],
    nameLine: P.nameLine,
    base: [seller.name, seller.companyId ? `${l === "bg" ? "ЕИК" : "UIC"} ${seller.companyId}` : ""].filter(Boolean).join(" · "),
    pageOf: P.pageOf,
  };
}
