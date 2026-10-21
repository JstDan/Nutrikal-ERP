"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteOffer } from "@/app/calculator/actions";
import { fromOfferRecord } from "@/lib/calculator/offerRecord";
import { matchesQuery } from "@/lib/calculator/search";
import type { OfferRecord, Settings } from "@/lib/calculator/types";
import { fmt, formatDate, type Locale } from "@/lib/i18n";
import { Empty } from "@/components/ui";
import { CalcTextProvider, Toast, useCalcText, useToast, type CalcDict } from "./kit";

type Props = {
  t: CalcDict;
  locale: Locale;
  offers: OfferRecord[];
  settings: Settings;
  userId: string;
  isAdmin: boolean;
};

/** Offers created in the calculator, listed under Offers: open the summary, edit in the calculator, download the PDF, delete. */
export function OffersList(props: Props) {
  return (
    <CalcTextProvider t={props.t} locale={props.locale}>
      <List {...props} />
    </CalcTextProvider>
  );
}

const GRID =
  "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[130px_minmax(0,1.4fr)_minmax(0,1fr)_120px] lg:grid-cols-[130px_110px_minmax(0,1.4fr)_minmax(0,1fr)_120px]";

function List({ offers, settings, userId, isAdmin }: Props) {
  const { t, locale, eur } = useCalcText();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const { toast, show, clear } = useToast();
  const o = t.offers;

  const filtered = useMemo(
    () =>
      offers.filter((x) =>
        matchesQuery([x.offer_no, x.receiver_name, x.receiver_email, x.company_name, x.product_name].filter(Boolean).join(" "), query),
      ),
    [offers, query],
  );

  const pdf = async (x: OfferRecord) => {
    setBusyId(x.id);
    try {
      const { downloadOfferPdf } = await import("@/lib/calculator/pdf");
      const { form, result } = fromOfferRecord(x, settings);
      await downloadOfferPdf(form, result, settings);
    } catch (e) {
      show("error", `${t.results.pdfFailed}: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (x: OfferRecord) => {
    setConfirmId(null);
    setBusyId(x.id);
    const res = await deleteOffer(x.id);
    setBusyId(null);
    if (!res.ok) return show("error", res.error);
    show("success", fmt(o.deleted, { no: x.offer_no }));
    router.refresh();
  };

  return (
    <section aria-labelledby="calc-offers-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="calc-offers-title" className="m-0 text-lg font-bold">{o.title}</h2>
        <p className="m-0 text-sm text-ink-2">{o.subtitle}</p>
      </div>
      <div className="flex max-w-[560px] flex-col gap-1.5">
        <label htmlFor="offer-search" className="sr-only">{o.search}</label>
        <input id="offer-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={o.searchPlaceholder} className="input" />
      </div>

      <div className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm ${GRID} border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2`}>
          <span>{o.offerNo}</span>
          <span className="hide-md">{o.date}</span>
          <span>{o.client}</span>
          <span>{o.product}</span>
          <span className="text-right">{o.total}</span>
        </div>
        {filtered.length === 0 && <div className="py-4"><Empty>{offers.length ? o.noMatch : o.empty}</Empty></div>}
        {filtered.map((x) => {
          const busy = busyId === x.id;
          const small = "btn btn-outline px-3!";
          return (
            <div key={x.id} className="border-b border-mist py-3.5 text-sm last:border-0">
              <div className={`row ${GRID}`}>
                <div className="min-w-0 md:contents">
                  <Link href={`/offers/calc/${x.id}`} className="font-semibold text-ink">{x.offer_no}</Link>
                  <span className="hide-md">{formatDate(locale, x.data.offer?.offerDate || x.created_at)}</span>
                  <span className="block min-w-0 break-words md:inline">
                    {x.receiver_name}
                    {x.company_name && <span className="block text-xs text-ink-2">{x.company_name}</span>}
                  </span>
                  <span className="block min-w-0 break-words text-ink-2 md:inline md:text-ink">{x.product_name || "–"}</span>
                </div>
                <span className="text-right font-semibold tabular-nums">{eur(x.total_incl_vat || x.total_excl_vat)}</span>
              </div>
              <div role="group" aria-label={`${o.actions} ${x.offer_no}`} className="mt-3 flex flex-wrap gap-2">
                <Link href={`/calculator?open=${x.id}`} className={small} aria-label={`${o.edit} ${x.offer_no}`}>{o.edit}</Link>
                <button type="button" onClick={() => pdf(x)} disabled={busy} className={small} aria-label={`${t.results.downloadPdf} ${x.offer_no}`}>
                  {busy ? "…" : t.results.downloadPdf}
                </button>
                {(isAdmin || x.created_by === userId) && (
                  <button type="button" onClick={() => setConfirmId(x.id)} disabled={busy} aria-expanded={confirmId === x.id} className={`${small} text-red-ink!`} aria-label={`${t.delete} ${x.offer_no}`}>
                    {t.delete}
                  </button>
                )}
              </div>
              {confirmId === x.id && (
                <div role="alertdialog" aria-label={fmt(o.deleteConfirm, { no: x.offer_no })} className="mt-3 flex flex-wrap items-center gap-3 rounded-sm border border-red-line bg-red-tint px-4 py-3">
                  <span className="min-w-0 flex-[1_1_220px] font-semibold text-red-ink">{fmt(o.deleteConfirm, { no: x.offer_no })}</span>
                  <button type="button" autoFocus onClick={() => setConfirmId(null)} className="btn btn-outline">{t.close}</button>
                  <button type="button" onClick={() => remove(x)} className="btn border-red-ink! bg-red-ink! text-white!">{t.delete}</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Toast toast={toast} onClose={clear} closeLabel={t.close} />
    </section>
  );
}
