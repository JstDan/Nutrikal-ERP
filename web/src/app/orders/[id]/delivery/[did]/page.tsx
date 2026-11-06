import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { getDict } from "@/lib/i18n";
import { PrintButton } from "@/components/print-button";
import { SalesDocument } from "@/components/sales-document";
import { ProformaPdfButton } from "@/components/proforma-pdf-button";
import { SendDocument } from "@/components/send-document";
import { loadSendInfo } from "@/lib/sends";
import { bgSeller, loadCompanyBg } from "@/lib/company-bg";
import { deliveryModel, type DeliveryLine, type DeliveryNote, type DocSeller } from "@/lib/order-docs";

type Note = DeliveryNote;
type Line = DeliveryLine;
type Seller = DocSeller;

/** The delivery note as the client receives it: in the client's language, without prices. */
export default async function DeliveryNotePage({ params }: PageProps<"/orders/[id]/delivery/[did]">) {
  const { id, did } = await params;
  const { user, locale, t: ui } = await requireRole("admin", "sales");

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
  const D = getDict(l).dispatch.doc;
  const cbg = await loadCompanyBg(user.id);
  const both = { bg: deliveryModel({ ...n, locale: "bg" }, lines, bgSeller(s, cbg)), en: deliveryModel({ ...n, locale: "en" }, lines, s) };
  const model = both[l];

  const U = ui.dispatch.doc;
  const send = await loadSendInfo(user.id, user.name, "delivery_note", did, { orderId: id, title: D.title, no: n.code, lang: l });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        <ProformaPdfButton models={both} langText={ui.common.docLang} label={U.download} errorText={U.failed} />
        <PrintButton label={U.print} variant="outline" />
        <Link href={`/orders/${id}`} className="btn btn-outline">{U.back}</Link>
      </div>
      <SendDocument info={send} model={model} text={ui.send} locale={locale} />
      <SalesDocument model={model} lang={l} sellerName={s?.company_name ?? ""} />
    </div>
  );
}
