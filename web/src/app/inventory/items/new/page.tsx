import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { ItemForm } from "@/components/item-form";

export default async function NewItemPage() {
  const { t } = await requireRole("admin", "inventory");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.items.newTitle} subtitle={t.items.subtitle} crumb={<Link href="/inventory" className="text-ink-2">{t.inventory.title}</Link>} />
      <Card><ItemForm t={t} /></Card>
    </div>
  );
}
