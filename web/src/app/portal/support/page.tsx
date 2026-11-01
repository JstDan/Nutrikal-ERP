import { PageHeader } from "@/components/ui";
import { Panel, PortalThread } from "@/components/portal-parts";
import { portalFeed, portalMarkRead, portalThreads } from "@/lib/portal";
import Link from "next/link";
import { Chip } from "@/components/ui";
import { getPortalSession } from "@/lib/session";

const WHATSAPP = "https://wa.me/359882919140";

export default async function PortalSupport() {
  const { user, locale, t } = await getPortalSession();
  const S = t.portal.support;
  const feed = await portalFeed(user.id);
  const threads = (await portalThreads(user.id)).filter((x) => x.order_id);
  await portalMarkRead(user.id);
  return (
    <>
      <PageHeader title={S.title} subtitle={S.intro} />
      {threads.length > 0 && (
        <Panel title={S.conversations}>
          {threads.map((x) => (
            <Link key={x.order_id} href={`/portal/orders/${x.order_id}`} className="p-row">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{x.order_code}</span>
                <span className="truncate text-xs text-ink-2">{x.last_body}</span>
              </span>
              {x.unread > 0 && <span className="p-count">{x.unread}</span>}
              <Chip tone={x.status === "solved" ? "green" : x.status === "waiting" ? "neutral" : "amber"}>{S.states[x.status]}</Chip>
            </Link>
          ))}
        </Panel>
      )}
      <Panel><PortalThread orderId={null} rows={feed} locale={locale} t={t} /></Panel>
      <p className="m-0 text-sm text-ink-2">{S.other} <a href={WHATSAPP} target="_blank" rel="noopener">WhatsApp</a> · <a href="mailto:sales@nutrikal.com">sales@nutrikal.com</a></p>
    </>
  );
}
