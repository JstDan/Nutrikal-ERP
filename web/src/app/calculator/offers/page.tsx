import { requireRole } from "@/lib/session";
import { loadOffers, loadSettings } from "@/lib/calculator/db";
import { PageHeader } from "@/components/ui";
import { CalcTabs } from "@/components/calculator/calc-tabs";
import { OffersList } from "@/components/calculator/offers-list";

export default async function CalculatorOffersPage() {
  const { user, locale, t } = await requireRole("admin", "sales");
  const [offers, settings] = await Promise.all([loadOffers(user.id), loadSettings(user.id)]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.calc.offers.title} subtitle={t.calc.offers.subtitle} />
      <CalcTabs t={t.calc} active="offers" />
      <OffersList t={t.calc} locale={locale} offers={offers} settings={settings} userId={user.id} isAdmin={user.role === "admin"} />
    </div>
  );
}
