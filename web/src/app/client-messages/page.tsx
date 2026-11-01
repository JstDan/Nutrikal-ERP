import Link from "next/link";
import { ClientConversation } from "@/components/client-messages";
import { Empty, PageHeader } from "@/components/ui";
import { q } from "@/lib/db/engine";
import { formatDate } from "@/lib/i18n";
import { requireRole } from "@/lib/session";

type Row = {
  id: string; client_id: string; client: string; order_id: string | null; order_code: string | null; status: "open" | "waiting" | "solved";
  assignee: string | null; last_at: string; last_body: string | null; last_from_client: boolean | null; unread: number;
};
const FILTERS = ["open", "waiting", "solved", "all"] as const;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** Conversations on the left, the open one on the right. On a phone, one at a time. */
export default async function ClientMessagesPage({ searchParams }: PageProps<"/client-messages">) {
  const { user, locale, t } = await requireRole("admin", "sales");
  const I = t.portal.staff.inbox;
  const sp = await searchParams;
  const status = FILTERS.find((f) => f === sp.status) ?? "open";
  const all = await q<Row>(user.id,
    "select id, client_id, client, order_id, order_code, status, assignee, last_at::text, last_body, last_from_client, unread from client_inbox(null)");
  const rows = all.filter((x) => status === "all" || x.status === status);
  const open = all.find((x) => x.id === sp.open);
  const today = new Date().toISOString().slice(0, 10);
  const stamp = (at: string) => (at.slice(0, 10) === today ? at.slice(11, 16) : formatDate(locale, at.slice(0, 10)));
  const link = (s: string, id?: string) => `/client-messages?status=${s}${id ? `&open=${id}` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={I.title} subtitle={I.note} />
      <div className="c-inbox">
        <section aria-label={I.title} className={`c-list ${open ? "hidden lg:flex" : "flex"}`}>
          <div className="flex flex-wrap gap-1 border-b border-line p-2">
            {FILTERS.map((f) => (
              <Link key={f} href={link(f, open?.id)} aria-current={f === status ? "page" : undefined} className={`p-seg no-underline ${f === status ? "p-seg-on" : ""}`}>
                {I.filters[f]}{f !== "all" && ` ${all.filter((x) => x.status === f).length}`}
              </Link>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rows.length === 0 && <div className="p-4"><Empty>{I.empty}</Empty></div>}
            {rows.map((x) => (
              <Link key={x.id} href={link(status, x.id)} aria-current={x.id === open?.id ? "true" : undefined} className="c-row">
                <span aria-hidden="true" className="p-face">{initials(x.client)}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`min-w-0 truncate text-sm ${x.unread ? "font-bold" : "font-semibold"}`}>{x.client}</span>
                    <span className="shrink-0 text-xs text-ink-2">{stamp(x.last_at)}</span>
                  </span>
                  <span className="truncate text-xs text-ink-2">{x.order_code ?? I.general} · {x.assignee ?? I.nobody}</span>
                  <span className="flex items-center gap-2">
                    <span className={`min-w-0 flex-1 truncate text-xs ${x.unread ? "font-semibold text-ink" : "text-ink-2"}`}>{x.last_from_client ? "" : `${I.you}: `}{x.last_body}</span>
                    {x.unread > 0 && <span className="p-count">{x.unread}</span>}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section aria-label={open?.client ?? I.title} className={`c-pane ${open ? "flex" : "hidden lg:flex"}`}>
          {open ? (
            <>
              <header className="flex min-w-0 flex-wrap items-center gap-3 border-b border-line pb-3">
                <Link href={link(status)} aria-label={t.common.back} className="btn btn-outline lg:hidden">←</Link>
                <span className="flex min-w-0 flex-1 flex-col">
                  <Link href={`/clients/${open.client_id}`} className="font-bold break-words text-ink no-underline hover:underline">{open.client}</Link>
                  {open.order_id ? <Link href={`/orders/${open.order_id}`} className="text-xs">{open.order_code}</Link> : <span className="text-xs text-ink-2">{I.general}</span>}
                </span>
              </header>
              <ClientConversation key={open.id} clientId={open.client_id} orderId={open.order_id} userId={user.id} canWrite={!user.readOnly} locale={locale} t={t} tall />
            </>
          ) : <p className="m-auto text-sm text-ink-2">{I.pick}</p>}
        </section>
      </div>
    </div>
  );
}
