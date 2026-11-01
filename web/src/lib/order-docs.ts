// The proforma and the delivery note of an order, the same for the team and in the customer panel.
import { docChrome } from "@/lib/doc-chrome";
import { fmt, formatDate, formatNumber, formatPrice, getDict, type Locale } from "@/lib/i18n";
import type { ProformaPdfModel } from "@/lib/proforma-pdf";

type Buyer = {
  client: string; client_vat: string | null; client_company_id: string | null; client_address: string | null;
  client_registration: string | null; client_city: string | null; client_postal: string | null; client_country: string;
};
export type ProformaDoc = Buyer & { code: string; currency: string; vat_pct: string | null; created_at: string; customer_ref: string | null; notes?: string | null; locale: Locale };
export type ProformaLine = { kind: string; description: string; quantity: number; unit_price: string; offer_no: string | null; capsules: number | null; ordered?: number };
export type ProformaPay = { transport_amount: string | null; deposit_amount: string | null; deposit_pct: string | null };
export type DocSeller = {
  company_name: string; company_id: string; company_vat: string; company_address: string; company_email: string; company_phone: string;
  bank_name?: string; bank_iban?: string; bank_bic?: string; logo_data_url: string | null;
};
export type DeliveryNote = Buyer & { code: string; dispatched_on: string; carrier: string | null; tracking: string | null; notes?: string | null; order_code: string; customer_ref: string | null; locale: string };
export type DeliveryLine = { name: string; name_bg: string | null; lot_number: string; expires_on: string | null; quantity: string };

const chrome = (l: Locale, s: DocSeller | undefined) =>
  docChrome(getDict(l), { name: s?.company_name ?? "", companyId: s?.company_id ?? "", address: s?.company_address ?? "", email: s?.company_email ?? "", phone: s?.company_phone ?? "" });
const address = (x: Buyer) => x.client_registration
  || [x.client_address, [x.client_postal, x.client_city].filter(Boolean).join(" "), x.client_country].filter(Boolean).join(", ");

/** With pay given it is the final proforma: the units made, transport, less the advance received. */
export function proformaModel(o: ProformaDoc, lines: ProformaLine[], s: DocSeller | undefined, opts: { vatPct: number; pay: ProformaPay | null; ordered: number }): ProformaPdfModel {
  const { vatPct, pay, ordered } = opts;
  const final = !!pay;
  const l: Locale = o.locale === "bg" ? "bg" : "en";
  const P = getDict(l).orders.proforma;
  const money = (n: number | string) => formatPrice(l, n, o.currency);
  const describe = (x: ProformaLine) => (x.capsules ? fmt(P.withCapsules, { name: x.description, n: formatNumber(l, x.capsules) }) : x.description);
  const transport = Number(pay?.transport_amount ?? 0);
  const subtotal = lines.reduce((a, x) => a + Math.round(Number(x.unit_price) * x.quantity * 100) / 100, 0) + transport;
  const vat = Math.round(subtotal * vatPct) / 100;
  // The advance received (VAT included), else its % of the order as ordered
  const advance = !pay ? 0 : pay.deposit_amount != null ? Number(pay.deposit_amount)
    : Math.round(ordered * (1 + vatPct / 100) * Number(pay.deposit_pct ?? 0)) / 100;

  return {
    fileName: final ? `Proforma-final-${o.code}.pdf` : `Proforma-${o.code}.pdf`,
    title: final ? P.finalTitle : P.title,
    meta: [`${P.number} ${o.code}`, `${P.date}: ${formatDate(l, o.created_at)}`],
    seller: {
      heading: P.seller,
      lines: [
        s?.company_name ?? "", s?.company_address ?? "",
        s?.company_id ? `${P.companyId}: ${s.company_id}` : "", s?.company_vat ? `${P.vatNo}: ${s.company_vat}` : "",
        [s?.company_email, s?.company_phone].filter(Boolean).join(" · "),
      ].filter(Boolean),
    },
    buyer: {
      heading: P.buyer,
      lines: [
        o.client, address(o),
        o.client_company_id ? `${P.companyId}: ${o.client_company_id}` : "", o.client_vat ? `${P.vatNo}: ${o.client_vat}` : "",
        o.customer_ref ? fmt(P.customerRef, { ref: o.customer_ref }) : "",
      ].filter(Boolean),
    },
    head: [P.description, P.quantity, P.unitPrice, P.amount],
    rows: lines.map((x) => ({
      description: describe(x),
      note: [x.offer_no ? fmt(P.accordingTo, { no: x.offer_no }) : "", final && x.kind !== "service" && x.ordered != null ? fmt(P.produced, { n: formatNumber(l, x.ordered) }) : ""]
        .filter(Boolean).join(" · ") || null,
      quantity: formatNumber(l, x.quantity),
      unitPrice: money(Number(x.unit_price)),
      amount: money(Number(x.unit_price) * x.quantity),
    })).concat(transport > 0 ? [{ description: P.transport, note: null, quantity: formatNumber(l, 1), unitPrice: money(transport), amount: money(transport) }] : []),
    totals: [
      [P.subtotal, money(subtotal)],
      [fmt(P.vat, { pct: formatNumber(l, vatPct) }), money(vat)],
      [P.total, money(subtotal + vat)],
      ...(final ? [[P.lessAdvance, money(-advance)], [P.due, money(Math.max(0, subtotal + vat - advance))]] as [string, string][] : []),
    ],
    vatNote: vatPct === 0 ? P.zeroVat : null,
    bank: {
      heading: P.bank,
      lines: [`${P.bankName}: ${s?.bank_name ?? ""}`, `IBAN: ${s?.bank_iban ?? ""}`, `BIC: ${s?.bank_bic ?? ""}`, fmt(P.reference, { code: o.code })],
    },
    notes: o.notes ?? null,
    footer: final ? P.finalNote : P.note,
    ...chrome(l, s),
    logoDataUrl: s?.logo_data_url ?? null,
  };
}

