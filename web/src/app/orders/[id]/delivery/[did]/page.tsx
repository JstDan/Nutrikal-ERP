import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt, formatDate, formatNumber, getDict } from "@/lib/i18n";
import { PrintButton } from "@/components/print-button";
import { SalesDocument } from "@/components/sales-document";
import { ProformaPdfButton } from "@/components/proforma-pdf-button";
import type { ProformaPdfModel } from "@/lib/proforma-pdf";

type Note = {
  code: string; dispatched_on: string; carrier: string | null; tracking: string | null; notes: string | null; order_code: string;
  customer_ref: string | null; locale: string; client: string; client_vat: string | null; client_company_id: string | null;
  client_address: string | null; client_registration: string | null; client_city: string | null; client_postal: string | null; client_country: string;
};
type Line = { name: string; name_bg: string | null; lot_number: string; expires_on: string | null; quantity: string };
type Seller = { company_name: string; company_id: string; company_vat: string; company_address: string; company_email: string; company_phone: string; logo_data_url: string | null };

/** The delivery note as the client receives it: in the client's language, without prices. */
export default async function DeliveryNotePage({ params }: PageProps<"/orders/[id]/delivery/[did]">) {
  const { id, did } = await params;
  const { user, t: ui } = await requireRole("admin", "sales");

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(did)) return null;
    const n = (await tx.query<Note>(
      `select d.code, d.dispatched_on::text, d.carrier, d.tracking, d.notes, so.code as order_code, so.customer_ref,
              c.preferred_locale as locale, c.legal_name as client, c.vat_number as client_vat, c.company_id as client_company_id,
              c.address_line1 as client_address, c.registration_address as client_registration, c.city as client_city,
              c.postal_code as client_postal, c.country_code as client_country
         from dispatches d join sales_orders so on so.id = d.order_id join clients c on c.id = so.client_id
        where d.id = $1 and d.order_id = $2`, [did, id])).rows[0];
    if (!n) return null;
    const lines = (await tx.query<Line>(
      `select i.name, i.name_bg, l.lot_number, l.expires_on::text, dl.quantity::text
         from dispatch_lines dl join lots l on l.id = dl.lot_id join items i on i.id = dl.item_id
        where dl.dispatch_id = $1 order by i.name, l.lot_number`, [did])).rows;
    const seller = (await tx.query<Seller>(
      "select company_name, company_id, company_vat, company_address, company_email, company_phone, logo_data_url from calc_settings limit 1")).rows[0];
    return { n, lines, seller };
  });
  if (!data) notFound();
  const { n, lines, seller: s } = data;

  const l = n.locale === "bg" ? "bg" : "en";
  const dict = getDict(l);
  const D = dict.dispatch.doc;
  const P = dict.orders.proforma;
  const units = lines.reduce((a, x) => a + Number(x.quantity), 0);
  const address = n.client_registration
    || [n.client_address, [n.client_postal, n.client_city].filter(Boolean).join(" "), n.client_country].filter(Boolean).join(", ");

  const model: ProformaPdfModel = {
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
        n.client, address,
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
    logoDataUrl: s?.logo_data_url ?? null,
  };

  const U = ui.dispatch.doc;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        <ProformaPdfButton model={model} label={U.download} errorText={U.failed} />
        <PrintButton label={U.print} variant="outline" />
        <Link href={`/orders/${id}`} className="btn btn-outline">{U.back}</Link>
      </div>
      <SalesDocument model={model} lang={l} sellerName={s?.company_name ?? ""} />
    </div>
  );
}
