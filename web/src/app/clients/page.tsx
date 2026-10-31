import Link from "next/link";
import { LiveSearch } from "@/components/live-search";
import { q } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { clientTone } from "@/lib/status";

type Row = { id: string; code: string; legal_name: string; city: string | null; country_code: string; status: string; projects: number; owner: string | null };

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const { user, t } = await requireStaff();
  const sp = await searchParams;
  const term = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const canCreate = user.role === "admin" || user.role === "sales";

  const rows = await q<Row>(
    user.id,
    `select c.id, c.code, c.legal_name, c.city, c.country_code, c.status,
            (select count(*)::int from projects p where p.client_id = c.id) as projects,
            pr.full_name as owner
       from clients c left join profiles pr on pr.id = c.owner_id
      where ($1 = '' or c.legal_name ilike '%' || $1 || '%' or c.trade_name ilike '%' || $1 || '%' or c.code ilike '%' || $1 || '%')
        and ($2 = '' or c.status::text = $2)
      order by c.legal_name`,
    [term, status],
  );

  const tabs = ["", "active", "lead", "inactive"] as const;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.clients.title}
        subtitle={t.clients.subtitle}
        actions={canCreate && <Link href="/clients/new" className="btn btn-primary">{t.clients.new}</Link>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label={t.clients.status} className="flex flex-wrap gap-1">
          {tabs.map((s) => (
            <Link
              key={s || "all"}
              href={`/clients?${new URLSearchParams({ ...(term && { q: term }), ...(s && { status: s }) })}`}
              aria-current={status === s ? "page" : undefined}
              className={`flex min-h-10 items-center rounded-full border px-3.5 text-[13px] no-underline ${status === s ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-white text-ink"}`}
            >
              {s ? t.enums.clientStatus[s] : t.common.all}
            </Link>
          ))}
        </nav>
        <form method="get" role="search" className="flex min-w-0 flex-[1_1_240px] justify-end gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <label htmlFor="client-q" className="sr-only">{t.topbar.search}</label>
          <LiveSearch id="client-q" defaultValue={term} placeholder={t.clients.searchPlaceholder} className="input max-w-[360px]" />
        </form>
      </div>

      <section aria-label={t.clients.title} className="card px-5 pt-2 pb-3">
        <div className="row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 md:grid-cols-[minmax(0,2fr)_90px_120px] lg:grid-cols-[minmax(0,2fr)_90px_90px_minmax(0,1fr)_120px]">
          <span>{t.clients.name}</span>
          <span>{t.clients.country}</span>
          <span className="hide-md">{t.clients.projects}</span>
          <span className="hide-md">{t.clients.owner}</span>
          <span>{t.clients.status}</span>
        </div>
        {rows.length === 0 && <div className="py-4"><Empty>{t.clients.empty}</Empty></div>}
        {rows.map((c) => (
          <div key={c.id} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3.5 text-sm last:border-0 md:grid-cols-[minmax(0,2fr)_90px_120px] lg:grid-cols-[minmax(0,2fr)_90px_90px_minmax(0,1fr)_120px]">
            <div className="min-w-0">
              <Link href={`/clients/${c.id}`} className="font-semibold text-ink break-words">{c.legal_name}</Link>
              <div className="text-xs text-ink-2">{c.code}{c.city ? ` · ${c.city}` : ""}</div>
            </div>
            <span className="hide-sm">{c.country_code}</span>
            <span className="hide-md">{c.projects}</span>
            <span className="hide-md min-w-0 break-words">{c.owner ?? "—"}</span>
            <Chip tone={clientTone(c.status)}>{t.enums.clientStatus[c.status as "lead"]}</Chip>
          </div>
        ))}
      </section>
    </div>
  );
}
