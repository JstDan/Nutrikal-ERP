"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Wordmark } from "@/components/logo";
import { fmt, formatMoney, formatNumber, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";

type Tier = { min_qty: number; unit_price: number };
type Product = {
  code: string; name: string; name_bg: string | null; description: string | null; description_bg: string | null;
  category_id: string | null; extra_category_ids?: string[]; format: string | null; min_qty: number; image: string | null; pack: string | null; pack_bg: string | null;
  serving_size: number | null; serving_unit: string | null; servings_per_pack: number | null;
  tiers: Tier[]; ingredients: { name: string; name_bg: string | null; amount: number | string; unit: string | null }[]; claims: { en: string; bg: string | null }[];
};
export type PublicCatalog = { categories: { id: string; name: string; name_bg: string | null }[]; products: Product[] };
type Basket = Record<string, number>;

const OVERVIEW = 8;
const STEP = 100;
const STORE = "nk_catalog_basket";
const VIDEO = "WF61pORKbUo";
const COUNTRIES = ["AE", "AT", "AU", "BE", "BG", "CA", "CH", "CY", "CZ", "DE", "DK", "EE", "EG", "ES", "FI", "FR", "GB", "GR", "HR", "HU", "IE", "IL", "IT", "JO", "KW", "LB", "LT", "LU", "LV", "MD", "ME", "MK", "MT", "NL", "NO", "OM", "PL", "PT", "QA", "RO", "RS", "SA", "SE", "SI", "SK", "TR", "UA", "US"];
const priceAt = (p: Product, qty: number) => [...p.tiers].reverse().find((t) => t.min_qty <= qty)?.unit_price ?? p.tiers[0].unit_price;

const inCategory = (p: Product, id: string) => p.category_id === id || !!p.extra_category_ids?.includes(id);

function readBasket(): Basket {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** The company video: nothing goes to YouTube until the visitor presses play. */
export function CatalogVideo({ title }: { title: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-side">
      {playing ? (
        <iframe src={`https://www.youtube-nocookie.com/embed/${VIDEO}?autoplay=1&rel=0`} title={title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen className="absolute inset-0 h-full w-full border-0" />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} aria-label={title} className="group absolute inset-0 grid place-items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/catalog/site/video.webp" alt="" className="absolute inset-0 h-full w-full object-cover" />
          <span className="relative grid h-16 w-16 place-items-center rounded-full bg-[#fff] text-[#222831] shadow-lg transition-transform group-hover:scale-110">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </button>
      )}
    </div>
  );
}

/** A question without products: it arrives with the enquiries. */
export function CatalogContact({ text, locale }: { text: Dict["publicCatalog"]; locale: Locale }) {
  const T = text;
  const [form, setForm] = useState({ company: "", contact_name: "", email: "", message: "", website: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const started = useRef(0);
  useEffect(() => { started.current = Date.now(); }, []);
  const field = (k: keyof typeof form) => ({ value: form[k], onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value })) });

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      const r = await fetch("/api/catalog-enquiry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, locale, started_at: started.current, lines: [] }),
      });
      const out = await r.json();
      if (!r.ok) { setError(out.error === "busy" ? T.busy : out.error === "invalid" ? T.invalid : T.failed); return; }
      setDone(true);
    } catch {
      setError(T.failed);
    } finally {
      setSending(false);
    }
  }

  if (done) return <div role="status" className="flex flex-col gap-1 rounded-lg bg-paper p-5 text-ink"><p className="m-0 font-bold">{T.thanks}</p><p className="m-0 text-sm text-ink-2">{T.contactThanks}</p></div>;
  return (
    <form onSubmit={send} aria-label={T.contactFormTitle} className="flex min-w-0 flex-col gap-3 rounded-lg bg-paper p-5 text-ink">
      <h3 className="m-0 text-lg font-bold">{T.contactFormTitle}</h3>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="field min-w-0"><span>{T.company} *</span><input required maxLength={200} autoComplete="organization" className="input w-full min-w-0" {...field("company")} /></label>
        <label className="field min-w-0"><span>{T.contact} *</span><input required maxLength={200} autoComplete="name" className="input w-full min-w-0" {...field("contact_name")} /></label>
      </div>
      <label className="field"><span>{T.email} *</span><input type="email" required maxLength={254} autoComplete="email" className="input" {...field("email")} /></label>
      <label className="field"><span>{T.contactQuestion} *</span><textarea required rows={4} maxLength={2000} className="input" {...field("message")} /></label>
      <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-px w-px opacity-0" {...field("website")} />
      <p className="m-0 text-xs text-ink-2">{T.privacy}</p>
      {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
      <button type="submit" disabled={sending} className="btn btn-primary self-start">{sending ? "…" : T.contactSend}</button>
    </form>
  );
}

