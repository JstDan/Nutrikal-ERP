import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt, formatNumber } from "@/lib/i18n";
import { PrintButton } from "@/components/print-button";
import { VatToggle } from "@/components/vat-toggle";
import { SalesDocument } from "@/components/sales-document";
import { ProformaPdfButton } from "@/components/proforma-pdf-button";
import { SendDocument } from "@/components/send-document";
import { loadSendInfo } from "@/lib/sends";
import { proformaModel, type DocSeller, type ProformaDoc, type ProformaLine, type ProformaPay } from "@/lib/order-docs";
import { calcOfferCapsulesSql } from "@/lib/calculator/catalogCapsules";

type Doc = ProformaDoc;
type Line = ProformaLine;
type Pay = ProformaPay & { done: boolean };
type Seller = DocSeller;

/**
 * The proforma of an order as the client receives it: the client's language; print or save as PDF from the browser.
 * With or without VAT is ticked here (?vat=1 / ?vat=0; default: the order's VAT).
 * ?final=1: the final payment, once every batch is produced: the units made, transport, less the advance received.
 */
export default async function ProformaPage({ params, searchParams }: PageProps<"/orders/[id]/proforma">) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, locale, t: ui } = await requireRole("admin", "sales");
  const final = sp.final === "1";

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const doc = (await tx.query<Doc>(
      `select so.code, so.currency, so.vat_pct::text, so.created_at::text, so.customer_ref, so.notes,
              c.preferred_locale as locale, c.legal_name as client, c.vat_number as client_vat, c.company_id as client_company_id,
              c.address_line1 as client_address, c.registration_address as client_registration, c.city as client_city,
              c.postal_code as client_postal, c.country_code as client_country
         from sales_orders so join clients c on c.id = so.client_id where so.id = $1`, [id])).rows[0];
    if (!doc) return null;
    const seller = (await tx.query<Seller>(
      `select company_name, company_id, company_vat, company_address, company_email, company_phone, bank_name, bank_iban, bank_bic, logo_data_url
         from calc_settings limit 1`)).rows[0];
    const rate = Number((await tx.query<{ r: string }>("select order_vat_rate($1)::text as r", [id])).rows[0]?.r ?? 20);
    if (final) {
      const pay = (await tx.query<Pay>(
        `select transport_amount::text, deposit_amount::text, deposit_pct::text, order_production_done(id) as done
           from sales_orders where id = $1`, [id])).rows[0];
      if (!pay.done) return null;
      const lines = (await tx.query<Line>(
        "select kind, description, quantity, unit_price::text, offer_no, capsules, ordered from order_final_lines($1)", [id])).rows;
      const ordered = Number((await tx.query<{ n: string }>(
        "select coalesce(sum(round(quantity * unit_price, 2)), 0)::text as n from sales_order_lines where order_id = $1", [id])).rows[0].n);
      return { doc, lines, seller, rate, pay, ordered };
    }
    const lines = (await tx.query<Line>(
      `select l.kind, coalesce(l.description, f.name) as description, l.quantity, l.unit_price::text,
              coalesce(co.offer_no, of.code) as offer_no, ${calcOfferCapsulesSql("co")} as capsules
         from sales_order_lines l
         left join calc_offers co on co.id = l.calc_offer_id
         left join offers of on of.id = l.offer_id
         left join formula_versions v on v.id = l.formula_version_id
         left join formulas f on f.id = v.formula_id
        where l.order_id = $1 order by l.sort_order`, [id])).rows;
    return { doc, lines, seller, rate, pay: null, ordered: 0 };
  });
  if (!data) notFound();
  const { doc: o, lines, seller: s, rate, pay, ordered } = data;

  const l = o.locale === "bg" ? "bg" : "en";
  const withVat = sp.vat === "1" ? true : sp.vat === "0" ? false : Number(o.vat_pct ?? 0) > 0;
  const model = proformaModel(o, lines, s, { vatPct: withVat ? rate : 0, pay, ordered });

  const send = await loadSendInfo(user.id, user.name, "proforma", id, { orderId: id, title: model.title, no: o.code, lang: l });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        <ProformaPdfButton model={model} label={ui.orders.proforma.download} errorText={ui.orders.proforma.downloadFailed} />
        <PrintButton label={ui.orders.proforma.printNow} variant="outline" />
        <Link href={`/orders/${id}`} className="btn btn-outline">{ui.orders.proforma.back}</Link>
      </div>
      <div className="print:hidden">
        <VatToggle checked={withVat} label={fmt(ui.common.withVat, { pct: formatNumber(locale, rate) })} />
      </div>

      <SendDocument info={send} model={model} text={ui.send} locale={locale} />

      <SalesDocument model={model} lang={l} sellerName={s?.company_name ?? ""} />
    </div>
  );
}
