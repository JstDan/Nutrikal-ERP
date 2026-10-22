import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { loadSettings } from "@/lib/calculator/db";
import { Card, PageHeader } from "@/components/ui";
import { NewOrderForm, type OrderableClient, type OrderableOffer } from "@/components/new-order-form";
import { createOrderFromCalcOffers } from "@/app/actions";

/** New order from the client's calculator offers (offers that are not in an order yet). */
export default async function NewOrderPage({ searchParams }: PageProps<"/orders/new">) {
  const { user, locale, t } = await requireRole("admin", "sales");
  const sp = await searchParams;
  const n = t.orders.new;

  const [{ clients, offers }, settings] = await Promise.all([
    withUser(user.id, async (tx) => {
      const offers = (await tx.query<OrderableOffer>(
        `select co.id, co.offer_no, co.product_name as product, co.client_id, co.created_at::text,
                coalesce(nullif(co.data ->> 'numberOfUnits', '')::numeric, 0)::int as units,
                coalesce(nullif(co.results ->> 'unitPrice', '')::numeric, 0)::float as unit_price
           from calc_offers co
          where co.client_id is not null
            and not exists (select 1 from sales_order_lines l join sales_orders so on so.id = l.order_id
                             where l.calc_offer_id = co.id and so.status <> 'cancelled')
          order by co.created_at desc`)).rows.filter((o) => o.units > 0 && o.unit_price > 0);
      const ids = [...new Set(offers.map((o) => o.client_id))];
      const clients = ids.length
        ? (await tx.query<OrderableClient>(
            `select id, legal_name as name, country_code as country, vat_number from clients where id = any($1::uuid[]) order by lower(legal_name)`,
            [ids])).rows
        : [];
      return { clients, offers };
    }),
    loadSettings(user.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={n.title} subtitle={n.subtitle} crumb={<Link href="/orders" className="text-ink-2">{t.orders.title}</Link>} />
      <Card>
        <NewOrderForm
          action={createOrderFromCalcOffers}
          clients={clients}
          offers={offers}
          presets={settings.service_presets.map((p) => ({ description: p.description, price: p.price }))}
          initialClient={typeof sp.client === "string" ? sp.client : null}
          locale={locale}
          text={n}
        />
      </Card>
    </div>
  );
}
