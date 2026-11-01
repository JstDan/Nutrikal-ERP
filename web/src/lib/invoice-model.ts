// The document of an invoice or note, the same for the team and in the customer panel.
import { fmt, formatDate, formatNumber, formatPrice, getDict } from "@/lib/i18n";
import type { ProformaPdfModel } from "@/lib/proforma-pdf";

type Party = Record<string, string | boolean | null>;
export type InvoiceDoc = {
  id: string; status: "draft" | "issued"; number: string | null; issue_date: string | null; tax_point_date: string | null;
  currency: string; vat_pct: string; locale: "bg" | "en"; seller: Party; buyer: Party; notes: string | null;
  subtotal: string | null; vat_amount: string | null; total: string | null; order_id: string | null; order_code: string | null;
  client_id: string; due_date: string | null; payment_method: "bank" | "cash" | "card";
  vat_basis: string | null; proforma_no: string | null; proforma_date: string | null;
  kind: "invoice" | "credit_note" | "debit_note"; reason: string | null; corrects_invoice_id: string | null;
  corrects_number: string | null; corrects_date: string | null;
};
export type InvoiceDocLine = { id: string; description: string; offer_no: string | null; capsules: number | null; quantity: string; unit_price: string; amount: string };

/** The document is in the client's language. */
export function invoiceModel(x: InvoiceDoc, lines: InvoiceDocLine[], logo: string | null, asProforma: boolean): ProformaPdfModel {
  const draft = x.status === "draft";
  const direct = !x.order_id;
  const l = x.locale;
  const doc = getDict(l);
  const P = doc.orders.proforma;
  const D = doc.invoices.doc;
  const NT = doc.invoices.notes;
  const isNote = x.kind !== "invoice";
  const docTitle = x.kind === "credit_note" ? NT.credit : x.kind === "debit_note" ? NT.debit : D.title;
  const money = (n: number | string) => formatPrice(l, n, x.currency);
  const s = x.seller;
  const b = x.buyer;
  const str = (v: string | boolean | null | undefined) => (typeof v === "string" ? v : "");
  const vatPct = Number(x.vat_pct);
  const subtotal = draft ? lines.reduce((a, r) => a + Number(r.amount), 0) : Number(x.subtotal);
  const vat = draft ? Math.round(subtotal * vatPct) / 100 : Number(x.vat_amount);
  const total = draft ? subtotal + vat : Number(x.total);
  const buyerAddress = b.registration
    ? str(b.address)
    : [str(b.address), [str(b.postal_code), str(b.city)].filter(Boolean).join(" "), str(b.country)].filter(Boolean).join(", ");

  const model: ProformaPdfModel = {
    fileName: asProforma ? `Proforma-${x.proforma_no}.pdf` : `${x.kind === "credit_note" ? NT.fileCredit : x.kind === "debit_note" ? NT.fileDebit : D.fileName}-${x.number ?? "draft"}.pdf`,
    title: asProforma ? P.title : docTitle,
    meta: asProforma ? [
      `${P.number} ${x.proforma_no}`,
      `${P.date}: ${formatDate(l, x.proforma_date)}`,
      ...(x.due_date ? [`${doc.invoices.direct.due}: ${formatDate(l, x.due_date)}`] : []),
    ] : [
      `${P.number} ${x.number ?? "—"}`,
      `${D.issueDate}: ${x.issue_date ? formatDate(l, x.issue_date) : "—"}`,
      ...(isNote ? [] : [`${D.taxPoint}: ${formatDate(l, x.tax_point_date)}`]),
      ...(isNote ? [fmt(NT.ofInvoice, { n: x.corrects_number ?? "", date: formatDate(l, x.corrects_date) })] : []),
      ...(x.order_code ? [fmt(D.orderRef, { code: x.order_code })] : []),
      ...(direct && x.due_date && !isNote ? [`${doc.invoices.direct.due}: ${formatDate(l, x.due_date)}`] : []),
      draft ? D.draft : D.original,
    ],
    seller: {
      heading: P.seller,
      lines: [
        str(s.name), str(s.address),
        s.company_id ? `${P.companyId}: ${str(s.company_id)}` : "", s.vat ? `${P.vatNo}: ${str(s.vat)}` : "",
        [str(s.email), str(s.phone)].filter(Boolean).join(" · "),
      ].filter(Boolean),
    },
    buyer: {
      heading: P.buyer,
      lines: [
        str(b.name), buyerAddress,
        b.company_id ? `${P.companyId}: ${str(b.company_id)}` : "", b.vat ? `${P.vatNo}: ${str(b.vat)}` : "",
        b.customer_ref ? fmt(P.customerRef, { ref: str(b.customer_ref) }) : "",
      ].filter(Boolean),
    },
    head: [P.description, P.quantity, P.unitPrice, P.amount],
    rows: lines.map((r) => ({
      description: r.capsules ? fmt(P.withCapsules, { name: r.description, n: formatNumber(l, r.capsules) }) : r.description,
      note: r.offer_no ? fmt(P.accordingTo, { no: r.offer_no }) : null,
      quantity: formatNumber(l, Number(r.quantity)),
      unitPrice: money(Number(r.unit_price)),
      amount: money(Number(r.amount)),
    })),
    totals: [
      [P.subtotal, money(subtotal)],
      [fmt(P.vat, { pct: formatNumber(l, vatPct) }), money(vat)],
      [asProforma ? P.total : D.total, money(total)],
    ],
    vatNote: x.vat_basis ?? (vatPct === 0 ? P.zeroVat : null),
    bank: isNote ? { heading: "", lines: [] } : {
      heading: D.payment,
      lines: direct
        ? [doc.invoices.direct.methods[x.payment_method], ...(x.payment_method === "bank" ? [`${P.bankName}: ${str(s.bank_name)}`, `IBAN: ${str(s.iban)}`, `BIC: ${str(s.bic)}`] : [])]
        : [D.bankTransfer, `${P.bankName}: ${str(s.bank_name)}`, `IBAN: ${str(s.iban)}`, `BIC: ${str(s.bic)}`,
            fmt(D.paidOn, { date: formatDate(l, x.tax_point_date) })],
    },
    notes: isNote ? [fmt(NT.reasonDoc, { reason: x.reason ?? "" }), x.notes].filter(Boolean).join("\n") : x.notes,
    footer: asProforma ? P.note : "",
    logoDataUrl: logo,
  };
  return model;
}
