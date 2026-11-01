import { PageHeader } from "@/components/ui";
import { InvoiceList, Panel } from "@/components/portal-parts";
import { portalInvoices } from "@/lib/portal";
import { getPortalSession } from "@/lib/session";

export default async function PortalInvoices() {
  const { user, locale, t } = await getPortalSession();
  return (
    <>
      <PageHeader title={t.portal.invoices.title} />
      <Panel><InvoiceList rows={await portalInvoices(user.id)} locale={locale} t={t} /></Panel>
    </>
  );
}
