import Link from "next/link";
import { q } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { formatDate, formatNumber } from "@/lib/i18n";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { projectTone } from "@/lib/status";

type Row = { id: string; code: string; name: string; product_format: string | null; status: string; expected_units: number | null; target_date: string | null; client: string; client_id: string };
const STAGES = ["inquiry", "formulation", "offer", "order", "production", "completed", "on_hold", "lost"] as const;

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const { user, locale, t } = await requireStaff();
  const sp = await searchParams;
  const status = typeof sp.status === "string" && (STAGES as readonly string[]).includes(sp.status) ? sp.status : "";

  const rows = await q<Row>(
    user.id,
    `select p.id, p.code, p.name, p.product_format, p.status, p.expected_units, p.target_date::text, c.legal_name as client, c.id as client_id
       from projects p join clients c on c.id = p.client_id
      where ($1 = '' or p.status::text = $1)
      order by p.status in ('completed', 'lost'), p.code desc`,
    [status],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.projects.title} subtitle={t.projects.subtitle} />
      <nav aria-label={t.projects.status} className="flex flex-wrap gap-1">
        {(["", ...STAGES] as const).map((s) => (
          <Link
            key={s || "all"}
            href={s ? `/projects?status=${s}` : "/projects"}
            aria-current={status === s ? "page" : undefined}
            className={`flex min-h-10 items-center rounded-full border px-3.5 text-[13px] no-underline ${status === s ? "border-ink bg-ink font-semibold text-white" : "border-line-strong bg-white text-ink"}`}
          >
            {s ? t.enums.projectStatus[s] : t.common.all}
          </Link>
        ))}
      </nav>

      <section aria-label={t.projects.title} className="card px-5 pt-2 pb-3">
        <div className="row hide-sm border-b border-mist py-3 text-xs font-semibold tracking-[1px] uppercase text-ink-2 md:grid-cols-[100px_minmax(0,1.6fr)_minmax(0,1fr)_130px] lg:grid-cols-[100px_minmax(0,1.6fr)_minmax(0,1fr)_120px_100px_110px_130px]">
          <span>{t.projects.code}</span><span>{t.projects.name}</span><span>{t.projects.client}</span>
          <span className="hide-md">{t.projects.format}</span><span className="hide-md">{t.projects.units}</span><span className="hide-md">{t.projects.form.target}</span>
          <span>{t.projects.status}</span>
        </div>
        {rows.length === 0 && <div className="py-4"><Empty>{t.projects.empty}</Empty></div>}
        {rows.map((p) => (
          <div key={p.id} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3.5 text-sm last:border-0 md:grid-cols-[100px_minmax(0,1.6fr)_minmax(0,1fr)_130px] lg:grid-cols-[100px_minmax(0,1.6fr)_minmax(0,1fr)_120px_100px_110px_130px]">
            <div className="min-w-0 md:contents">
              <Link href={`/clients/${p.client_id}#p-${p.id}`} className="font-semibold text-ink">{p.code}</Link>
              <span className="block min-w-0 break-words md:inline">{p.name}</span>
            </div>
            <Link href={`/clients/${p.client_id}`} className="hide-sm min-w-0 break-words text-ink">{p.client}</Link>
            <span className="hide-md">{p.product_format ? t.enums.productFormat[p.product_format as "capsule"] : "—"}</span>
            <span className="hide-md">{p.expected_units ? formatNumber(locale, p.expected_units) : "—"}</span>
            <span className="hide-md">{formatDate(locale, p.target_date)}</span>
            <Chip tone={projectTone(p.status)}>{t.enums.projectStatus[p.status as "inquiry"]}</Chip>
          </div>
        ))}
      </section>
    </div>
  );
}
