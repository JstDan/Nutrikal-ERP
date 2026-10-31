"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Wordmark } from "@/components/logo";
import { fmt, formatMoney, formatNumber, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";

type Tier = { min_qty: number; unit_price: number };
type Product = {
  code: string; name: string; name_bg: string | null; description: string | null; description_bg: string | null;
  category_id: string | null; format: string; serving_size: number; serving_unit: string; servings_per_pack: number | null;
  tiers: Tier[]; ingredients: { name: string; name_bg: string | null; amount: number; unit: string }[]; claims: { en: string; bg: string | null }[];
};
export type PublicCatalog = { categories: { id: string; name: string; name_bg: string | null }[]; products: Product[] };
type Basket = Record<string, number>;

const MIN_QTY = 500;
const STORE = "nk_catalog_basket";
const priceAt = (p: Product, qty: number) => [...p.tiers].reverse().find((t) => t.min_qty <= qty)?.unit_price ?? p.tiers[0].unit_price;

function readBasket(): Basket {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** A plain picture by format, until the products have photos. */
function FormatPicture({ format }: { format: string }) {
  const pill = ["capsule", "softgel", "tablet"].includes(format);
  return (
    <div aria-hidden="true" className="grid h-32 place-items-center rounded-sm bg-neutral-tint text-ink-2">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {pill
          ? <><path d="M10.5 20.5a4.950 4.950 0 0 1-7-7l10-10a4.950 4.950 0 0 1 7 7z" /><path d="m8.500 8.500 7 7" /></>
          : <><path d="M8 3h8v3H8z" /><path d="M7 6h10a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" /><path d="M6 11h12M6 16h12" /></>}
      </svg>
    </div>
  );
}

function Dialog({ title, close, closeLabel, children }: { title: string; close: () => void; closeLabel: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#00000066]" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <aside role="dialog" aria-modal="true" aria-label={title} className="chat-drawer flex h-full w-full flex-col bg-paper text-ink shadow-2xl sm:w-[480px]">
        <header className="flex min-h-14 items-center gap-2 border-b border-line px-4">
          <h2 className="m-0 min-w-0 flex-1 break-words text-base font-bold">{title}</h2>
          <button type="button" onClick={close} aria-label={closeLabel} className="grid h-11 w-11 shrink-0 place-items-center text-xl text-ink-2 hover:text-ink">×</button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>
  );
}

/** The open catalogue on one page: browse, filter, a basket and one enquiry. */
export function CatalogBrowser({ data, locale, text, formats }: { data: PublicCatalog; locale: Locale; text: Dict["publicCatalog"]; formats: Dict["enums"]["productFormat"] }) {
  const T = text;
  const money = (n: number) => formatMoney(locale, n, "EUR", 2);
  const local = (name: string, bg: string | null) => (locale === "bg" && bg ? bg : name);
  const [term, setTerm] = useState("");
  const [category, setCategory] = useState("");
  const [format, setFormat] = useState("");
  const [basket, setBasket] = useState<Basket>({});
  const [open, setOpen] = useState<Product | null>(null);
  const [showBasket, setShowBasket] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const started = useRef(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    started.current = Date.now();
    const saved = readBasket();
    const known = Object.fromEntries(Object.entries(saved).filter(([c, q]) => data.products.some((p) => p.code === c) && Number(q) >= MIN_QTY));
    // Read after the first paint: the server does not know the basket
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBasket(known);
    setLoaded(true);
    const code = new URLSearchParams(location.search).get("p");
    if (code) setOpen(data.products.find((p) => p.code === code) ?? null);
  }, [data.products]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(STORE, JSON.stringify(basket)); } catch { /* the basket then lasts until the page closes */ }
  }, [basket, loaded]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(null); setShowBasket(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shownFormats = useMemo(() => [...new Set(data.products.map((p) => p.format))], [data.products]);
  const find = term.trim().toLowerCase();
  const shown = data.products.filter((p) =>
    (!category || p.category_id === category) && (!format || p.format === format)
    && (!find || [p.name, p.name_bg, p.description, p.description_bg, ...p.ingredients.flatMap((i) => [i.name, i.name_bg])].some((x) => x?.toLowerCase().includes(find))));
  const lines = data.products.filter((p) => basket[p.code]);
  const total = lines.reduce((sum, p) => sum + priceAt(p, basket[p.code]) * basket[p.code], 0);

  const add = (p: Product) => setBasket((b) => ({ ...b, [p.code]: b[p.code] ?? MIN_QTY }));
  const remove = (code: string) => setBasket((b) => Object.fromEntries(Object.entries(b).filter(([c]) => c !== code)));
  const setQty = (code: string, qty: number) => setBasket((b) => ({ ...b, [code]: Math.max(Math.floor(qty) || 0, 0) }));

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lines.some((p) => basket[p.code] < MIN_QTY)) { setError(fmt(T.belowMinimum, { n: MIN_QTY })); return; }
    const fd = new FormData(e.currentTarget);
    setSending(true);
    setError("");
    try {
      const r = await fetch("/api/catalog-enquiry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(fd), locale, started_at: started.current, lines: lines.map((p) => ({ code: p.code, quantity: basket[p.code] })) }),
      });
      const out = await r.json();
      if (!r.ok) { setError(out.error === "busy" ? T.busy : out.error === "invalid" ? T.invalid : T.failed); return; }
      setSent(out.number ?? "");
      setBasket({});
    } catch {
      setError(T.failed);
    } finally {
      setSending(false);
    }
  }

  const chip = (active: boolean) => `min-h-11 rounded-full border px-4 text-sm ${active ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-white text-ink hover:bg-canvas"}`;

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-paper">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Wordmark height={20} className="self-center" />
          <div className="flex items-center gap-2">
            <a href={`?lang=${locale === "bg" ? "en" : "bg"}`} className="grid h-11 place-items-center px-2 text-xs font-semibold tracking-[1px] text-ink no-underline">{locale === "bg" ? "EN" : "БГ"}</a>
            <button type="button" onClick={() => { setSent(null); setError(""); setShowBasket(true); }} className="btn btn-primary">
              {fmt(T.basketCount, { n: lines.length })}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-8">
        <div className="flex max-w-[720px] flex-col gap-2">
          <h1 className="m-0 text-3xl font-bold">{T.title}</h1>
          <p className="m-0 text-ink-2">{fmt(T.intro, { n: formatNumber(locale, MIN_QTY) })}</p>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <label htmlFor="catalog-search" className="sr-only">{T.search}</label>
          <input id="catalog-search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={T.search} className="input max-w-[480px]" />
          <div role="group" aria-label={T.categories} className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={!category} onClick={() => setCategory("")} className={chip(!category)}>{T.all}</button>
            {data.categories.map((c) => <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)} className={chip(category === c.id)}>{local(c.name, c.name_bg)}</button>)}
          </div>
          {shownFormats.length > 1 && (
            <div role="group" aria-label={T.formats} className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={!format} onClick={() => setFormat("")} className={chip(!format)}>{T.allFormats}</button>
              {shownFormats.map((f) => <button key={f} type="button" aria-pressed={format === f} onClick={() => setFormat(f)} className={chip(format === f)}>{formats[f as "capsule"]}</button>)}
            </div>
          )}
        </div>

        {shown.length === 0 && <p className="m-0 text-ink-2">{data.products.length ? T.noResults : T.empty}</p>}
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <article key={p.code} className="card flex min-w-0 flex-col gap-3 p-4">
              <FormatPicture format={p.format} />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-xs text-ink-2">{formats[p.format as "capsule"]} · {p.code}</span>
                <h2 className="m-0 break-words text-base font-bold">{local(p.name, p.name_bg)}</h2>
              </div>
              <p className="m-0 mt-auto text-sm">{fmt(T.fromPrice, { price: money(p.tiers.at(-1)!.unit_price) })}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setOpen(p)} className="btn btn-outline flex-1">{T.details}</button>
                <button type="button" onClick={() => add(p)} disabled={!!basket[p.code]} className="btn btn-primary flex-1">{basket[p.code] ? T.inBasket : T.add}</button>
              </div>
            </article>
          ))}
        </div>
        <p className="m-0 text-sm text-ink-2">{T.priceNote}</p>
      </main>

      {open && (
        <Dialog title={local(open.name, open.name_bg)} close={() => setOpen(null)} closeLabel={T.close}>
          <p className="m-0 text-sm text-ink-2">
            {formats[open.format as "capsule"]} · {open.code}
            {open.servings_per_pack ? ` · ${fmt(T.pack, { size: formatNumber(locale, open.serving_size), unit: T.units[open.serving_unit as "pcs"], servings: open.servings_per_pack })}` : ""}
          </p>
          {(locale === "bg" ? open.description_bg ?? open.description : open.description) && (
            <p className="m-0 whitespace-pre-wrap break-words text-sm">{locale === "bg" ? open.description_bg ?? open.description : open.description}</p>
          )}
          <section className="flex flex-col gap-1">
            <h3 className="label m-0">{T.composition}</h3>
            {open.ingredients.map((i, n) => (
              <div key={n} className="row grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-mist py-2 text-sm last:border-0">
                <span className="min-w-0 break-words">{local(i.name, i.name_bg)}</span>
                <span>{formatNumber(locale, i.amount, 3)} {i.unit}</span>
              </div>
            ))}
          </section>
          {open.claims.some((c) => (locale === "bg" ? c.bg : c.en)) && (
            <section className="flex flex-col gap-1">
              <h3 className="label m-0">{T.claims}</h3>
              {open.claims.map((c, n) => (locale === "bg" ? c.bg : c.en) && <p key={n} className="m-0 text-sm">{locale === "bg" ? c.bg : c.en}</p>)}
            </section>
          )}
          <section className="flex flex-col gap-1">
            <h3 className="label m-0">{T.prices}</h3>
            {open.tiers.map((t) => (
              <div key={t.min_qty} className="row grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-mist py-2 text-sm last:border-0">
                <span>{fmt(T.fromQty, { n: formatNumber(locale, t.min_qty) })}</span>
                <span className="font-semibold">{money(t.unit_price)}</span>
              </div>
            ))}
          </section>
          <button type="button" onClick={() => { add(open); setOpen(null); }} disabled={!!basket[open.code]} className="btn btn-primary">{basket[open.code] ? T.inBasket : T.add}</button>
        </Dialog>
      )}

      {showBasket && (
        <Dialog title={T.basket} close={() => setShowBasket(false)} closeLabel={T.close}>
          {sent !== null ? (
            <div role="status" className="flex flex-col gap-2">
              <p className="m-0 text-lg font-bold">{T.thanks}</p>
              <p className="m-0 text-sm text-ink-2">{sent ? fmt(T.thanksNote, { no: sent }) : T.thanksPlain}</p>
            </div>
          ) : lines.length === 0 ? <p className="m-0 text-ink-2">{T.basketEmpty}</p> : (
            <>
              {lines.map((p) => (
                <div key={p.code} className="flex min-w-0 flex-col gap-2 border-b border-mist pb-3">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <span className="min-w-0 break-words text-sm font-semibold">{local(p.name, p.name_bg)}</span>
                    <button type="button" onClick={() => remove(p.code)} aria-label={fmt(T.remove, { name: local(p.name, p.name_bg) })} className="grid h-11 w-11 shrink-0 place-items-center text-lg text-ink-2 hover:text-ink">×</button>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-3 text-sm">
                    <label className="flex items-center gap-2">
                      <span>{T.quantity}</span>
                      <input type="number" min={MIN_QTY} step={100} inputMode="numeric" value={basket[p.code] || ""} onChange={(e) => setQty(p.code, Number(e.target.value))} className="input w-28" />
                    </label>
                    <span>{basket[p.code] >= MIN_QTY ? fmt(T.each, { price: money(priceAt(p, basket[p.code])) }) : fmt(T.minimum, { n: formatNumber(locale, MIN_QTY) })}</span>
                  </div>
                </div>
              ))}
              {lines.every((p) => basket[p.code] >= MIN_QTY) && <p className="m-0 text-sm font-semibold">{fmt(T.total, { total: money(total) })}</p>}
              <p className="m-0 text-xs text-ink-2">{T.priceNote}</p>
              <form onSubmit={send} className="flex flex-col gap-3">
                <label className="field"><span>{T.company} *</span><input name="company" required maxLength={200} autoComplete="organization" className="input" /></label>
                <label className="field"><span>{T.contact} *</span><input name="contact_name" required maxLength={200} autoComplete="name" className="input" /></label>
                <label className="field"><span>{T.email} *</span><input name="email" type="email" required maxLength={254} autoComplete="email" className="input" /></label>
                <label className="field"><span>{T.phone}</span><input name="phone" type="tel" maxLength={50} autoComplete="tel" className="input" /></label>
                <label className="field"><span>{T.country}</span><input name="country_code" maxLength={2} placeholder="BG" className="input" /></label>
                <label className="field"><span>{T.message}</span><textarea name="message" rows={3} maxLength={2000} className="input" /></label>
                {/* Stays empty for people: hidden from sight and from the keyboard */}
                <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-px w-px opacity-0" />
                <p className="m-0 text-xs text-ink-2">{T.privacy}</p>
                {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
                <button type="submit" disabled={sending} className="btn btn-primary">{sending ? "…" : T.send}</button>
              </form>
            </>
          )}
        </Dialog>
      )}
    </div>
  );
}
