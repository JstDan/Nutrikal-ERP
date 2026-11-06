import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { ProformaPdfButton } from "@/components/proforma-pdf-button";
import { portalLangText } from "@/components/doc-lang-dialog";
import { SalesDocument } from "@/components/sales-document";
import { q } from "@/lib/db/engine";
import { deliveryModel, type DeliveryLine, type DeliveryNote, type DocSeller } from "@/lib/order-docs";
import { validId } from "@/lib/portal";
import { getPortalSession } from "@/lib/session";
import { bgSeller, loadCompanyBg } from "@/lib/company-bg";

type Row = { note: DeliveryNote; seller: DocSeller; lines: DeliveryLine[] };

/** The delivery note of a shipment, without prices or internal notes. */
export default async function PortalDelivery({ params }: PageProps<"/portal/delivery/[id]">) {
  const { id } = await params;
  const { user, t } = await getPortalSession();
  if (!validId(id)) notFound();
  const [row] = await q<{ d: Row | null }>(user.id, "select portal_delivery($1) as d", [id]);
  const x = row?.d;
  if (!x) notFound();
  const cbg = await loadCompanyBg(user.id);
  const both = { bg: deliveryModel({ ...x.note, locale: "bg" }, x.lines, bgSeller(x.seller, cbg)), en: deliveryModel({ ...x.note, locale: "en" }, x.lines, x.seller) };
  const model = both[x.note.locale === "bg" ? "bg" : "en"];
  return (
    <>
      <div className="flex flex-col gap-3 print:hidden">
        <PageHeader title={model.title} crumb={<Link href="/portal/orders">{t.portal.nav.orders}</Link>} />
        <div className="flex flex-wrap gap-2">
          <ProformaPdfButton models={both} langText={portalLangText(t.portal.invoices)} label={t.portal.invoices.pdf} errorText={t.portal.invoices.pdfFailed} />
          <PrintButton label={t.portal.invoices.print} variant="outline" />
        </div>
      </div>
      <SalesDocument model={model} lang={x.note.locale} sellerName={x.seller?.company_name ?? ""} />
    </>
  );
}
