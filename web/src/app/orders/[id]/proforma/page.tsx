import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt, formatDate, formatNumber, formatPrice, getDict, type Locale } from "@/lib/i18n";
import { PrintButton } from "@/components/print-button";
import { SalesDocument } from "@/components/sales-document";
import { ProformaPdfButton } from "@/components/proforma-pdf-button";
import type { ProformaPdfModel } from "@/lib/proforma-pdf";
import { calcOfferCapsulesSql } from "@/lib/calculator/catalogCapsules";

type Doc = {
  code: string; currency: string; vat_pct: string | null; created_at: string; customer_ref: string | null; notes: string | null;
  locale: Locale; client: string; client_vat: string | null; client_company_id: string | null; client_address: string | null;
  client_registration: string | null; client_city: string | null; client_postal: string | null; client_country: string;
};
type Line = { kind: string; description: string; quantity: number; unit_price: string; offer_no: string | null; capsules: number | null };
type Seller = {
  company_name: string; company_id: string; company_vat: string; company_address: string; company_email: string; company_phone: string;
  bank_name: string; bank_iban: string; bank_bic: string; logo_data_url: string | null;
};

/** The proforma of an order as the client receives it: the client's language; print or save as PDF from the browser. */
export default async function ProformaPage({ params }: PageProps<"/orders/[id]/proforma">) {
  const { id } = await params;
  const { user, t: ui } = await requireRole("admin", "sales");

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const doc = (await tx.query<Doc>(
      `select so.code, so.currency, so.vat_pct::text, so.created_at::text, so.customer_ref, so.notes,
              c.preferred_locale as locale, c.legal_name as client, c.vat_number as client_vat, c.company_id as client_company_id,
              c.address_line1 as client_address, c.registration_address as client_registration, c.city as client_city,
              c.postal_code as client_postal, c.country_code as client_country
         from sales_orders so join clients c on c.id = so.client_id where so.id = $1`, [id])).rows[0];
    if (!doc) return null;
    const lines = (await tx.query<Line>(
      `select l.kind, coalesce(l.description, f.name) as description, l.quantity, l.unit_price::text,
              coalesce(co.offer_no, of.code) as offer_no, ${calcOfferCapsulesSql("co")} as capsules
         from sales_order_lines l
         left join calc_offers co on co.id = l.calc_offer_id
         left join offers of on of.id = l.offer_id
         left join formula_versions v on v.id = l.formula_version_id
         left join formulas f on f.id = v.formula_id
        where l.order_id = $1 order by l.sort_order`, [id])).rows;
    const seller = (await tx.query<Seller>(
      `select company_name, company_id, company_vat, company_address, company_email, company_phone, bank_name, bank_iban, bank_bic, logo_data_url
         from calc_settings limit 1`)).rows[0];
    return { doc, lines, seller };
  });
  if (!data) notFound();
  const { doc: o, lines, seller: s } = data;

  const l = o.locale === "bg" ? "bg" : "en";
  const P = getDict(l).orders.proforma;
  const money = (n: number | string) => formatPrice(l, n, o.currency);
  const describe = (x: Line) => (x.capsules ? fmt(P.withCapsules, { name: x.description, n: formatNumber(l, x.capsules) }) : x.description);
  const subtotal = lines.reduce((a, x) => a + Number(x.unit_price) * x.quantity, 0);
  const vatPct = Number(o.vat_pct ?? 0);
  const vat = Math.round(subtotal * vatPct) / 100;
  const buyerAddress = o.client_registration
    || [o.client_address, [o.client_postal, o.client_city].filter(Boolean).join(" "), o.client_country].filter(Boolean).join(", ");

  const model: ProformaPdfModel = {
    fileName: `Proforma-${o.code}.pdf`,
    title: P.title,
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
        o.client, buyerAddress,
        o.client_company_id ? `${P.companyId}: ${o.client_company_id}` : "", o.client_vat ? `${P.vatNo}: ${o.client_vat}` : "",
        o.customer_ref ? fmt(P.customerRef, { ref: o.customer_ref }) : "",
      ].filter(Boolean),
    },
    head: [P.description, P.quantity, P.unitPrice, P.amount],
    rows: lines.map((x) => ({
      description: describe(x),
      note: x.offer_no ? fmt(P.accordingTo, { no: x.offer_no }) : null,
      quantity: formatNumber(l, x.quantity),
      unitPrice: money(Number(x.unit_price)),
      amount: money(Number(x.unit_price) * x.quantity),
    })),
    totals: [
      [P.subtotal, money(subtotal)],
      [fmt(P.vat, { pct: formatNumber(l, vatPct) }), money(vat)],
      [P.total, money(subtotal + vat)],
    ],
    vatNote: vatPct === 0 ? P.zeroVat : null,
    bank: {
      heading: P.bank,
      lines: [`${P.bankName}: ${s?.bank_name ?? ""}`, `IBAN: ${s?.bank_iban ?? ""}`, `BIC: ${s?.bank_bic ?? ""}`, fmt(P.reference, { code: o.code })],
    },
    notes: o.notes,
    footer: P.note,
    logoDataUrl: s?.logo_data_url ?? null,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        <ProformaPdfButton model={model} label={ui.orders.proforma.download} errorText={ui.orders.proforma.downloadFailed} />
        <PrintButton label={ui.orders.proforma.printNow} variant="outline" />
        <Link href={`/orders/${id}`} className="btn btn-outline">{ui.orders.proforma.back}</Link>
      </div>

      <SalesDocument model={model} lang={l} sellerName={s?.company_name ?? ""} />
    </div>
  );
}
