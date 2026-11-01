import { PageHeader } from "@/components/ui";
import { Panel, PortalThread } from "@/components/portal-parts";
import { portalFeed, portalMarkRead } from "@/lib/portal";
import { getPortalSession } from "@/lib/session";

const WHATSAPP = "https://wa.me/359882919140";

export default async function PortalSupport() {
  const { user, locale, t } = await getPortalSession();
  const S = t.portal.support;
  const feed = await portalFeed(user.id);
  await portalMarkRead(user.id);
  return (
    <>
      <PageHeader title={S.title} subtitle={S.intro} />
      <Panel><PortalThread orderId={null} rows={feed} locale={locale} t={t} /></Panel>
      <p className="m-0 text-sm text-ink-2">{S.other} <a href={WHATSAPP} target="_blank" rel="noopener">WhatsApp</a> · <a href="mailto:sales@nutrikal.com">sales@nutrikal.com</a></p>
    </>
  );
}
