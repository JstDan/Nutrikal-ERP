import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { ProformaPdfButton } from "@/components/proforma-pdf-button";
import { portalLangText } from "@/components/doc-lang-dialog";
import { SalesDocument } from "@/components/sales-document";
import { q } from "@/lib/db/engine";
import { proformaModel, type DocSeller, type ProformaDoc, type ProformaLine, type ProformaPay } from "@/lib/order-docs";
import { validId } from "@/lib/portal";
import { getPortalSession } from "@/lib/session";

type Line = ProformaLine & { produced: number | null };
type Row = { doc: ProformaDoc; seller: DocSeller; rate: number; done: boolean; pay: ProformaPay; ordered: number; lines: Line[] };

/** The proforma of an order; once every batch is made, ?final=1 is the final one. Internal notes stay out. */
export default async function PortalProforma({ params, searchParams }: PageProps<"/portal/orders/[id]/proforma">) {
  const { id } = await params;
  const final = (await searchParams).final === "1";
  const { user, t } = await getPortalSession();
  if (!validId(id)) notFound();
  const [row] = await q<{ d: Row | null; advance_base: string | null }>(user.id,
    "select portal_proforma($1) as d, order_advance_base($1)::text as advance_base", [id]);
  const x = row?.d;
  if (!x || (final && !x.done)) notFound();
  x.pay = { ...x.pay, advance_base: row.advance_base };
  const lines: ProformaLine[] = final
    ? x.lines.map((l) => ({ ...l, ordered: l.quantity, quantity: l.kind !== "service" && l.produced != null ? l.produced : l.quantity }))
    : x.lines;
  const vatPct = Number(x.doc.vat_pct ?? 0) > 0 ? Number(x.rate) : 0;
  const make = (locale: "bg" | "en") => proformaModel({ ...x.doc, locale }, lines, x.seller, { vatPct, pay: final ? x.pay : null, ordered: Number(x.ordered) });
  const both = { bg: make("bg"), en: make("en") };
  const model = both[x.doc.locale === "bg" ? "bg" : "en"];
  return (
    <>
      <div className="flex flex-col gap-3 print:hidden">
        <PageHeader title={model.title} crumb={<Link href={`/portal/orders/${id}`}>{x.doc.code}</Link>} />
        <div className="flex flex-wrap gap-2">
          <ProformaPdfButton models={both} langText={portalLangText(t.portal.invoices)} label={t.portal.invoices.pdf} errorText={t.portal.invoices.pdfFailed} />
          <PrintButton label={t.portal.invoices.print} variant="outline" />
        </div>
      </div>
      <SalesDocument model={model} lang={x.doc.locale} sellerName={x.seller?.company_name ?? ""} />
    </>
  );
}
