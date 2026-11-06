import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { ProformaPdfButton } from "@/components/proforma-pdf-button";
import { portalLangText } from "@/components/doc-lang-dialog";
import { SalesDocument } from "@/components/sales-document";
import { q } from "@/lib/db/engine";
import { invoiceModel, type InvoiceDoc, type InvoiceDocLine } from "@/lib/invoice-model";
import { validId } from "@/lib/portal";
import { getPortalSession } from "@/lib/session";

type Row = InvoiceDoc & { logo: string | null; lines: InvoiceDocLine[] };

/** An issued invoice exactly as it was issued, to read, print or download. */
export default async function PortalInvoicePage({ params }: PageProps<"/portal/invoices/[id]">) {
  const { id } = await params;
  const { user, t } = await getPortalSession();
  if (!validId(id)) notFound();
  const [row] = await q<{ d: Row | null }>(user.id, "select portal_invoice($1) as d", [id]);
  const x = row?.d;
  if (!x) notFound();
  const both = { bg: invoiceModel({ ...x, locale: "bg" }, x.lines, x.logo, false), en: invoiceModel({ ...x, locale: "en" }, x.lines, x.logo, false) };
  const model = both[x.locale];
  const seller = typeof x.seller.name === "string" ? x.seller.name : "";
  return (
    <>
      <div className="flex flex-col gap-3 print:hidden">
        <PageHeader title={model.title} crumb={<Link href="/portal/invoices">{t.portal.invoices.title}</Link>} />
        <div className="flex flex-wrap gap-2">
          <ProformaPdfButton models={both} langText={portalLangText(t.portal.invoices)} label={t.portal.invoices.pdf} errorText={t.portal.invoices.pdfFailed} />
          <PrintButton label={t.portal.invoices.print} variant="outline" />
        </div>
      </div>
      <SalesDocument model={model} lang={x.locale} sellerName={seller} />
    </>
  );
}
