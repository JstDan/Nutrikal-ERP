import { PageHeader } from "@/components/ui";
import { DocumentList, Panel } from "@/components/portal-parts";
import { portalDocuments } from "@/lib/portal";
import { getPortalSession } from "@/lib/session";

export default async function PortalDocuments() {
  const { user, locale, t } = await getPortalSession();
  return (
    <>
      <PageHeader title={t.portal.docs.title} subtitle={t.portal.docs.intro} />
      <Panel><DocumentList rows={await portalDocuments(user.id)} showOrder locale={locale} t={t} /></Panel>
    </>
  );
}
