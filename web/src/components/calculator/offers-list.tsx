"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteOffer } from "@/app/calculator/actions";
import { fromOfferRecord } from "@/lib/calculator/offerRecord";
import { matchesQuery } from "@/lib/calculator/search";
import type { OfferRecord, Settings } from "@/lib/calculator/types";
import { fmt, formatDate, formatNumber, type Locale } from "@/lib/i18n";
import { Empty } from "@/components/ui";
import { CalcTextProvider, Toast, useCalcText, useToast, type CalcDict } from "./kit";
import { DocLangDialog, type DocLang, type DocLangText } from "@/components/doc-lang-dialog";

type Props = {
  t: CalcDict;
  locale: Locale;
  offers: OfferRecord[];
  settings: Settings;
  userId: string;
  isAdmin: boolean;
  /** The designer reads offers: open and download only (owner, Nov 2026). */
  readOnly?: boolean;
  /** Offers in an order that is not cancelled: fixed, no Delete */
  inOrder: string[];
  /** Download in BG / Download in EN, asked before every download. */
  langText: DocLangText;
};

/** Offers created in the calculator, listed under Offers: open the summary, edit in the calculator, download the PDF, delete. */
export function OffersList(props: Props) {
  return (
    <CalcTextProvider t={props.t} locale={props.locale}>
      <List {...props} />
    </CalcTextProvider>
  );
}

type Filter = "all" | "active" | "inOrder" | "expired";
type State = { kind: "inOrder" | "valid" | "expiring" | "expired" | "none"; date: string | null };

const GRID =
  "grid-cols-[minmax(0,1fr)_auto_44px] md:grid-cols-[120px_minmax(0,1.3fr)_minmax(0,1.2fr)_130px_44px] xl:grid-cols-[120px_minmax(0,1.3fr)_minmax(0,1.2fr)_200px_120px_44px]";
const TONE: Record<State["kind"], string> = {
  inOrder: "bg-green-tint text-green-ink", valid: "bg-neutral-tint text-ink", expiring: "bg-amber-tint text-amber-ink",
  expired: "bg-red-tint text-red-ink", none: "bg-neutral-tint text-ink-2",
};

/** Today as yyyy-mm-dd in Sofia. */
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date());

