import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { fmt, formatDate, formatMoney, formatNumber, formatQty } from "@/lib/i18n";
import { Card, Chip, Empty, Fact, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { StageTracker } from "@/components/stage-tracker";
import { clientTone, projectStage, projectTone } from "@/lib/status";
import { addActivity, addContact, createProject, setProjectStatus } from "@/app/actions";

type Client = {
  id: string; code: string; legal_name: string; trade_name: string | null; status: string; country_code: string;
  vat_number: string | null; company_id: string | null; address_line1: string | null; city: string | null; postal_code: string | null;
  billing_email: string | null; phone: string | null; preferred_locale: "bg" | "en"; currency: string;
  deposit_pct: string | null; balance_terms: "before_dispatch" | "net_days" | null; balance_net_days: number | null;
  credit_limit: string | null; notes: string | null; owner: string | null;
};
type Project = { id: string; code: string; name: string; product_format: string | null; status: string; expected_units: number | null; target_date: string | null };
type Reservation = { project_id: string; name: string; quantity: string; base_unit: string };
type Contact = { id: string; first_name: string; last_name: string | null; position: string | null; email: string | null; phone: string | null; is_primary: boolean };
type Activity = { id: string; type: string; subject: string; body: string | null; created_at: string; due_at: string | null; done_at: string | null; project_code: string | null };

const STATUSES = ["inquiry", "formulation", "offer", "order", "production", "completed", "on_hold", "lost"] as const;
const FORMATS = ["capsule", "tablet", "softgel", "powder", "sachet", "stick_pack", "liquid", "gummy", "bar", "other"] as const;

export default async function ClientPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  const { user, locale, t } = await requireStaff();
  const d = t.clients.detail;
  const canEdit = user.role === "admin" || user.role === "sales";

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const client = (await tx.query<Client>(
      `select c.*, c.deposit_pct::text, c.credit_limit::text, pr.full_name as owner
         from clients c left join profiles pr on pr.id = c.owner_id where c.id = $1`, [id])).rows[0];
    if (!client) return null;
    const settings = (await tx.query<{ default_deposit_pct: string | null; default_balance_terms: "before_dispatch" | "net_days"; default_balance_net_days: number | null }>(
      "select default_deposit_pct::text, default_balance_terms, default_balance_net_days from company_settings limit 1")).rows[0];
    const contacts = (await tx.query<Contact>("select * from contacts where client_id = $1 order by is_primary desc, first_name", [id])).rows;
    const projects = (await tx.query<Project>(
      `select id, code, name, product_format, status, expected_units, target_date::text from projects
        where client_id = $1 order by status in ('completed', 'lost'), created_at desc`, [id])).rows;
    const reservations = (await tx.query<Reservation>(
      `select r.project_id, i.name, sum(r.quantity)::text as quantity, i.base_unit
         from stock_reservations r join items i on i.id = r.item_id join projects p on p.id = r.project_id
        where p.client_id = $1 and r.status = 'active'
        group by r.project_id, i.name, i.base_unit order by i.name`, [id])).rows;
    const activities = (await tx.query<Activity>(
      `select a.id, a.type, a.subject, a.body, a.created_at::text, a.due_at::text, a.done_at::text, p.code as project_code
         from activities a left join projects p on p.id = a.project_id
        where a.client_id = $1 order by a.created_at desc limit 30`, [id])).rows;
    return { client, settings, contacts, projects, reservations, activities };
  });
  if (!data) notFound();
  const { client: c, settings, contacts, projects, reservations, activities } = data;

  const deposit = c.deposit_pct ?? settings?.default_deposit_pct;
  const balance = c.balance_terms ?? settings?.default_balance_terms ?? "before_dispatch";
  const netDays = c.balance_net_days ?? settings?.default_balance_net_days ?? 0;
  const balanceText = fmt(t.enums.balanceTerms[balance], { days: netDays });
  const termsText = deposit != null ? fmt(d.depositThen, { pct: formatNumber(locale, deposit), balance: balanceText }) : balanceText;
  const usingDefaults = c.deposit_pct == null && c.balance_terms == null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/clients" className="text-ink-2">{t.clients.title}</Link> / {c.code}</>}
        title={c.legal_name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Chip tone={clientTone(c.status)}>{t.enums.clientStatus[c.status as "lead"]}</Chip>
            <span>{c.code} · {c.country_code}{c.vat_number ? ` · ${t.clients.detail.vat} ${c.vat_number}` : ""}{c.owner ? ` · ${t.clients.owner}: ${c.owner}` : ""}</span>
          </span>
        }
        actions={canEdit && (
          <>
            <a href="#log-activity" className="btn btn-outline">{d.logActivity}</a>
            <a href="#new-project" className="btn btn-primary">{d.newProject}</a>
          </>
        )}
      />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        {/* ------------------------------------------------ left column */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={d.companyTerms} id="terms-h">
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Fact label={d.registry}>{c.company_id ?? "—"}</Fact>
              <Fact label={d.currency}>{c.currency}</Fact>
              <Fact label={d.paymentTerms}>{termsText}{usingDefaults && <span className="text-ink-2"> ({d.defaultTerms})</span>}</Fact>
              <Fact label={d.creditLimit}>{c.credit_limit ? formatMoney(locale, c.credit_limit, c.currency) : "—"}</Fact>
              <Fact label={d.documentsIn}>{t.enums.locale[c.preferred_locale]}</Fact>
              <Fact label={t.clients.form.billingEmail}>{c.billing_email ?? "—"}</Fact>
            </div>
            {(c.address_line1 || c.city) && (
              <p className="m-0 text-[13px] text-ink-2">{[c.address_line1, [c.postal_code, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</p>
            )}
            {c.notes && <p className="m-0 text-sm whitespace-pre-line">{c.notes}</p>}
          </Card>

          <Card title={d.contacts} id="contacts-h">
            {contacts.length === 0 && <Empty>{d.noContacts}</Empty>}
            {contacts.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-mist text-[13px] font-bold">
                  {(p.first_name[0] ?? "") + (p.last_name?.[0] ?? "")}
                </span>
                <div className="min-w-0 text-sm">
                  <div className="font-semibold">
                    {p.first_name} {p.last_name}
                    {p.is_primary && <span className="ml-2 text-[11px] font-semibold tracking-[1px] uppercase text-green-ink">{d.primary}</span>}
                  </div>
                  <div className="text-ink-2 break-all">{[p.position, p.email, p.phone].filter(Boolean).join(" · ")}</div>
                </div>
              </div>
            ))}
            {canEdit && (
              <details className="border-t border-mist pt-3">
                <summary className="cursor-pointer text-xs font-semibold tracking-[2px] uppercase">{d.addContact}</summary>
                <ActionForm action={addContact} submitLabel={t.common.add} className="mt-4">
                  <input type="hidden" name="client_id" value={c.id} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="field"><span>{d.firstName} *</span><input name="first_name" required className="input" /></label>
                    <label className="field"><span>{d.lastName}</span><input name="last_name" className="input" /></label>
                    <label className="field"><span>{d.position}</span><input name="position" className="input" /></label>
                    <label className="field"><span>{d.email}</span><input name="email" type="email" className="input" /></label>
                    <label className="field sm:col-span-2"><span>{t.clients.form.phone}</span><input name="phone" type="tel" className="input" /></label>
                  </div>
                </ActionForm>
              </details>
            )}
          </Card>
        </div>

        {/* ----------------------------------------------- right column */}
        <div className="flex min-w-0 flex-col gap-4">
          {projects.length === 0 && <Card title={d.projects} id="projects-h"><Empty>{d.noProjects}</Empty></Card>}
          {projects.map((p) => {
            const res = reservations.filter((r) => r.project_id === p.id);
            return (
              <Card
                key={p.id}
                id={`p-${p.id}`}
                title={<>{p.code} · {p.name}</>}
                action={<Chip tone={projectTone(p.status)}>{t.enums.projectStatus[p.status as "inquiry"]}</Chip>}
              >
                <StageTracker stage={projectStage(p.status, res.length > 0)} t={t} />
                <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
                  <Fact label={t.projects.format}>{p.product_format ? t.enums.productFormat[p.product_format as "capsule"] : "—"}</Fact>
                  <Fact label={t.projects.units}>{p.expected_units ? formatNumber(locale, p.expected_units) : "—"}</Fact>
                  <Fact label={t.projects.form.target}>{formatDate(locale, p.target_date)}</Fact>
                </div>
                <div className="flex flex-col gap-1.5 rounded bg-canvas px-4 py-3 text-sm">
                  <span className="label">{d.reserved}</span>
                  {res.length === 0 ? (
                    <span className="text-ink-2">{d.noReservations}</span>
                  ) : (
                    res.map((r) => (
                      <span key={r.name} className="flex flex-wrap justify-between gap-2">
                        <span>{r.name}</span>
                        <span className="font-semibold">{formatQty(locale, r.quantity, r.base_unit)}</span>
                      </span>
                    ))
                  )}
                </div>
                {canEdit && (
                  <form action={setProjectStatus} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="project_id" value={p.id} />
                    <label className="field min-w-[180px] flex-[0_1_240px]">
                      <span className="sr-only">{t.projects.status}</span>
                      <select name="status" defaultValue={p.status} className="input" aria-label={`${t.projects.status} ${p.code}`}>
                        {STATUSES.map((s) => <option key={s} value={s}>{t.enums.projectStatus[s]}</option>)}
                      </select>
                    </label>
                    <button type="submit" className="btn btn-outline">{t.common.save}</button>
                  </form>
                )}
              </Card>
            );
          })}

          {canEdit && (
            <Card title={d.newProject} id="new-project">
              <ActionForm action={createProject} submitLabel={t.projects.form.submit} resetOnSuccess={false}>
                <input type="hidden" name="client_id" value={c.id} />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="field md:col-span-2"><span>{t.projects.form.name} *</span><input name="name" required className="input" /></label>
                  <label className="field"><span>{t.projects.form.format}</span>
                    <select name="product_format" className="input" defaultValue="capsule">
                      {FORMATS.map((f) => <option key={f} value={f}>{t.enums.productFormat[f]}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>{t.projects.form.units}</span><input name="expected_units" type="number" min={1} className="input" /></label>
                  <label className="field"><span>{t.projects.form.target}</span><input name="target_date" type="date" className="input" /></label>
                  <label className="flex min-h-11 items-center gap-3 self-end text-sm font-semibold">
                    <input name="nda_signed" type="checkbox" className="h-5 w-5 accent-ink" /> {t.projects.form.nda}
                  </label>
                  <label className="field md:col-span-2"><span>{t.projects.form.description}</span><textarea name="description" className="input" /></label>
                </div>
              </ActionForm>
            </Card>
          )}

          <Card title={d.activity} id="log-activity">
            {canEdit && (
              <ActionForm action={addActivity} submitLabel={d.logActivity}>
                <input type="hidden" name="client_id" value={c.id} />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
                  <label className="field"><span>{d.type}</span>
                    <select name="type" className="input" defaultValue="note">
                      {(["note", "call", "email", "meeting", "task"] as const).map((a) => <option key={a} value={a}>{t.enums.activityType[a]}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>{d.subject} *</span><input name="subject" required className="input" /></label>
                  <label className="field"><span>{t.projects.code}</span>
                    <select name="project_id" className="input" defaultValue="">
                      <option value="">—</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>{d.due} ({t.common.optional})</span><input name="due_at" type="datetime-local" className="input" /></label>
                  <label className="field md:col-span-2"><span>{d.details}</span><textarea name="body" className="input" /></label>
                </div>
              </ActionForm>
            )}
            <div className="flex flex-col gap-3 border-t border-mist pt-4">
              {activities.length === 0 && <Empty>{d.noActivity}</Empty>}
              {activities.map((a) => (
                <div key={a.id} className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 text-sm">
                  <span className="text-ink-2">{formatDate(locale, a.created_at, { day: "2-digit", month: "short" })}</span>
                  <span className="min-w-0">
                    <span className="font-semibold">{a.subject}</span>
                    <span className="text-ink-2"> · {t.enums.activityType[a.type as "note"]}{a.project_code ? ` · ${a.project_code}` : ""}{a.type === "task" && a.due_at && !a.done_at ? ` · ${d.due} ${formatDate(locale, a.due_at, { day: "numeric", month: "short" })}` : ""}{a.done_at ? " · ✓" : ""}</span>
                    {a.body && <span className="block whitespace-pre-line text-ink-2">{a.body}</span>}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
