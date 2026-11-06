import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { formatQty } from "@/lib/i18n";
import { Card, Fact, PageHeader } from "@/components/ui";
import { ItemForm, type ItemRecord } from "@/components/item-form";

type Stock = { on_hand: string; quarantine: string; reserved: string; available: string; incoming: string; projected: string };

export default async function ItemPage({ params }: PageProps<"/inventory/items/[id]">) {
  const { id } = await params;
  const { user, locale, t } = await requireStaff();
  const canEdit = user.role === "admin";

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const item = (await tx.query<ItemRecord>(
      `select id, sku, type, name, name_bg, base_unit, latin_name, novel_food_status, novel_food_reference, shelf_life_months,
              storage_conditions, allergens::text[] as allergens, is_vegan, is_vegetarian, regulatory_notes, notes, is_active
         from items where id = $1 and type <> 'finished_good'`, [id])).rows[0];
    if (!item) return null;
    const stock = (await tx.query<Stock>(
      "select on_hand::text, quarantine::text, reserved::text, available::text, incoming::text, projected::text from item_stock_summary where item_id = $1",
      [id])).rows[0];
    return { item, stock };
  });
  if (!data) notFound();
  const { item, stock } = data;
  const q = (n: string | undefined) => formatQty(locale, n ?? 0, item.base_unit);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/inventory" className="text-ink-2">{t.inventory.title}</Link> / {item.sku}</>}
        title={locale === "bg" && item.name_bg ? item.name_bg : item.name}
        subtitle={`${item.sku} · ${t.enums.itemType[item.type as "raw_material"]}`}
        actions={<Link href={`/inventory?q=${encodeURIComponent(item.sku)}`} className="btn btn-outline">{t.items.stockLink}</Link>}
      />
      <Card>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          <Fact label={t.inventory.onHand}>{q(stock?.on_hand)}</Fact>
          <Fact label={t.inventory.quarantine}>{q(stock?.quarantine)}</Fact>
          <Fact label={t.inventory.reserved}>{q(stock?.reserved)}</Fact>
          <Fact label={t.inventory.available}>{q(stock?.available)}</Fact>
          <Fact label={t.inventory.incoming}>{q(stock?.incoming)}</Fact>
          <Fact label={t.inventory.projected}>{q(stock?.projected)}</Fact>
        </div>
      </Card>
      <Card title={canEdit ? t.items.editTitle : undefined}>
        {canEdit ? (
          <ItemForm t={t} item={item} />
        ) : (
          <>
            <p className="m-0 text-sm text-ink-2">{t.items.readOnly}</p>
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Fact label={t.items.name}>{item.name}</Fact>
              <Fact label={t.items.nameBg}>{item.name_bg ?? "—"}</Fact>
              <Fact label={t.items.novelFood}>{item.novel_food_status ? t.enums.novelFood[item.novel_food_status as "unknown"] : "—"}</Fact>
              <Fact label={t.items.shelfLife}>{item.shelf_life_months ?? "—"}</Fact>
              <Fact label={t.items.allergens}>{item.allergens.length ? item.allergens.map((a) => t.enums.allergen[a as "milk"]).join(", ") : "—"}</Fact>
              <Fact label={t.items.storage}>{item.storage_conditions ?? "—"}</Fact>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