function List({ offers, settings, userId, isAdmin, inOrder, langText, readOnly = false }: Props) {
  const { t, locale, eur } = useCalcText();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [mine, setMine] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [asking, setAsking] = useState<OfferRecord | null>(null);
  const { toast, show, clear } = useToast();
  const o = t.offers;
  const day = today();
  const soon = new Date(Date.parse(day) + 3 * 86400000).toISOString().slice(0, 10);

  const stateOf = (x: OfferRecord): State => {
    if (inOrder.includes(x.id)) return { kind: "inOrder", date: null };
    const until = x.data.offer?.validUntil || null;
    if (!until) return { kind: "none", date: null };
    if (until < day) return { kind: "expired", date: until };
    return { kind: until <= soon ? "expiring" : "valid", date: until };
  };
  const inFilter = (x: OfferRecord, f: Filter) => {
    const k = stateOf(x).kind;
    return f === "all" || (f === "inOrder" ? k === "inOrder" : f === "expired" ? k === "expired" : k === "valid" || k === "expiring" || k === "none");
  };

  const searched = useMemo(
    () =>
      offers.filter((x) => (!mine || x.created_by === userId)
        && matchesQuery([x.offer_no, x.receiver_name, x.receiver_email, x.company_name, x.product_name, x.data?.catalog?.code].filter(Boolean).join(" "), query)),
    [offers, query, mine, userId],
  );
  const filtered = searched.filter((x) => inFilter(x, filter));

  const pdf = async (x: OfferRecord, lang: DocLang) => {
    setAsking(null);
    setBusyId(x.id);
    try {
      const { downloadOfferPdf } = await import("@/lib/calculator/pdf");
      const { form, result } = fromOfferRecord(x, settings);
      await downloadOfferPdf(form, result, settings, lang);
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

  const stateText = (s: State) =>
    s.kind === "inOrder" ? o.inOrder
      : s.kind === "none" ? "—"
        : fmt(s.kind === "expired" ? o.expired : s.kind === "expiring" ? o.expiring : o.validUntil, { date: formatDate(locale, s.date) });
  const item = "flex min-h-11 w-full items-center rounded-sm px-3 text-left text-sm text-ink no-underline hover:bg-mist";
  const close = (e: { currentTarget: Element }) => e.currentTarget.closest("details")?.removeAttribute("open");

  return (
    <section aria-label={o.title} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="offer-search" className="sr-only">{o.search}</label>
        <input id="offer-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={o.searchPlaceholder}
          className="input min-w-0 flex-[1_1_280px]" />
        {/* A phone: the filters as one drop-down next to Mine (owner, Nov 2026: fewer buttons on the phone) */}
        <label htmlFor="offer-filter" className="sr-only">{o.title}</label>
        <select id="offer-filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="input min-w-0 flex-[1_1_140px] sm:hidden">
          {(["all", "active", "inOrder", "expired"] as const).map((f) => <option key={f} value={f}>{o.filters[f]} {searched.filter((x) => inFilter(x, f)).length}</option>)}
        </select>
        <button type="button" aria-pressed={mine} onClick={() => setMine(!mine)}
          className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${mine ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink"}`}>
          {o.mine}
        </button>
      </div>
      <div role="group" aria-label={o.title} className="hidden flex-wrap gap-2 sm:flex">
        {(["all", "active", "inOrder", "expired"] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${filter === f ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink"}`}>
            {o.filters[f]} <span className={filter === f ? "text-white/80" : "text-ink-2"}>{searched.filter((x) => inFilter(x, f)).length}</span>
          </button>
        ))}
      </div>

      <div className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm ${GRID} border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2`}>
          <span>{o.offerNo}</span>
          <span>{o.client}</span>
          <span>{o.product}</span>
          <span className="hidden xl:block">{o.state}</span>
          <span className="text-right">{o.total}</span>
          <span />
        </div>
        {filtered.length === 0 && <div className="py-4"><Empty>{offers.length ? o.noMatch : o.empty}</Empty></div>}
        {filtered.map((x) => {
          const busy = busyId === x.id;
          const s = stateOf(x);
          const company = x.company_name || x.receiver_name;
          const person = x.company_name && x.receiver_name && x.receiver_name !== x.company_name ? x.receiver_name : null;
          const units = Number(x.data.numberOfUnits) || 0;
          const kind = x.product_type ? (t.productType as Record<string, string>)[x.product_type] : null;
          const canDelete = !readOnly && (isAdmin || x.created_by === userId) && !inOrder.includes(x.id);
          const menu = (
              <div className="absolute right-0 z-20 mt-1 flex w-60 max-w-[calc(100vw-48px)] flex-col rounded-sm border border-line bg-white p-1 shadow-lg" onClick={close}>
                <Link href={`/offers/calc/${x.id}`} className={item}>{o.open}</Link>
                {!readOnly && <Link href={`/calculator?open=${x.id}`} className={item}>{o.edit}</Link>}
                <button type="button" className={item} disabled={busy} onClick={() => setAsking(x)}>{t.results.downloadPdf}</button>
                {canDelete && <button type="button" className={`${item} text-red-ink`} onClick={() => setConfirmId(x.id)}>{t.delete}</button>}
              </div>
          );
          return (
            <div key={x.id} className="border-b border-mist py-3 text-sm last:border-0">
              <div className={`row ${GRID} items-center`}>
                <div className="min-w-0 md:contents">
                  <span className="flex flex-col">
                    <Link href={`/offers/calc/${x.id}`} className="font-semibold whitespace-nowrap text-ink">{x.offer_no}</Link>
                    <span className="text-xs text-ink-2">{formatDate(locale, x.data.offer?.offerDate || x.created_at)}</span>
                  </span>
                  <span className="block min-w-0 break-words">
                    <span className="font-semibold">{company}</span>
                    {person && <span className="block text-xs text-ink-2">{person}</span>}
                  </span>
                  <span className="block min-w-0 break-words">
                    {x.product_name || "–"}
                    {(kind || units > 0) && (
                      <span className="block text-xs text-ink-2">{[kind, units > 0 ? fmt(o.units, { n: formatNumber(locale, units) }) : null].filter(Boolean).join(" · ")}</span>
                    )}
                  </span>
                  <span className="mt-1 block md:hidden xl:block md:mt-0">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${TONE[s.kind]}`}>{stateText(s)}</span>
                  </span>
                </div>
                <span className="flex flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums">{eur(x.total_incl_vat || x.total_excl_vat)}</span>
                  <span className={`hidden rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap md:inline-flex xl:hidden ${TONE[s.kind]}`}>{stateText(s)}</span>
                </span>
                <details className="relative">
                  <summary aria-label={fmt(o.menu, { no: x.offer_no })}
                    className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-sm text-lg font-bold hover:bg-mist">{busy ? "…" : "⋯"}</summary>
                  {menu}
                </details>
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
      <DocLangDialog open={asking !== null} text={langText} onPick={(lang) => asking && pdf(asking, lang)} onClose={() => setAsking(null)} />
      <Toast toast={toast} onClose={clear} closeLabel={t.close} />
    </section>
  );
}
