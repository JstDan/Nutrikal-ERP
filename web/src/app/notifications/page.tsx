import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { formatDate } from "@/lib/i18n";
import { Empty, PageHeader } from "@/components/ui";
import { markNotificationsRead } from "@/app/actions";
import { notificationText, type NotificationRow } from "@/lib/notifications";

export default async function NotificationsPage() {
  const { user, locale, t } = await getSession();
  const N = t.notifications;
  const rows = await q<NotificationRow>(user.id,
    "select id::text, kind, params, link, created_at::text, read_at::text from notifications order by created_at desc limit 100");
  const unread = rows.filter((r) => !r.read_at).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={N.title}
        subtitle={unread > 0 ? `${N.subtitle} · ${N.unread.replace("{n}", String(unread))}` : N.subtitle}
        actions={unread > 0 && (
          <form action={markNotificationsRead}><button type="submit" className="btn btn-outline">{N.markAll}</button></form>
        )}
      />
      <section aria-label={N.title} className="card px-5 py-2">
        {rows.length === 0 && <div className="py-4"><Empty>{N.empty}</Empty></div>}
        <ul className="m-0 list-none p-0">
          {rows.map((n) => (
            <li key={n.id} className="border-b border-mist last:border-0">
              <a href={`/notifications/${n.id}`} className="flex min-h-11 items-start gap-3 py-3 text-sm text-ink no-underline hover:bg-canvas">
                <span aria-hidden="true" className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-red"}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block break-words ${n.read_at ? "" : "font-semibold"}`}>{notificationText(n, t, locale)}</span>
                  <span className="block text-xs text-ink-2">{formatDate(locale, n.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
