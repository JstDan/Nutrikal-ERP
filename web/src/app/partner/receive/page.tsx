import { requireRole } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { ReceiveForm } from "@/components/receive-form";

export default async function PartnerReceivePage() {
  const { user, t } = await requireRole("partner", "admin");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.receive.title} subtitle={t.receive.subtitle} />
      <Card><ReceiveForm user={user} t={t} /></Card>
    </div>
  );
}
