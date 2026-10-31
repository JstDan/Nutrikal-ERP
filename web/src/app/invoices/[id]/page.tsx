import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt, formatDate, formatNumber, formatPrice, getDict } from "@/lib/i18n";
import { issueInvoice } from "@/app/actions";
import { addInvoicePayment, addServiceLine, copyInvoice, createInvoiceNote, deleteInvoiceNote, deleteInvoicePayment, deleteNoteLine, makeProforma, saveInvoiceTerms, saveNoteLine } from "@/app/batch-actions";
import { loadSettings } from "@/lib/calculator/db";
import { ActionForm } from "@/components/action-form";
import { Card, Chip, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { VatToggle } from "@/components/vat-toggle";
import { ProformaPdfButton } from "@/components/proforma-pdf-button";
import { SendDocument } from "@/components/send-document";
import { loadSendInfo } from "@/lib/sends";
import { SalesDocument } from "@/components/sales-document";
import type { ProformaPdfModel } from "@/lib/proforma-pdf";

type Party = Record<string, string | boolean | null>;
type Invoice = {
  id: string; status: "draft" | "issued"; number: string | null; issue_date: string | null; tax_point_date: string | null;
  currency: string; vat_pct: string; locale: "bg" | "en"; seller: Party; buyer: Party; notes: string | null;
  subtotal: string | null; vat_amount: string | null; total: string | null; order_id: string | null; order_code: string | null;
  client_id: string; due_date: string | null; payment_method: "bank" | "cash" | "card";
  vat_basis: string | null; proforma_no: string | null; proforma_date: string | null;
  kind: "invoice" | "credit_note" | "debit_note"; reason: string | null; corrects_invoice_id: string | null;
  corrects_number: string | null; corrects_date: string | null;
};
type Note = { id: string; kind: "credit_note" | "debit_note"; status: string; number: string | null; total: string | null };
type Line = { id: string; description: string; offer_no: string | null; capsules: number | null; quantity: string; unit_price: string; amount: string };
type Payment = { id: string; paid_on: string; amount: string; method: "bank" | "cash" | "card"; note: string | null };
type Seller = { logo_data_url: string | null };

/** An invoice: a draft is checked and issued here (number and date); an issued one is downloaded or printed. */
export default async function InvoicePage({ params, searchParams }: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  const { user, locale, t } = await requireRole("admin", "sales");
  const I = t.invoices;

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const inv = (await tx.query<Invoice>(
      `select i.id, i.status, i.number, i.issue_date::text, i.tax_point_date::text, i.currency, i.vat_pct::text, i.locale,
              i.seller, i.buyer, i.notes, i.subtotal::text, i.vat_amount::text, i.total::text, i.order_id, so.code as order_code,
              i.kind, i.reason, i.corrects_invoice_id, o.number as corrects_number, o.issue_date::text as corrects_date,
              i.client_id, i.due_date::text, i.payment_method, i.vat_basis, i.proforma_no, i.proforma_date::text
         from invoices i left join sales_orders so on so.id = i.order_id
         left join invoices o on o.id = i.corrects_invoice_id where i.id = $1`, [id])).rows[0];
    if (!inv) return null;
    const lines = (await tx.query<Line>(
      `select id, description, offer_no, capsules, quantity::text, unit_price::text, amount::text
         from invoice_lines where invoice_id = $1 order by sort_order`, [id])).rows;
    const next = (await tx.query<{ n: string | null }>("select next_invoice_number() as n")).rows[0]?.n ?? "";
    const seller = (await tx.query<Seller>("select logo_data_url from calc_settings limit 1")).rows[0];
    const rate = inv.order_id ? (await tx.query<{ r: string }>("select order_vat_rate($1)::text as r", [inv.order_id])).rows[0]?.r : inv.vat_pct;
    const payments = (await tx.query<Payment>("select id, paid_on::text, amount::text, method, note from invoice_payments where invoice_id = $1 order by paid_on", [id])).rows;
    const open = (await tx.query<{ n: string | null }>("select invoice_open_amount($1)::text as n", [id])).rows[0]?.n ?? null;
    const notes = (await tx.query<Note>(
      "select id, kind, status, number, total::text from invoices where corrects_invoice_id = $1 order by created_at", [id])).rows;
    return { inv, lines, next, logo: seller?.logo_data_url ?? null, rate: Number(rate ?? 20), notes, payments, open };
  });
  if (!data) notFound();
  const { inv: x, lines, next, logo, rate, notes, payments, open } = data;
  const draft = x.status === "draft";
  // No order: the lines and terms are written here, and payments are recorded here
  const direct = !x.order_id;
  const asProforma = draft && !!x.proforma_no && (await searchParams).proforma === "1";
  const services = draft && direct ? (await loadSettings(user.id)).service_presets : [];
  const W = I.direct;
  const today = new Date().toISOString().slice(0, 10);

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

  const send = draft ? null : await loadSendInfo(user.id, user.name, "invoice", x.id, { orderId: x.order_id, clientId: x.client_id, title: docTitle, no: x.number ?? "", lang: l });

  if (asProforma) {
    const proforma = await loadSendInfo(user.id, user.name, "proforma", x.id, { clientId: x.client_id, title: P.title, no: x.proforma_no!, lang: l });
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2 print:hidden">
          <ProformaPdfButton model={model} label={t.orders.proforma.download} errorText={t.orders.proforma.downloadFailed} />
          <PrintButton label={t.orders.proforma.printNow} variant="outline" />
          <Link href={`/invoices/${x.id}`} className="btn btn-outline">{W.toDraft}</Link>
        </div>
        <SendDocument info={proforma} model={model} text={t.send} locale={locale} />
        <SalesDocument model={model} lang={l} sellerName={str(s.name)} />
      </div>
    );
  }

  const reminder = send && !isNote && Number(open ?? 0) > 0 ? {
    ...send, history: [],
    subject: fmt(doc.invoices.direct.reminderSubject, { no: x.number ?? "" }),
    body: fmt(doc.invoices.direct.reminderBody, {
      no: x.number ?? "", date: formatDate(l, x.issue_date), amount: money(Number(open)),
      due: x.due_date ? formatDate(l, x.due_date) : "—", name: user.name,
    }),
  } : null;

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
              <span>{[str(b.name), x.order_code].filter(Boolean).join(" · ")}</span>
            </span>
          }
        />
      </div>

      {draft && (isNote || direct) && (
        <div className="print:hidden">
          <Card title={isNote ? N.lines : W.lines} id="note-lines-h">
            {x.kind === "credit_note" && <p className="m-0 text-sm text-ink-2">{N.linesNote}</p>}
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
            {!isNote && services.length > 0 && (
              <div className="border-t border-mist pt-3">
                <ActionForm action={addServiceLine} submitLabel={W.addService}>
                  <input type="hidden" name="note_id" value={x.id} />
                  <label className="field"><span>{W.service}</span>
                    <select name="service" required className="input" defaultValue="">
                      <option value="" disabled>—</option>
                      {services.map((p, i) => <option key={i} value={i}>{p.description} · {money(p.price)}</option>)}
                    </select>
                  </label>
                </ActionForm>
              </div>
            )}
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

      {draft && direct && !isNote && (
        <div className="print:hidden">
          <Card title={W.terms} id="terms-h">
            <ActionForm action={saveInvoiceTerms} submitLabel={t.common.save} resetOnSuccess={false}>
              <input type="hidden" name="invoice_id" value={x.id} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="field"><span>{W.vat}</span><input name="vat_pct" type="number" min={0} max={100} step="any" defaultValue={vatPct} className="input" /></label>
                <label className="field"><span>{W.taxDate}</span><input name="tax_date" type="date" defaultValue={x.tax_point_date ?? ""} className="input" /></label>
                <label className="field"><span>{W.due}</span><input name="due_date" type="date" defaultValue={x.due_date ?? ""} className="input" /></label>
                <label className="field"><span>{W.method}</span>
                  <select name="method" className="input" defaultValue={x.payment_method}>
                    {(["bank", "cash", "card"] as const).map((m) => <option key={m} value={m}>{W.methods[m]}</option>)}
                  </select>
                </label>
                {vatPct === 0 && (
                  <>
                    <label className="field md:col-span-2"><span>{W.vatBasis} *</span>
                      <select name="vat_basis" className="input" defaultValue={doc.invoices.direct.vatBases.includes(x.vat_basis ?? "") ? x.vat_basis ?? "" : ""}>
                        <option value="">—</option>
                        {doc.invoices.direct.vatBases.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </label>
                    <label className="field md:col-span-2"><span>{W.vatBasisOther}</span>
                      <input name="vat_basis_other" defaultValue={x.vat_basis && !doc.invoices.direct.vatBases.includes(x.vat_basis) ? x.vat_basis : ""} className="input" />
                    </label>
                  </>
                )}
                <label className="field md:col-span-2"><span>{W.notes}</span><textarea name="notes" defaultValue={x.notes ?? ""} className="input" /></label>
              </div>
              {vatPct > 0 && <p className="m-0 text-xs text-ink-2">{W.vatBasisHint}</p>}
            </ActionForm>
            <ActionForm action={makeProforma} submitLabel={x.proforma_no ? fmt(W.openProforma, { no: x.proforma_no }) : W.makeProforma} resetOnSuccess={false}>
              <input type="hidden" name="invoice_id" value={x.id} />
              <p className="m-0 text-xs text-ink-2">{W.proformaNote}</p>
            </ActionForm>
          </Card>
        </div>
      )}

      {!draft && !isNote && (
        <div className="print:hidden">
          <Card title={W.payments} id="payments-h">
            {x.order_id && Number(open ?? 0) <= 0 && payments.length === 0 && <p className="m-0 text-sm text-ink-2">{W.paidByOrder}</p>}
            <p className="m-0 text-sm"><strong>{Number(open ?? 0) > 0 ? fmt(W.open, { amount: money(Number(open)) }) : W.paid}</strong>{x.due_date ? ` · ${W.due}: ${formatDate(locale, x.due_date)}` : ""}</p>
            {payments.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-mist pt-2 text-sm">
                <span className="min-w-0 break-words">{formatDate(locale, p.paid_on)} · {money(Number(p.amount))} · {W.methods[p.method]}{p.note ? ` · ${p.note}` : ""}</span>
                {user.canPay && (
                  <form action={deleteInvoicePayment}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="min-h-11 text-xs text-ink-2 underline">{N.removeLine}</button>
                  </form>
                )}
              </div>
            ))}
            {user.canPay && Number(open ?? 0) > 0 && (
              <ActionForm action={addInvoicePayment} submitLabel={W.addPayment}>
                <input type="hidden" name="invoice_id" value={x.id} />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <label className="field"><span>{W.paidOn} *</span><input name="paid_on" type="date" required defaultValue={today} className="input" /></label>
                  <label className="field"><span>{W.amount} *</span><input name="amount" type="number" min="0.01" step="0.01" required defaultValue={Number(open)} className="input" /></label>
                  <label className="field"><span>{W.method}</span>
                    <select name="method" className="input" defaultValue={x.payment_method}>
                      {(["bank", "cash", "card"] as const).map((m) => <option key={m} value={m}>{W.methods[m]}</option>)}
                    </select>
                  </label>
                </div>
                <label className="field"><span>{W.notes}</span><input name="note" className="input" /></label>
              </ActionForm>
            )}
          </Card>
        </div>
      )}

      {draft ? (
        <div className="print:hidden">
          <Card title={isNote ? N.issueTitle : I.issueTitle} id="issue-h">
            <p className="m-0 text-sm text-ink-2">{I.draftNote}</p>
            {!isNote && !direct && (
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
                    readOnly={!user.canPay} aria-describedby="invoice-number-hint" className="input tabular-nums"
                  />
                  <small id="invoice-number-hint" className="text-xs text-ink-2">
                    {fmt(I.nextHint, { n: next })}{!user.canPay && ` ${I.adminChangesNumber}`}
                  </small>
                </label>
                <label className="field">
                  <span>{I.issueDate} *</span>
                  <input name="issue_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input" />
                </label>
              </div>
              {user.canPay && (
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
          {x.order_id && <Link href={`/orders/${x.order_id}`} className="btn btn-outline">{I.toOrder}</Link>}
          {direct && !isNote && (
            <ActionForm action={copyInvoice} submitLabel={W.copy} resetOnSuccess={false}>
              <input type="hidden" name="invoice_id" value={x.id} />
            </ActionForm>
          )}
        </div>
      )}

      {send && <SendDocument info={send} model={model} text={t.send} locale={locale} />}
      {reminder && <SendDocument info={reminder} model={model} text={t.send} locale={locale} title={W.reminder} />}

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
