import Link from "next/link";
import { Chip, Card, Empty, PageHeader } from "@/components/ui";
import { q } from "@/lib/db/engine";
import { formatDate } from "@/lib/i18n";
import { requireRole } from "@/lib/session";

type Row = {
  id: string; client_id: string; client: string; order_id: string | null; order_code: string | null; status: "open" | "waiting" | "solved";
  assignee: string | null; last_at: string; last_body: string | null; last_from_client: boolean | null; unread: number;
};
const TONE = { open: "amber", waiting: "neutral", solved: "green" } as const;
const FILTERS = ["open", "waiting", "solved", "all"] as const;

/** Every conversation with clients in one list: what needs an answer comes first. */
export default async function ClientMessagesPage({ searchParams }: PageProps<"/client-messages">) {
  const { user, locale, t } = await requireRole("admin", "sales");
  const I = t.portal.staff.inbox;
  const sp = await searchParams;
  const status = FILTERS.find((f) => f === sp.status) ?? "open";
  const rows = await q<Row>(user.id,
    `select id, client_id, client, order_id, order_code, status, assignee, last_at::text, last_body, last_from_client, unread from client_inbox($1)`,
    [status === "all" ? null : status]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={I.title} subtitle={I.note} />
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => <Link key={f} href={`/client-messages?status=${f}`} aria-current={f === status ? "page" : undefined} className={`btn ${f === status ? "btn-primary" : "btn-outline"}`}>{I.filters[f]}</Link>)}
      </div>
      <Card>
        {rows.length === 0 && <Empty>{I.empty}</Empty>}
        {rows.map((x) => (
          <Link key={x.id} href={`${x.order_id ? `/orders/${x.order_id}` : `/clients/${x.client_id}`}#client-messages`} className="flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-mist py-2 text-sm text-ink no-underline last:border-0 hover:underline">
            <span className="flex min-w-0 flex-[1_1_260px] flex-col">
              <span className="font-semibold break-words">{x.client} · {x.order_code ?? I.general}</span>
              <span className="truncate text-xs text-ink-2">{x.last_from_client ? "" : `${I.you}: `}{x.last_body}</span>
            </span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
              {x.unread > 0 && <Chip tone="red">{x.unread}</Chip>}
              <span>{x.assignee ?? I.nobody}</span>
              <span>{formatDate(locale, x.last_at.slice(0, 10))}</span>
              <Chip tone={TONE[x.status]}>{I.statuses[x.status]}</Chip>
            </span>
          </Link>
        ))}
      </Card>
    </div>
  );
}