/** The product photo; a new product without one shows a blank pack. */
function Picture({ product, alt, size = "card" }: { product: Product; alt: string; size?: "card" | "detail" | "line" }) {
  const box = { card: "aspect-[193/232] w-full rounded-md object-cover", detail: "mx-auto h-64 w-auto rounded-md", line: "h-[72px] w-[60px] shrink-0 rounded-sm object-cover" }[size];
  const src = product.image ?? (product.format === "powder" ? "/catalog/site/blank-pouch.webp" : "/catalog/site/blank-bottle.webp");
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" width={640} height={769} className={box} />;
}
function Dialog({ title, close, closeLabel, footer, children }: { title: string; close: () => void; closeLabel: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#00000066]" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <aside role="dialog" aria-modal="true" aria-label={title} className="chat-drawer flex h-full w-full flex-col bg-paper text-ink shadow-2xl sm:w-[480px]">
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line px-4">
          <h2 className="m-0 min-w-0 flex-1 break-words text-base font-bold">{title}</h2>
          <button type="button" onClick={close} aria-label={closeLabel} className="grid h-11 w-11 shrink-0 place-items-center text-xl text-ink-2 hover:text-ink">×</button>
        </header>
        <div data-dialog-body className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</div>
        {footer && <footer className="flex shrink-0 flex-col gap-2 border-t border-line p-4">{footer}</footer>}
      </aside>
    </div>
  );
}

