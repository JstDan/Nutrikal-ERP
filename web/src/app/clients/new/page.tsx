import Link from "next/link";
import { requireRole } from "@/lib/session";
import { ActionForm } from "@/components/action-form";
import { ClientFields } from "@/components/client-fields";
import { Card, PageHeader } from "@/components/ui";
import { createClient } from "@/app/actions";

export default async function NewClientPage() {
  const { locale, t } = await requireRole("admin", "sales");
  const f = t.clients.form;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={f.title} subtitle={f.subtitle} crumb={<Link href="/clients" className="text-ink-2">{t.clients.title}</Link>} />
      <Card>
        <ActionForm action={createClient} submitLabel={f.submit} resetOnSuccess={false}>
          <ClientFields t={t} locale={locale} withContact />
        </ActionForm>
      </Card>
    </div>
  );
}
