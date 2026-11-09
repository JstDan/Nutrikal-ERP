import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { loadOffer, loadSettings } from "@/lib/calculator/db";
import { q } from "@/lib/db/engine";
import { PageHeader } from "@/components/ui";
import { OfferSummary } from "@/components/calculator/offer-summary";
import { loadSendInfo } from "@/lib/sends";
import { ActionForm } from "@/components/action-form";
import { closeOfferFollowup } from "@/app/shortcut-actions";
import { fmt, formatDate, getDict } from "@/lib/i18n";

export default async function CalculatorOfferPage({ params }: PageProps<"/offers/calc/[id]">) {
  const { user, locale, t } = await requireRole("admin", "sales", "designer");
  const reader = user.access === "designer";
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

  // The sender picks the language of the offer on the card (owner, Nov 2026); English first
  const lang: "bg" | "en" = "en";
  const send = reader ? null : await loadSendInfo(user.id, user.name, "calc_offer", offer.id, {
    to: offer.receiver_email, title: getDict(lang).send.offerTitle, no: offer.offer_no, lang,
    titles: { bg: getDict("bg").send.offerTitle, en: getDict("en").send.offerTitle },
  });

  const closed = (await q<{ id: number }>(user.id, "select 1 as id from calc_offer_closed where offer_id = $1", [offer.id])).length > 0;
  const reminderIn = (l: "bg" | "en") => {
    const M = getDict(l).assistant;
    return {
      subject: fmt(M.offerReminderSubject, { no: offer.offer_no }),
      body: fmt(M.offerReminderBody, { no: offer.offer_no, date: formatDate(l, offer.created_at.slice(0, 10)), name: user.name }),
    };
  };
  const reminder = send && !inOrder && !closed ? {
    ...send, history: [], ...reminderIn(lang),
    versions: { bg: reminderIn("bg"), en: reminderIn("en") },
  } : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${t.calc.client.offerNo} ${offer.offer_no}`}
        subtitle={[offer.company_name || offer.receiver_name, offer.product_name].filter(Boolean).join(" · ")}
        crumb={<><Link href="/offers" className="text-ink-2">{t.offers.title}</Link> / {offer.offer_no}</>}
        actions={(recipe || (offer.client_id && !inOrder)) && (
          <div className="flex flex-wrap gap-3">
            {recipe && <Link href={`/formulas/${recipe.id}`} className="btn btn-outline">{t.formulas.openRecipe}</Link>}
            {!reader && offer.client_id && !inOrder && <Link href={`/orders/new?client=${offer.client_id}&offer=${offer.id}`} className="btn btn-primary">{t.orders.detail.orderFromOffer}</Link>}
          </div>
        )}
      />
      <OfferSummary
        t={t.calc}
        locale={locale}
        offer={offer}
        settings={settings}
        canDelete={!reader && (user.role === "admin" || offer.created_by === user.id) && !inOrder}
        send={send}
        reminder={reminder}
        sendText={t.send}
        reminderTitle={t.assistant.offerReminder}
        langText={t.common.docLang}
      />
      {reminder && (
        <div className="max-w-[960px]">
          <ActionForm action={closeOfferFollowup} submitLabel={t.assistant.offerClose} resetOnSuccess={false}>
            <input type="hidden" name="offer_id" value={offer.id} />
            <p className="m-0 text-xs text-ink-2">{t.assistant.offerCloseNote}</p>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