/** The open catalogue: browse, filter, a basket, and one enquiry in two steps. */
export function CatalogBrowser({ data, locale, text, formats, children }: {
  data: PublicCatalog; locale: Locale; text: Dict["publicCatalog"]; formats: Dict["enums"]["productFormat"]; children: ReactNode;
}) {
  const T = text;
  const money = (n: number) => formatMoney(locale, n, "EUR", 2);
  const local = (name: string, bg: string | null) => (locale === "bg" && bg ? bg : name);
  const [term, setTerm] = useState("");
  const [category, setCategory] = useState("");
  const [format, setFormat] = useState("");
  const [basket, setBasket] = useState<Basket>({});
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<Product | null>(null);
  const [showBasket, setShowBasket] = useState(false);
  const [step, setStep] = useState<"lines" | "details">("lines");
  const [form, setForm] = useState({ company: "", contact_name: "", email: "", phone: "", country_code: "", message: "", website: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const started = useRef(0);
  const productsTop = useRef<HTMLElement>(null);

  useEffect(() => {
    started.current = Date.now();
    const saved = readBasket();
    const known = Object.fromEntries(Object.entries(saved).filter(([c, q]) => data.products.some((p) => p.code === c && Number(q) >= p.min_qty)));
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

  const shownFormats = useMemo(() => [...new Set(data.products.map((p) => p.format).filter((f): f is string => !!f))], [data.products]);
  const countries = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    return COUNTRIES.map((c) => ({ code: c, name: names.of(c) ?? c })).sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [locale]);
  const find = term.trim().toLowerCase();
  const shown = data.products.filter((p) =>
    (!category || inCategory(p, category)) && (!format || p.format === format)
    && (!find || [p.code, p.name, p.name_bg, p.description, p.description_bg, ...p.ingredients.flatMap((i) => [i.name, i.name_bg])].some((x) => x?.toLowerCase().includes(find))));
  const overview = !category && !format && !find;
  const lines = data.products.filter((p) => basket[p.code]);
  const allValid = lines.every((p) => basket[p.code] >= p.min_qty);
  const total = lines.reduce((sum, p) => sum + priceAt(p, basket[p.code]) * basket[p.code], 0);

  const openBasket = () => { setSent(null); setError(""); setStep("lines"); setShowBasket(true); };
  // Adding opens the list, so the buyer sees it land and can set the quantity at once
  const add = (p: Product) => { setBasket((b) => ({ ...b, [p.code]: b[p.code] ?? p.min_qty })); setOpen(null); openBasket(); };
  const remove = (code: string) => setBasket((b) => Object.fromEntries(Object.entries(b).filter(([c]) => c !== code)));
  const setQty = (code: string, qty: number) => setBasket((b) => ({ ...b, [code]: Math.max(Math.floor(qty) || 0, 0) }));
  const field = (k: keyof typeof form) => ({ value: form[k], onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value })) });
  const pick = (id: string) => { setCategory(id); productsTop.current?.scrollIntoView(); };

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!allValid) { setError(T.belowMinimum); setStep("lines"); return; }
    setSending(true);
    setError("");
    try {
      const r = await fetch("/api/catalog-enquiry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, locale, started_at: started.current, lines: lines.map((p) => ({ code: p.code, quantity: basket[p.code] })) }),
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

  const chip = (active: boolean) => `min-h-10 rounded-full border px-3.5 text-[13px] ${active ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-paper text-ink hover:bg-canvas"}`;
  const card = (p: Product) => (
    <article key={p.code} className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-paper p-2.5 sm:p-3">
      <button type="button" onClick={() => setOpen(p)} aria-label={fmt(T.detailsOf, { name: local(p.name, p.name_bg) })} className="flex min-w-0 flex-col gap-2 text-left">
        <Picture product={p} alt={local(p.name, p.name_bg)} />
        <span className="min-w-0 text-[11px] text-ink-2">{[p.format && formats[p.format as "capsule"], p.code].filter(Boolean).join(" · ")}</span>
        <span className="line-clamp-2 min-h-10 min-w-0 break-words text-sm leading-5 font-bold">{local(p.name, p.name_bg)}</span>
      </button>
      <p className="m-0 mt-auto text-sm">{fmt(T.fromPrice, { price: money(p.tiers.at(-1)!.unit_price) })}</p>
      <button type="button" onClick={() => add(p)} className="btn btn-primary w-full !px-2">{basket[p.code] ? T.inBasket : T.add}</button>
      <button type="button" onClick={() => setOpen(p)} className="btn btn-outline w-full !px-2">{T.learnMore}</button>
    </article>
  );
  const grid = "grid min-w-0 grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4";

  return (
    <div className={`min-h-dvh bg-canvas text-ink ${lines.length ? "pb-20 lg:pb-0" : ""}`}>
      <header className="sticky top-0 z-30 border-b border-line bg-paper">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-4 py-2.5">
          <Wordmark height={16} className="min-w-0 shrink !self-center" />
          <nav aria-label={T.title} className="hide-md flex items-center gap-6 text-sm">
            <a href="#products" className="text-ink no-underline">{T.navProducts}</a>
            <a href="#about" className="text-ink no-underline">{T.navAbout}</a>
            <a href="#certificates" className="text-ink no-underline">{T.navCertificates}</a>
            <a href="#contact" className="text-ink no-underline">{T.navContact}</a>
          </nav>
          <div className="flex shrink-0 items-center gap-1">
            <a href={`?lang=${locale === "bg" ? "en" : "bg"}`} className="grid h-11 w-11 place-items-center text-xs font-semibold tracking-[1px] text-ink no-underline">{locale === "bg" ? "EN" : "БГ"}</a>
            <button type="button" onClick={openBasket} className="btn btn-primary !px-3 sm:!px-5">{fmt(T.basketCount, { n: lines.length })}</button>
          </div>
        </div>
      </header>

      <main ref={productsTop} id="products" className="mx-auto flex max-w-[1200px] scroll-mt-16 flex-col gap-5 px-4 py-8">
        <div className="flex max-w-[720px] flex-col gap-2">
          <h1 className="m-0 text-3xl font-bold">{T.title}</h1>
          <p className="m-0 text-ink-2">{T.intro}</p>
        </div>
        <dl className="m-0 grid min-w-0 grid-cols-1 gap-x-8 gap-y-3 border-y border-line py-4 sm:grid-cols-2 lg:grid-cols-4">
          {T.facts.map((f) => (
            <div key={f.label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-xs text-ink-2">{f.label}</dt>
              <dd className="m-0 text-sm font-semibold">{f.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <label htmlFor="catalog-search" className="sr-only">{T.search}</label>
            <input id="catalog-search" type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={T.search} className="input w-full min-w-0 sm:flex-1" />
            <label className="min-w-0 sm:w-48">
              <span className="sr-only">{T.formats}</span>
              <select value={format} onChange={(e) => setFormat(e.target.value)} className="input w-full min-w-0">
                <option value="">{T.allFormats}</option>
                {shownFormats.map((f) => <option key={f} value={f}>{formats[f as "capsule"]}</option>)}
              </select>
            </label>
            <label className="min-w-0 md:hidden">
              <span className="sr-only">{T.categories}</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="input w-full min-w-0">
                <option value="">{T.allCategories}</option>
                {data.categories.map((c) => <option key={c.id} value={c.id}>{local(c.name, c.name_bg)}</option>)}
              </select>
            </label>
          </div>
          <div role="group" aria-label={T.categories} className="hide-sm flex flex-wrap gap-2">
            <button type="button" aria-pressed={!category} onClick={() => setCategory("")} className={chip(!category)}>{T.all}</button>
            {data.categories.map((c) => <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)} className={chip(category === c.id)}>{local(c.name, c.name_bg)}</button>)}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-8">
            {data.products.length === 0 && <p className="m-0 text-ink-2">{T.empty}</p>}
            {overview ? data.categories.map((c) => {
              const items = shown.filter((p) => inCategory(p, c.id));
              return (
                <section key={c.id} aria-label={local(c.name, c.name_bg)} className="flex min-w-0 flex-col gap-3">
                  <h3 className="m-0 text-lg font-bold">{local(c.name, c.name_bg)}</h3>
                  <div className={grid}>{items.slice(0, OVERVIEW).map(card)}</div>
                  {items.length > OVERVIEW && <button type="button" onClick={() => pick(c.id)} className="btn btn-outline self-start">{fmt(T.seeAll, { n: items.length })}</button>}
                </section>
              );
            }) : (
              <section aria-label={T.navProducts} className="flex min-w-0 flex-col gap-3">
                {category && <h3 className="m-0 text-lg font-bold">{local(data.categories.find((c) => c.id === category)?.name ?? "", data.categories.find((c) => c.id === category)?.name_bg ?? null)}</h3>}
                <p role="status" className="m-0 text-sm text-ink-2">{shown.length ? fmt(T.results, { n: shown.length }) : T.noResults}</p>
                <div className={grid}>{shown.map(card)}</div>
              </section>
            )}
            <p className="m-0 text-sm text-ink-2">{T.priceNote}</p>
        </div>
      </main>

      {children}

      {lines.length > 0 && !showBasket && !open && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper p-3 lg:hidden">
          <button type="button" onClick={openBasket} className="btn btn-primary w-full">{fmt(T.basketBar, { n: lines.length })}</button>
        </div>
      )}

      {open && (
        <Dialog title={local(open.name, open.name_bg)} close={() => setOpen(null)} closeLabel={T.close} footer={
          <button type="button" onClick={() => add(open)} className="btn btn-primary w-full">{basket[open.code] ? T.inBasket : T.add}</button>
        }>
          <Picture size="detail" product={open} alt={local(open.name, open.name_bg)} />
          <p className="m-0 text-sm text-ink-2">
            {[open.format && formats[open.format as "capsule"], open.code,
              (locale === "bg" ? open.pack_bg ?? open.pack : open.pack)
                ?? (open.servings_per_pack ? fmt(T.pack, { size: formatNumber(locale, open.serving_size), unit: T.units[open.serving_unit as "pcs"], servings: open.servings_per_pack }) : null),
            ].filter(Boolean).join(" · ")}
          </p>
          <section className="flex flex-col gap-2">
            <h3 className="label m-0">{T.prices}</h3>
            <div className={`grid gap-2 ${open.tiers.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {open.tiers.map((t) => (
                <div key={t.min_qty} className="flex flex-col rounded-md bg-green-tint px-3 py-2">
                  <span className="text-xs text-ink-2">{fmt(T.fromQty, { n: formatNumber(locale, t.min_qty) })}</span>
                  <span className="font-bold">{money(t.unit_price)}</span>
                </div>
              ))}
            </div>
          </section>
          {(locale === "bg" ? open.description_bg ?? open.description : open.description) && (
            <p className="m-0 whitespace-pre-wrap break-words text-sm">{locale === "bg" ? open.description_bg ?? open.description : open.description}</p>
          )}
          {open.ingredients.length > 0 && (
            <section className="flex flex-col gap-1">
              <h3 className="label m-0">{T.composition}</h3>
              {open.ingredients.map((i, n) => (
                <div key={n} className="row grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-mist py-2 text-sm last:border-0">
                  <span className="min-w-0 break-words">{local(i.name, i.name_bg)}</span>
                  <span>{typeof i.amount === "number" ? `${formatNumber(locale, i.amount, 3)} ${i.unit}` : i.amount}</span>
                </div>
              ))}
            </section>
          )}
          {open.claims.some((c) => (locale === "bg" ? c.bg : c.en)) && (
            <section className="flex flex-col gap-1">
              <h3 className="label m-0">{T.claims}</h3>
              {open.claims.map((c, n) => (locale === "bg" ? c.bg : c.en) && <p key={n} className="m-0 text-sm">{locale === "bg" ? c.bg : c.en}</p>)}
            </section>
          )}
        </Dialog>
      )}

      {showBasket && (
        <Dialog title={sent !== null ? T.thanks : step === "lines" ? T.basket : T.yourDetails} close={() => setShowBasket(false)} closeLabel={T.close} footer={
          sent !== null ? undefined : step === "lines" ? lines.length > 0 && (
            <>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink-2">{T.approxTotal}</span>
                <span className="text-lg font-bold">{allValid ? money(total) : "—"}</span>
              </div>
              {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
              <button type="button" disabled={!allValid} onClick={() => { setError(""); setStep("details"); }} className="btn btn-primary w-full">{T.continue}</button>
            </>
          ) : (
            <>
              {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
              <button type="submit" form="enquiry-form" disabled={sending} className="btn btn-primary w-full">{sending ? "…" : T.send}</button>
            </>
          )
        }>
          {sent !== null ? (
            <div role="status" className="flex flex-col gap-2">
              <p className="m-0 text-sm text-ink-2">{sent ? fmt(T.thanksNote, { no: sent }) : T.thanksPlain}</p>
              <button type="button" onClick={() => setShowBasket(false)} className="btn btn-outline self-start">{T.keepBrowsing}</button>
            </div>
          ) : lines.length === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="m-0 text-ink-2">{T.basketEmpty}</p>
              <button type="button" onClick={() => setShowBasket(false)} className="btn btn-outline self-start">{T.keepBrowsing}</button>
            </div>
          ) : step === "lines" ? (
            <>
              <p className="m-0 text-sm text-ink-2">{T.basketIntro}</p>
              {lines.map((p) => {
                const qty = basket[p.code];
                const next = p.tiers.find((t) => t.min_qty > qty);
                return (
                  <div key={p.code} className="flex min-w-0 flex-col gap-2 border-b border-mist pb-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <Picture size="line" product={p} alt={local(p.name, p.name_bg)} />
                      <span className="flex min-w-0 flex-1 flex-col pt-1">
                        <span className="break-words text-sm font-semibold">{local(p.name, p.name_bg)}</span>
                        <span className="text-xs text-ink-2">{p.code}</span>
                      </span>
                      <button type="button" onClick={() => remove(p.code)} aria-label={fmt(T.remove, { name: local(p.name, p.name_bg) })} className="grid h-11 w-11 shrink-0 place-items-center text-lg text-ink-2 hover:text-ink">×</button>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center">
                        <button type="button" onClick={() => setQty(p.code, Math.max(qty - STEP, p.min_qty))} aria-label={T.less} className="grid h-11 w-11 place-items-center rounded-l-sm border border-line-strong text-lg">−</button>
                        <label>
                          <span className="sr-only">{T.quantity}</span>
                          <input type="number" min={p.min_qty} step={STEP} inputMode="numeric" value={qty || ""} onChange={(e) => setQty(p.code, Number(e.target.value))} className="h-11 w-24 border-y border-line-strong bg-paper text-center text-sm" />
                        </label>
                        <button type="button" onClick={() => setQty(p.code, qty + STEP)} aria-label={T.more} className="grid h-11 w-11 place-items-center rounded-r-sm border border-line-strong text-lg">+</button>
                      </div>
                      <span className={`text-sm font-semibold ${qty >= p.min_qty ? "" : "text-red-ink"}`}>
                        {qty >= p.min_qty ? fmt(T.each, { price: money(priceAt(p, qty)) }) : fmt(T.minimum, { n: formatNumber(locale, p.min_qty) })}
                      </span>
                    </div>
                    {qty >= p.min_qty && next && <p className="m-0 text-xs text-ink-2">{fmt(T.nextTier, { n: formatNumber(locale, next.min_qty), price: money(next.unit_price) })}</p>}
                  </div>
                );
              })}
              <p className="m-0 text-xs text-ink-2">{T.priceNote}</p>
            </>
          ) : (
            <form id="enquiry-form" onSubmit={send} className="flex flex-col gap-3">
              <button type="button" onClick={() => setStep("lines")} className="flex min-h-11 items-center self-start text-sm text-ink-2">← {fmt(T.backToBasket, { n: lines.length })}</button>
              <label className="field"><span>{T.company} *</span><input required maxLength={200} autoComplete="organization" className="input" {...field("company")} /></label>
              <label className="field"><span>{T.contact} *</span><input required maxLength={200} autoComplete="name" className="input" {...field("contact_name")} /></label>
              <label className="field"><span>{T.email} *</span><input type="email" required maxLength={254} autoComplete="email" className="input" {...field("email")} /></label>
              <div className="grid min-w-0 grid-cols-2 gap-3">
                <label className="field min-w-0"><span>{T.phone}</span><input type="tel" maxLength={50} autoComplete="tel" className="input w-full min-w-0" {...field("phone")} /></label>
                <label className="field min-w-0"><span>{T.country}</span>
                  <select className="input w-full min-w-0" {...field("country_code")}>
                    <option value="">—</option>
                    {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                </label>
              </div>
              <label className="field"><span>{T.message}</span><textarea rows={3} maxLength={2000} placeholder={T.messageHint} className="input" {...field("message")} /></label>
              {/* Stays empty for people: hidden from sight and from the keyboard */}
              <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-px w-px opacity-0" {...field("website")} />
              <p className="m-0 text-xs text-ink-2">{T.privacy}</p>
            </form>
          )}
        </Dialog>
      )}
    </div>
  );
}
