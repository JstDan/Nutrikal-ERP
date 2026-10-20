import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { ReceiveForm } from "@/components/receive-form";

export default async function ReceivePage() {
  const { user, t } = await requireRole("admin");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.receive.title} subtitle={t.receive.subtitle} crumb={<Link href="/inventory" className="text-ink-2">{t.inventory.title}</Link>} />
      <Card><ReceiveForm user={user} t={t} /></Card>
    </div>
  );
}
