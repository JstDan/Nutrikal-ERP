import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt, formatDate, formatNumber, formatPrice, getDict } from "@/lib/i18n";
import { issueInvoice } from "@/app/actions";
import { createInvoiceNote, deleteInvoiceNote, deleteNoteLine, saveNoteLine } from "@/app/batch-actions";
import { ActionForm } from "@/components/action-form";
import { Card, Chip, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { VatToggle } from "@/components/vat-toggle";
import { ProformaPdfButton } from "@/components/proforma-pdf-button";
import { SalesDocument } from "@/components/sales-document";
import type { ProformaPdfModel } from "@/lib/proforma-pdf";

type Party = Record<string, string | boolean | null>;
type Invoice = {
  id: string; status: "draft" | "issued"; number: string | null; issue_date: string | null; tax_point_date: string | null;
  currency: string; vat_pct: string; locale: "bg" | "en"; seller: Party; buyer: Party; notes: string | null;
  subtotal: string | null; vat_amount: string | null; total: string | null; order_id: string; order_code: string;
  kind: "invoice" | "credit_note" | "debit_note"; reason: string | null; corrects_invoice_id: string | null;
  corrects_number: string | null; corrects_date: string | null;
};
type Note = { id: string; kind: "credit_note" | "debit_note"; status: string; number: string | null; total: string | null };
type Line = { id: string; description: string; offer_no: string | null; capsules: number | null; quantity: string; unit_price: string; amount: string };
type Seller = { logo_data_url: string | null };

/** An invoice: a draft is checked and issued here (number and date); an issued one is downloaded or printed. */
export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  const { user, locale, t } = await requireRole("admin", "sales");
  const I = t.invoices;

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const inv = (await tx.query<Invoice>(
      `select i.id, i.status, i.number, i.issue_date::text, i.tax_point_date::text, i.currency, i.vat_pct::text, i.locale,
              i.seller, i.buyer, i.notes, i.subtotal::text, i.vat_amount::text, i.total::text, i.order_id, so.code as order_code,
              i.kind, i.reason, i.corrects_invoice_id, o.number as corrects_number, o.issue_date::text as corrects_date
         from invoices i join sales_orders so on so.id = i.order_id
         left join invoices o on o.id = i.corrects_invoice_id where i.id = $1`, [id])).rows[0];
    if (!inv) return null;
    const lines = (await tx.query<Line>(
      `select id, description, offer_no, capsules, quantity::text, unit_price::text, amount::text
         from invoice_lines where invoice_id = $1 order by sort_order`, [id])).rows;
    const next = (await tx.query<{ n: string | null }>("select next_invoice_number() as n")).rows[0]?.n ?? "";
    const seller = (await tx.query<Seller>("select logo_data_url from calc_settings limit 1")).rows[0];
    const rate = (await tx.query<{ r: string }>("select order_vat_rate($1)::text as r", [inv.order_id])).rows[0]?.r;
    const notes = (await tx.query<Note>(
      "select id, kind, status, number, total::text from invoices where corrects_invoice_id = $1 order by created_at", [id])).rows;
    return { inv, lines, next, logo: seller?.logo_data_url ?? null, rate: Number(rate ?? 20), notes };
  });
  if (!data) notFound();
  const { inv: x, lines, next, logo, rate, notes } = data;
  const draft = x.status === "draft";

  // The document is in the client's language
  const l = x.locale;
  const doc = getDict(l);
  const P = doc.orders.proforma;
  const D = doc.invoices.doc;
  const NT = doc.invoices.notes;
  const N = I.notes;
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
    fileName: `${x.kind === "credit_note" ? NT.fileCredit : x.kind === "debit_note" ? NT.fileDebit : D.fileName}-${x.number ?? "draft"}.pdf`,
    title: docTitle,
    meta: [
      `${P.number} ${x.number ?? "—"}`,
      `${D.issueDate}: ${x.issue_date ? formatDate(l, x.issue_date) : "—"}`,
      ...(isNote ? [] : [`${D.taxPoint}: ${formatDate(l, x.tax_point_date)}`]),
      ...(isNote ? [fmt(NT.ofInvoice, { n: x.corrects_number ?? "", date: formatDate(l, x.corrects_date) })] : []),
      fmt(D.orderRef, { code: x.order_code }),
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
      [D.total, money(total)],
    ],
    vatNote: vatPct === 0 ? P.zeroVat : null,
    bank: isNote ? { heading: "", lines: [] } : {
      heading: D.payment,
      lines: [D.bankTransfer, `${P.bankName}: ${str(s.bank_name)}`, `IBAN: ${str(s.iban)}`, `BIC: ${str(s.bic)}`,
        fmt(D.paidOn, { date: formatDate(l, x.tax_point_date) })],
    },
    notes: isNote ? [fmt(NT.reasonDoc, { reason: x.reason ?? "" }), x.notes].filter(Boolean).join("\n") : x.notes,
    footer: "",
    logoDataUrl: logo,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <PageHeader
          crumb={<><Link href="/invoices" className="text-ink-2">{I.title}</Link> / {x.number ?? I.statusDraft}</>}
          title={x.kind === "credit_note" ? (draft ? N.draftCredit : fmt(N.creditN, { n: x.number ?? "" }))
            : x.kind === "debit_note" ? (draft ? N.draftDebit : fmt(N.debitN, { n: x.number ?? "" }))
            : draft ? I.draftTitle : fmt(I.invoiceN, { n: x.number ?? "" })}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Chip tone={draft ? "amber" : "green"}>{draft ? I.statusDraft : I.statusIssued}</Chip>
              <span>{str(b.name)} · {x.order_code}</span>
            </span>
          }
        />
      </div>

      {draft && isNote && (
        <div className="print:hidden">
          <Card title={N.lines} id="note-lines-h">
            <p className="m-0 text-sm text-ink-2">{x.kind === "credit_note" ? N.linesNote : ""}</p>
            {lines.map((r) => (
              <div key={r.id} className="flex flex-wrap items-end gap-3 border-t border-mist pt-3">
                <ActionForm action={saveNoteLine} submitLabel={t.common.save} resetOnSuccess={false} className="min-w-0 flex-[1_1_280px]">
                  <input type="hidden" name="note_id" value={x.id} />
                  <input type="hidden" name="line_id" value={r.id} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_110px_130px]">
                    <label className="field"><span>{N.description} *</span><input name="description" required defaultValue={r.description} className="input" /></label>
                    <label className="field"><span>{N.quantity} *</span><input name="quantity" type="number" min="0.001" step="any" required defaultValue={Number(r.quantity)} className="input" /></label>
                    <label className="field"><span>{N.price} *</span><input name="unit_price" type="number" step="any" required defaultValue={Number(r.unit_price)} className="input" /></label>
                  </div>
                </ActionForm>
                <form action={deleteNoteLine}>
                  <input type="hidden" name="note_id" value={x.id} />
                  <input type="hidden" name="line_id" value={r.id} />
                  <button type="submit" className="btn btn-outline">{N.removeLine}</button>
                </form>
              </div>
            ))}
            <div className="border-t border-mist pt-3">
              <ActionForm action={saveNoteLine} submitLabel={N.addLine}>
                <input type="hidden" name="note_id" value={x.id} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_110px_130px]">
                  <label className="field"><span>{N.description} *</span><input name="description" required className="input" /></label>
                  <label className="field"><span>{N.quantity} *</span><input name="quantity" type="number" min="0.001" step="any" required defaultValue={1} className="input" /></label>
                  <label className="field"><span>{N.price} *</span><input name="unit_price" type="number" step="any" required className="input" /></label>
                </div>
              </ActionForm>
            </div>
            <form action={deleteInvoiceNote}>
              <input type="hidden" name="note_id" value={x.id} />
              <button type="submit" className="btn btn-outline">{N.deleteDraft}</button>
            </form>
          </Card>
        </div>
      )}

      {draft ? (
        <div className="print:hidden">
          <Card title={isNote ? N.issueTitle : I.issueTitle} id="issue-h">
            <p className="m-0 text-sm text-ink-2">{I.draftNote}</p>
            {!isNote && (
              <VatToggle checked={vatPct > 0} invoiceId={x.id}
                label={fmt(t.common.withVat, { pct: formatNumber(locale, vatPct > 0 ? vatPct : rate) })} />
            )}
            <ActionForm action={issueInvoice} submitLabel={isNote ? N.issue : I.issue} resetOnSuccess={false}>
              <input type="hidden" name="invoice_id" value={x.id} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="field">
                  <span>{I.numberLabel} *</span>
                  <input
                    name="number" required defaultValue={next} inputMode="numeric" pattern="[0-9]{10}" maxLength={10}
                    readOnly={user.role !== "admin"} aria-describedby="invoice-number-hint" className="input tabular-nums"
                  />
                  <small id="invoice-number-hint" className="text-xs text-ink-2">
                    {fmt(I.nextHint, { n: next })}{user.role !== "admin" && ` ${I.adminChangesNumber}`}
                  </small>
                </label>
                <label className="field">
                  <span>{I.issueDate} *</span>
                  <input name="issue_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input" />
                </label>
              </div>
              {user.role === "admin" && (
                <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm">
                  <input type="checkbox" name="confirm_number" className="h-5 w-5 shrink-0 accent-ink" />
                  <span>{I.confirmNumber}</span>
                </label>
              )}
            </ActionForm>
          </Card>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 print:hidden">
          <ProformaPdfButton model={model} label={I.download} errorText={I.downloadFailed} />
          <PrintButton label={I.print} variant="outline" />
          <Link href={`/orders/${x.order_id}`} className="btn btn-outline">{I.toOrder}</Link>
        </div>
      )}

      <SalesDocument model={model} lang={l} sellerName={str(s.name)} />

      {x.kind === "invoice" && !draft && (
        <div className="print:hidden">
          <Card title={N.corrections} id="corrections-h">
            <p className="m-0 text-sm text-ink-2">{N.correctionsNote}</p>
            {notes.length > 0 && (
              <div className="flex flex-col gap-1 text-sm">
                <span className="label">{N.existing}</span>
                {notes.map((n) => (
                  <Link key={n.id} href={`/invoices/${n.id}`} className="flex min-h-9 items-center text-ink">
                    {n.kind === "credit_note" ? N.credit : N.debit} {n.number ?? I.statusDraft}{n.total ? ` · ${money(Number(n.total))}` : ""}
                  </Link>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {(["credit_note", "debit_note"] as const).map((k) => (
                <ActionForm key={k} action={createInvoiceNote} submitLabel={k === "credit_note" ? N.createCredit : N.createDebit} resetOnSuccess={false}>
                  <input type="hidden" name="invoice_id" value={x.id} />
                  <input type="hidden" name="kind" value={k} />
                  <label className="field"><span>{N.reason} *</span><input name="reason" required className="input" /></label>
                </ActionForm>
              ))}
            </div>
          </Card>
        </div>
      )}
      {locale !== l && <p className="m-0 text-xs text-ink-2 print:hidden">{I.clientLanguage}</p>}
    </div>
  );
}
