import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt, formatDate, formatNumber, formatPrice, getDict } from "@/lib/i18n";
import { PrintButton } from "@/components/print-button";
import { DocHeader } from "@/components/sales-document";

type Doc = {
  code: string; locale: "bg" | "en"; currency: string; incoterm: string; valid_until: string | null; created_at: string;
  sent_at: string | null; deposit_pct: string | null; balance_terms: "before_dispatch" | "net_days" | null;
  balance_net_days: number | null; notes: string | null; version_id: string;
  client: string; client_vat: string | null; client_address: string | null; client_city: string | null;
  client_postal: string | null; client_country: string;
  product: string; product_bg: string | null; product_format: string; serving_size: string;
  serving_unit: "pcs" | "g" | "ml"; servings_per_pack: number;
};
type Company = { legal_name: string | null; trade_name: string | null; vat_number: string | null; address_line1: string | null; city: string | null; postal_code: string | null; country_code: string; email: string | null; phone: string | null; website: string | null };

/** The offer as the client receives it: the offer's language, no costs. Print or save as PDF from the browser. */
export default async function OfferPrintPage({ params }: PageProps<"/offers/[id]/print">) {
  const { id } = await params;
  const { user, t: ui } = await requireRole("admin", "sales");

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const doc = (await tx.query<Doc>(
      `select o.code, o.locale, o.currency, o.incoterm, o.valid_until::text, o.created_at::text, o.sent_at::text, o.deposit_pct::text,
              o.balance_terms, o.balance_net_days, o.notes, o.formula_version_id as version_id,
              c.legal_name as client, c.vat_number as client_vat, c.address_line1 as client_address, c.city as client_city,
              c.postal_code as client_postal, c.country_code as client_country,
              f.name as product, f.name_bg as product_bg, f.product_format, f.serving_size::text, f.serving_unit, f.servings_per_pack
         from offers o join clients c on c.id = o.client_id
         join formula_versions v on v.id = o.formula_version_id join formulas f on f.id = v.formula_id
        where o.id = $1`, [id])).rows[0];
    if (!doc) return null;
    const company = (await tx.query<Company>("select * from company_settings limit 1")).rows[0];
    const lines = (await tx.query<{ name: string; name_bg: string | null; amount: string; unit: string }>(
      "select name, name_bg, amount::text, unit from formula_line_details where version_id = $1 order by sort_order, name", [doc.version_id])).rows;
    const nutrients = (await tx.query<{ name: string; name_bg: string | null; amount: string; unit: string; pct_nrv: string | null }>(
      "select name, name_bg, amount::text, unit, pct_nrv::text from formula_version_nutrients where version_id = $1 order by sort_order", [doc.version_id])).rows;
    const tiers = (await tx.query<{ quantity: number; unit_price: string | null }>(
      "select quantity, unit_price::text from offer_tiers where offer_id = $1 order by quantity", [id])).rows;
    return { doc, company, lines, nutrients, tiers };
  });
  if (!data) notFound();
  const { doc: o, company: co, lines, nutrients, tiers } = data;

  const l = o.locale;
  const t = getDict(l);
  const D = t.offers.doc;
  const nm = (x: { name: string; name_bg: string | null }) => (l === "bg" && x.name_bg ? x.name_bg : x.name);
  const balance = fmt(t.enums.balanceTerms[o.balance_terms ?? "before_dispatch"], { days: o.balance_net_days ?? 0 });
  const terms = o.deposit_pct != null ? fmt(t.clients.detail.depositThen, { pct: formatNumber(l, o.deposit_pct), balance }) : balance;
  const unitLabel = t.enums.servingUnit[o.serving_unit];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        <PrintButton label={ui.offers.doc.printNow} />
        <Link href={`/offers/${id}`} className="btn btn-outline">{ui.offers.doc.back}</Link>
      </div>

      <article lang={l} className="doc doc-brand">
        <DocHeader title={D.title} meta={[`${D.number}: ${o.code}`, `${D.date}: ${formatDate(l, o.sent_at ?? o.created_at)}`, `${D.validUntil}: ${formatDate(l, o.valid_until)}`]} sellerName={co?.trade_name ?? "Nutrikal"} logoDataUrl={null} plain />
        <div className="doc-body">
        <section className="doc-section">
          <h2 className="doc-label">{D.from}</h2>
          <div className="font-semibold">{co?.legal_name ?? co?.trade_name}</div>
          <div className="text-ink-2">
            {[co?.address_line1, [co?.postal_code, co?.city].filter(Boolean).join(" "), co?.vat_number].filter(Boolean).join(" · ")}
          </div>
          <div className="text-ink-2 break-all">{[co?.email, co?.phone, co?.website].filter(Boolean).join(" · ")}</div>
        </section>

        <section className="flex flex-col gap-1">
          <h2 className="doc-label">{D.to}</h2>
          <div className="font-semibold">{o.client}</div>
          <div className="text-ink-2">
            {[o.client_address, [o.client_postal, o.client_city].filter(Boolean).join(" "), o.client_country, o.client_vat].filter(Boolean).join(" · ")}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="doc-label">{D.product}</h2>
          <div className="text-lg font-bold">{l === "bg" && o.product_bg ? o.product_bg : o.product}</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div><span className="text-ink-2">{D.format}: </span>{t.enums.productFormat[o.product_format as "capsule"]}</div>
            <div><span className="text-ink-2">{D.serving}: </span>{formatNumber(l, o.serving_size, 3)} {unitLabel}</div>
            <div><span className="text-ink-2">{D.servingsPerPack}: </span>{o.servings_per_pack}</div>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="doc-label">{D.composition}</h2>
          <div className="row grid-cols-[minmax(0,1fr)_120px] border-b border-line py-1.5 font-semibold">
            <span>{D.ingredient}</span><span className="text-right">{D.amount}</span>
          </div>
          {lines.map((x, i) => (
            <div key={i} className="row grid-cols-[minmax(0,1fr)_120px] border-b border-mist py-1.5">
              <span className="min-w-0 break-words">{nm(x)}</span>
              <span className="text-right">{formatNumber(l, x.amount, 3)} {x.unit === "mcg" ? "µg" : x.unit}</span>
            </div>
          ))}
          {nutrients.length > 0 && (
            <>
              <div className="row mt-3 grid-cols-[minmax(0,1fr)_120px_80px] border-b border-line py-1.5 font-semibold">
                <span>{D.nutrient}</span><span className="text-right">{D.amount}</span><span className="text-right">{D.nrv}</span>
              </div>
              {nutrients.map((n, i) => (
                <div key={i} className="row grid-cols-[minmax(0,1fr)_120px_80px] border-b border-mist py-1.5">
                  <span className="min-w-0 break-words">{nm(n)}</span>
                  <span className="text-right">{formatNumber(l, n.amount, 1)} {n.unit === "mcg" ? "µg" : n.unit}</span>
                  <span className="text-right">{n.pct_nrv != null ? `${formatNumber(l, n.pct_nrv, 0)}%` : "—"}</span>
                </div>
              ))}
              <p className="m-0 text-xs text-ink-2">{D.nrvNote}</p>
            </>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="doc-label">{D.prices}</h2>
          <div className="row grid-cols-[minmax(0,1fr)_110px_120px] border-b border-line py-1.5 font-semibold">
            <span>{D.quantity}</span><span className="text-right">{D.unitPrice}</span><span className="text-right">{D.total}</span>
          </div>
          {tiers.map((x) => (
            <div key={x.quantity} className="row grid-cols-[minmax(0,1fr)_110px_120px] border-b border-mist py-1.5">
              <span>{formatNumber(l, x.quantity)}</span>
              <span className="text-right font-semibold">{x.unit_price ? formatPrice(l, x.unit_price, o.currency) : "—"}</span>
              <span className="text-right">{x.unit_price ? formatPrice(l, Number(x.unit_price) * x.quantity, o.currency) : "—"}</span>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-1">
          <h2 className="doc-label">{D.terms}</h2>
          <div>{fmt(D.delivery, { incoterm: o.incoterm })}</div>
          <div>{fmt(D.payment, { terms })}</div>
          <div>{D.exclVat}</div>
        </section>

        {o.notes && (
          <section className="flex flex-col gap-1">
            <h2 className="doc-label">{D.notes}</h2>
            <p className="m-0 whitespace-pre-line">{o.notes}</p>
          </section>
        )}
        </div>
      </article>
    </div>
  );
}