/** In the client's language, without prices. */
export function deliveryModel(n: DeliveryNote, lines: DeliveryLine[], s: DocSeller | undefined): ProformaPdfModel {
  const l: Locale = n.locale === "bg" ? "bg" : "en";
  const dict = getDict(l);
  const D = dict.dispatch.doc;
  const P = dict.orders.proforma;
  const units = lines.reduce((a, x) => a + Number(x.quantity), 0);
  return {
    fileName: `${D.fileName}-${n.code}.pdf`,
    title: D.title,
    meta: [`${D.number}: ${n.code}`, `${D.date}: ${formatDate(l, n.dispatched_on)}`, fmt(D.orderRef, { code: n.order_code })],
    seller: {
      heading: D.from,
      lines: [
        s?.company_name ?? "", s?.company_address ?? "",
        s?.company_id ? `${P.companyId}: ${s.company_id}` : "", s?.company_vat ? `${P.vatNo}: ${s.company_vat}` : "",
        [s?.company_email, s?.company_phone].filter(Boolean).join(" · "),
      ].filter(Boolean),
    },
    buyer: {
      heading: D.to,
      lines: [
        n.client, address(n),
        n.client_company_id ? `${P.companyId}: ${n.client_company_id}` : "", n.client_vat ? `${P.vatNo}: ${n.client_vat}` : "",
        n.customer_ref ? fmt(D.customerRef, { ref: n.customer_ref }) : "",
      ].filter(Boolean),
    },
    head: [D.product, D.batch, D.expires, D.quantity],
    rows: lines.map((x) => ({
      description: l === "bg" && x.name_bg ? x.name_bg : x.name,
      note: null,
      quantity: x.lot_number,
      unitPrice: formatDate(l, x.expires_on),
      amount: formatNumber(l, x.quantity),
    })),
    totals: [[D.total, formatNumber(l, units)]],
    vatNote: null,
    bank: n.carrier || n.tracking
      ? { heading: D.shipping, lines: [n.carrier ? fmt(D.carrier, { v: n.carrier }) : "", n.tracking ? fmt(D.tracking, { v: n.tracking }) : ""].filter(Boolean) }
      : { heading: "", lines: [] },
    notes: [n.notes, D.received].filter(Boolean).join("\n\n"),
    footer: "",
    ...chrome(l, s),
    logoDataUrl: s?.logo_data_url ?? null,
  };
}
