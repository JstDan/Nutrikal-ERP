import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { loadOffer, loadSettings } from "@/lib/calculator/db";
import { q } from "@/lib/db/engine";
import { PageHeader } from "@/components/ui";
import { OfferSummary } from "@/components/calculator/offer-summary";

export default async function CalculatorOfferPage({ params }: PageProps<"/offers/calc/[id]">) {
  const { user, locale, t } = await requireRole("admin", "sales");
  const { id } = await params;
  const [offer, settings] = await Promise.all([loadOffer(user.id, id), loadSettings(user.id)]);
  if (!offer) notFound();
  const recipe = (await q<{ id: string }>(user.id, "select id from formulas where calc_offer_id = $1", [offer.id]))[0];
  // Offers in an order that is not cancelled cannot be deleted (calc_offers_in_order_guard)
  const inOrder = (await q<{ id: number }>(
    user.id,
    `select 1 as id from sales_order_lines l join sales_orders so on so.id = l.order_id
      where l.calc_offer_id = $1 and so.status <> 'cancelled' limit 1`,
    [offer.id],
  )).length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${t.calc.client.offerNo} ${offer.offer_no}`}
        subtitle={[offer.company_name || offer.receiver_name, offer.product_name].filter(Boolean).join(" · ")}
        crumb={<><Link href="/offers" className="text-ink-2">{t.offers.title}</Link> / {offer.offer_no}</>}
        actions={recipe && <Link href={`/formulas/${recipe.id}`} className="btn btn-outline">{t.formulas.openRecipe}</Link>}
      />
      <OfferSummary
        t={t.calc}
        locale={locale}
        offer={offer}
        settings={settings}
        canDelete={(user.role === "admin" || offer.created_by === user.id) && !inOrder}
      />
    </div>
  );
}
