import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { createOffer } from "@/app/actions";

type Version = { id: string; code: string; name: string; name_bg: string | null; version: number; client: string | null };

export default async function NewOfferPage({ searchParams }: PageProps<"/offers/new">) {
  const { user, locale, t } = await requireRole("admin", "sales");
  const sp = await searchParams;
  const f = t.offers.form;

  const { clients, projects, versions } = await withUser(user.id, async (tx) => ({
    clients: (await tx.query<{ id: string; code: string; legal_name: string }>(
      "select id, code, legal_name from clients where status <> 'inactive' order by legal_name")).rows,
    projects: (await tx.query<{ id: string; code: string; name: string; client: string }>(
      `select p.id, p.code, p.name, c.legal_name as client from projects p join clients c on c.id = p.client_id
        where p.status not in ('completed', 'lost') order by p.code desc`)).rows,
    versions: (await tx.query<Version>(
      `select v.id, f.code, f.name, f.name_bg, v.version, c.legal_name as client
         from formula_versions v join formulas f on f.id = v.formula_id left join clients c on c.id = f.client_id
        where v.status = 'approved' and f.is_active and f.servings_per_pack is not null
        order by c.legal_name nulls last, f.code`)).rows,
  }));
  const pre = (key: string, list: { id: string }[]) => (typeof sp[key] === "string" && list.some((x) => x.id === sp[key]) ? (sp[key] as string) : "");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={f.title} crumb={<Link href="/offers" className="text-ink-2">{t.offers.title}</Link>} />
      <Card>
        <ActionForm action={createOffer} submitLabel={f.submit} resetOnSuccess={false}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="field"><span>{f.client} *</span>
              <select name="client_id" required className="input" defaultValue={pre("client", clients)}>
                <option value="" disabled>{f.chooseClient}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.legal_name} · {c.code}</option>)}
              </select>
            </label>
            <label className="field"><span>{f.project}</span>
              <select name="project_id" className="input" defaultValue={pre("project", projects)}>
                <option value="">—</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name} · {p.client}</option>)}
              </select>
            </label>
            <label className="field md:col-span-2"><span>{f.formula} *</span>
              <select name="formula_version_id" required className="input" defaultValue="" aria-describedby="formula-hint">
                <option value="" disabled>{f.chooseFormula}</option>
                {[...new Set(versions.map((v) => v.client))].map((client) => (
                  <optgroup key={client ?? "stock"} label={client ?? t.formulas.stock}>
                    {versions.filter((v) => v.client === client).map((v) => (
                      <option key={v.id} value={v.id}>{v.code} v{v.version} · {locale === "bg" && v.name_bg ? v.name_bg : v.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <small id="formula-hint" className="text-xs text-ink-2">{f.formulaHint}</small>
            </label>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
