"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteOffer } from "@/app/calculator/actions";
import { fromOfferRecord } from "@/lib/calculator/offerRecord";
import type { OfferRecord, Settings } from "@/lib/calculator/types";
import { fmt, formatDate, type Locale } from "@/lib/i18n";
import { CalcTextProvider, InfoLine, Toast, useCalcText, useToast, type CalcDict } from "./kit";
import { ClientSummary } from "./results-section";
import { SendDocument, type SendInfo } from "@/components/send-document";
import type { Dict } from "@/lib/i18n/en";
import { DocLangDialog, type DocLang, type DocLangText } from "@/components/doc-lang-dialog";

type Props = {
  t: CalcDict;
  locale: Locale;
  offer: OfferRecord;
  settings: Settings;
  canDelete: boolean;
  send: SendInfo;
  reminder: SendInfo | null;
  sendText: Dict["send"];
  reminderTitle: string;
  /** Download in BG / Download in EN, asked before every download. */
  langText: DocLangText;
};

/** Short summary of an offer created in the calculator, with the PDF download. */
export function OfferSummary(props: Props) {
  return (
    <CalcTextProvider t={props.t} locale={props.locale}>
      <Summary {...props} />
    </CalcTextProvider>
  );
}

function Summary({ offer: x, settings, canDelete, send, reminder, sendText, reminderTitle, langText }: Props) {
  const { t, locale, eur } = useCalcText();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sending, setSending] = useState(false);
  const [asking, setAsking] = useState(false);
  const { toast, show, clear } = useToast();
  const o = t.offers;
  const c = t.client;

  const { form, result } = useMemo(() => fromOfferRecord(x, settings), [x, settings]);

  const pdf = async (lang: DocLang) => {
    setAsking(false);
    setBusy(true);
    try {
      const { downloadOfferPdf } = await import("@/lib/calculator/pdf");
      await downloadOfferPdf(form, result, settings, lang);
    } catch (e) {
      show("error", `${t.results.pdfFailed}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    setBusy(true);
    const res = await deleteOffer(x.id);
    if (!res.ok) {
      setBusy(false);
      return show("error", res.error);
    }
    router.push("/offers");
  };

  return (
    <div className="flex max-w-[960px] flex-col gap-5">
      <section aria-labelledby="offer-summary-title" className="card flex min-w-0 flex-col gap-5 p-5 sm:p-6">
        <h2 id="offer-summary-title" className="m-0 text-lg font-bold">{o.summary}</h2>
        <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          <div>
            <InfoLine label={c.offerNo} value={x.offer_no} />
            <InfoLine label={c.offerDate} value={formatDate(locale, form.offer.offerDate || x.created_at)} />
            <InfoLine label={c.validUntil} value={form.offer.validUntil ? formatDate(locale, form.offer.validUntil) : "–"} />
          </div>
          <div>
            <InfoLine label={c.receiver} value={<span className="break-words">{x.receiver_name || "–"}</span>} />
            <InfoLine label={c.companyName} value={<span className="break-words">{x.company_name || "–"}</span>} />
            <InfoLine label={c.email} value={<span className="break-all">{x.receiver_email || "–"}</span>} />
          </div>
        </div>
        <ClientSummary form={form} result={result} />
        <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          <div className="hidden sm:block" />
          <div>
            {result.vatAmount > 0 && <InfoLine label={o.vat} value={eur(result.vatAmount)} />}
            <InfoLine label={o.totalInclVat} value={eur(result.totalInclVat)} strong />
          </div>
        </div>
      </section>

      <div role="group" aria-label={o.actions} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        {canDelete && (
          <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy} aria-expanded={confirmDelete} className="btn btn-outline text-red-ink!">
            {t.delete}
          </button>
        )}
        <Link href={`/calculator?copy=${x.id}`} className="btn btn-outline">{o.duplicate}</Link>
        <Link href={`/calculator?open=${x.id}`} className="btn btn-outline">{o.edit}</Link>
        <button type="button" onClick={() => setSending((v) => !v)} aria-expanded={sending} aria-controls="offer-send" className="btn btn-outline">
          {sendText.title}
        </button>
        <button type="button" onClick={() => setAsking(true)} disabled={busy} className="btn btn-primary" aria-haspopup="dialog">
          {busy ? "…" : t.results.downloadPdf}
        </button>
      </div>
      {confirmDelete && (
        <div role="alertdialog" aria-label={fmt(o.deleteConfirm, { no: x.offer_no })} className="flex flex-wrap items-center gap-3 rounded-sm border border-red-line bg-red-tint px-4 py-3">
          <span className="min-w-0 flex-[1_1_220px] font-semibold text-red-ink">{fmt(o.deleteConfirm, { no: x.offer_no })}</span>
          <button type="button" autoFocus onClick={() => setConfirmDelete(false)} className="btn btn-outline">{t.close}</button>
          <button type="button" onClick={remove} className="btn border-red-ink! bg-red-ink! text-white!">{t.delete}</button>
        </div>
      )}
      {/* Opened with the button next to Download PDF */}
      {sending && (
        <SendDocument id="offer-send" open onToggle={setSending} info={send} text={sendText} locale={locale}
          makePdf={async () => (await import("@/lib/calculator/pdf")).offerPdfBase64(form, result, settings)} />
      )}
      {reminder && (
        <SendDocument info={reminder} text={sendText} locale={locale} title={reminderTitle}
          makePdf={async () => (await import("@/lib/calculator/pdf")).offerPdfBase64(form, result, settings)} />
      )}
      <DocLangDialog open={asking} text={langText} onPick={pdf} onClose={() => setAsking(false)} />
      <Toast toast={toast} onClose={clear} closeLabel={t.close} />
    </div>
  );
}
