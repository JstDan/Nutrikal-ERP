import Link from "next/link";
import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { formatDate, formatNumber } from "@/lib/i18n";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { offerTone } from "@/lib/status";
import { loadOffers } from "@/lib/calculator/db";
import { OffersList } from "@/components/calculator/offers-list";

type Row = {
  id: string; code: string; status: string; valid_until: string | null; client: string; client_id: string;
  product: string; product_bg: string | null; quantities: number[] | null;
};
const STATUSES = ["draft", "sent", "accepted", "rejected", "expired"] as const;

export default async function OffersPage({ searchParams }: PageProps<"/offers">) {
  const { user, locale, t } = await requireRole("admin", "sales");
  const sp = await searchParams;
  const status = typeof sp.status === "string" && (STATUSES as readonly string[]).includes(sp.status) ? sp.status : "";

  const calcOffers = await loadOffers(user.id);
  const rows = await q<Row>(
    user.id,
    `select o.id, o.code, o.status, o.valid_until::text, c.legal_name as client, c.id as client_id,
            f.name as product, f.name_bg as product_bg,
            (select array_agg(quantity order by quantity) from offer_tiers where offer_id = o.id) as quantities
       from offers o
       join clients c on c.id = o.client_id
       join formula_versions v on v.id = o.formula_version_id
       join formulas f on f.id = v.formula_id
      where ($1 = '' or o.status::text = $1)
      order by o.code desc`,
    [status],
  );

  const grid = "md:grid-cols-[110px_minmax(0,1.2fr)_minmax(0,1fr)_130px] lg:grid-cols-[110px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_120px_130px]";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.offers.title}
        subtitle={t.offers.subtitle}
        actions={
          <>
            <Link href="/offers/costing" className="btn btn-outline">{t.offers.costing}</Link>
            <Link href="/offers/new" className="btn btn-primary">{t.offers.new}</Link>
          </>
        }
      />
      <OffersList t={t.calc} locale={locale} offers={calcOffers} />

      <h2 className="m-0 text-lg font-bold">{t.offers.formulaOffers}</h2>
      <nav aria-label={t.offers.status} className="flex flex-wrap gap-1">
        {(["", ...STATUSES] as const).map((s) => (
          <Link
            key={s || "all"}
            href={s ? `/offers?status=${s}` : "/offers"}
            aria-current={status === s ? "page" : undefined}
            className={`flex min-h-10 items-center rounded-full border px-3.5 text-[13px] no-underline ${status === s ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-white text-ink"}`}
          >
            {s ? t.enums.offerStatus[s] : t.common.all}
          </Link>
        ))}
      </nav>

      <section aria-label={t.offers.title} className="card px-5 pt-2 pb-3">
        <div className={`row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 ${grid}`}>
          <span>{t.offers.code}</span><span>{t.offers.client}</span><span>{t.offers.product}</span>
          <span className="hide-md">{t.offers.tiers}</span><span className="hide-md">{t.offers.validUntil}</span>
          <span>{t.offers.status}</span>
        </div>
        {rows.length === 0 && <div className="py-4"><Empty>{t.offers.empty}</Empty></div>}
        {rows.map((o) => (
          <div key={o.id} className={`row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3.5 text-sm last:border-0 ${grid}`}>
            <div className="min-w-0 md:contents">
              <Link href={`/offers/${o.id}`} className="font-semibold text-ink">{o.code}</Link>
              <Link href={`/clients/${o.client_id}`} className="block min-w-0 break-words text-ink md:inline">{o.client}</Link>
            </div>
            <span className="hide-sm min-w-0 break-words">{locale === "bg" && o.product_bg ? o.product_bg : o.product}</span>
            <span className="hide-md">{o.quantities?.map((n) => formatNumber(locale, n)).join(" / ") ?? "—"}</span>
            <span className="hide-md">{formatDate(locale, o.valid_until)}</span>
            <Chip tone={offerTone(o.status)}>{t.enums.offerStatus[o.status as "draft"]}</Chip>
          </div>
        ))}
      </section>
    </div>
  );
}
