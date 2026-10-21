"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { matchesQuery } from "@/lib/calculator/search";
import type { OfferRecord } from "@/lib/calculator/types";
import { formatDate, type Locale } from "@/lib/i18n";
import { Empty } from "@/components/ui";
import { CalcTextProvider, useCalcText, type CalcDict } from "./kit";

type Props = {
  t: CalcDict;
  locale: Locale;
  offers: OfferRecord[];
};

/** Offers created in the calculator, listed under Offers; each opens its summary (PDF, edit, copy, delete). */
export function OffersList(props: Props) {
  return (
    <CalcTextProvider t={props.t} locale={props.locale}>
      <List {...props} />
    </CalcTextProvider>
  );
}

const GRID =
  "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[130px_minmax(0,1.4fr)_minmax(0,1fr)_120px] lg:grid-cols-[130px_110px_minmax(0,1.4fr)_minmax(0,1fr)_120px]";

function List({ offers }: Props) {
  const { t, locale, eur } = useCalcText();
  const [query, setQuery] = useState("");
  const o = t.offers;

  const filtered = useMemo(
    () =>
      offers.filter((x) =>
        matchesQuery([x.offer_no, x.receiver_name, x.receiver_email, x.company_name, x.product_name].filter(Boolean).join(" "), query),
      ),
    [offers, query],
  );

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
        {filtered.map((x) => (
          <div key={x.id} className={`row ${GRID} border-b border-mist py-3.5 text-sm last:border-0`}>
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
        ))}
      </div>
    </section>
  );
}
