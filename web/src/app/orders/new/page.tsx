import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { loadSettings } from "@/lib/calculator/db";
import { offerPriceOptions } from "@/lib/calculator/priceOptions";
import type { CalcResult } from "@/lib/calculator/calc";
import type { OfferForm } from "@/lib/calculator/types";
import { fmt } from "@/lib/i18n";
import { Card, PageHeader } from "@/components/ui";
import { NewOrderForm, type OrderEdit, type OrderableClient, type OrderableOffer } from "@/components/new-order-form";
import { correctOrderFromForm, createOrderFromCalcOffers } from "@/app/actions";

type Line = { id: string; kind: string; calc_offer_id: string | null; description: string | null; quantity: number; unit_price: number };

/**
 * New order from the client's calculator offers (offers that are not in an order yet).
 * ?edit=<order>: the same form filled in with that order, to correct it until it is sent to production
 * (owner, Nov 2026); saving runs the correct_order_* functions with one reason.
 */
export default async function NewOrderPage({ searchParams }: PageProps<"/orders/new">) {
  const { user, locale, t } = await requireRole("admin", "sales");
  const sp = await searchParams;
  const n = t.orders.new;
  const editId = typeof sp.edit === "string" && /^[0-9a-f-]{36}$/i.test(sp.edit) ? sp.edit : null;

  const [data, settings] = await Promise.all([
    withUser(user.id, async (tx) => {
      const order = editId
        ? (await tx.query<{ id: string; code: string; client_id: string; status: string; vat_pct: string | null; customer_ref: string | null;
                            requested_date: string | null; notes: string | null; sent: boolean }>(
            `select so.id, so.code, so.client_id, so.status::text, so.vat_pct::text, so.customer_ref, so.requested_date::text, so.notes,
                    exists (select 1 from manufacturing_orders mo join sales_order_lines l on l.id = mo.sales_order_line_id
                             where l.order_id = so.id and mo.status in ('released', 'in_production', 'completed')) as sent
               from sales_orders so where so.id = $1`, [editId])).rows[0]
        : null;
      if (editId && !order) return null;
      const lines = order
        ? (await tx.query<Line>(
            `select id, kind::text, calc_offer_id, description, quantity, unit_price::float as unit_price
               from sales_order_lines where order_id = $1 order by sort_order, id`, [order.id])).rows
        : [];
      const inOrder = lines.filter((l) => l.calc_offer_id).map((l) => l.calc_offer_id!);
      const offers = (await tx.query<Omit<OrderableOffer, "levels"> & { data: OfferForm; results: CalcResult }>(
        `select co.id, co.offer_no, co.product_name as product, co.client_id, co.created_at::text, co.data, co.results,
                coalesce(nullif(co.data ->> 'numberOfUnits', '')::numeric, 0)::int as units,
                coalesce(nullif(co.results ->> 'unitPrice', '')::numeric, 0)::float as unit_price
           from calc_offers co
          where co.client_id is not null
            and ($1::uuid is null or co.client_id = $1)
            and (co.id = any($2::uuid[])
                 or not exists (select 1 from sales_order_lines l join sales_orders so on so.id = l.order_id
                                 where l.calc_offer_id = co.id and so.status <> 'cancelled'))
          order by co.created_at desc`, [order?.client_id ?? null, inOrder])).rows
        .filter((o) => inOrder.includes(o.id) || (o.units > 0 && o.unit_price > 0))
        // The other quantities of the offer (price tiers, catalog steps), as on its PDF; an offer of the order
        // also at its quantity and price in the order (they may have been corrected)
        .map(({ data, results, ...o }): OrderableOffer => {
          const levels = offerPriceOptions(data, { ...results, complete: true });
          const line = lines.find((l) => l.calc_offer_id === o.id);
          if (!line) return { ...o, levels };
          const current = { units: line.quantity, price: line.unit_price };
          return { ...o, units: current.units, unit_price: current.price,
                   levels: [...levels.filter((l) => l.units !== current.units), current].sort((a, b) => a.units - b.units) };
        });
      const ids = [...new Set(offers.map((o) => o.client_id).concat(order ? [order.client_id] : []))];
      const clients = ids.length
        ? (await tx.query<OrderableClient>(
            `select id, legal_name as name, country_code as country, vat_number from clients where id = any($1::uuid[]) order by lower(legal_name)`,
            [ids])).rows
        : [];
      return { clients, offers, order, lines };
    }),
    loadSettings(user.id),
  ]);
  if (!data) notFound();
  const { clients, offers, order, lines } = data;

  const correctable = !!order && ["draft", "unpaid", "confirmed"].includes(order.status) && !order.sent;
  const edit: OrderEdit | undefined = order && correctable
    ? {
        orderId: order.id,
        offers: lines.filter((l) => l.calc_offer_id).map((l) => l.calc_offer_id!),
        services: lines.filter((l) => l.kind === "service")
          .map((l) => ({ lineId: l.id, description: l.description ?? "", quantity: l.quantity, price: l.unit_price })),
        fixed: lines.filter((l) => l.kind !== "service" && !l.calc_offer_id).map((l) => ({ description: l.description ?? "—", quantity: l.quantity })),
        vat: order.vat_pct ?? "",
        customerRef: order.customer_ref ?? "",
        requested: order.requested_date ?? "",
        notes: order.notes ?? "",
      }
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={order ? fmt(n.editTitle, { code: order.code }) : n.title}
        subtitle={order ? n.editSubtitle : n.subtitle}
        crumb={order
          ? <><Link href="/orders" className="text-ink-2">{t.orders.title}</Link> / <Link href={`/orders/${order.id}`} className="text-ink-2">{order.code}</Link></>
          : <Link href="/orders" className="text-ink-2">{t.orders.title}</Link>}
      />
      <Card>
        {order && !correctable ? (
          <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{t.orders.corrections.closed}</p>
        ) : (
          <NewOrderForm
            action={edit ? correctOrderFromForm : createOrderFromCalcOffers}
            clients={clients}
            offers={offers}
            presets={settings.service_presets.map((p) => ({ description: p.description, price: p.price }))}
            initialClient={order ? order.client_id : typeof sp.client === "string" ? sp.client : null}
            initialOffer={typeof sp.offer === "string" ? sp.offer : null}
            edit={edit}
            locale={locale}
            text={n}
          />
        )}
      </Card>
    </div>
  );
}
