import Link from "next/link";
import { ClientFiles } from "@/components/client-files";
import { ClientMessages } from "@/components/client-messages";
import { ClientPortalAccess } from "@/components/client-portal-access";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireStaff } from "@/lib/session";
import { fmt, formatDate, formatMoney, formatNumber, formatPrice } from "@/lib/i18n";
import { Card, Chip, Empty, Fact, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { clientTone, orderTone } from "@/lib/status";
import { ClientFields } from "@/components/client-fields";
import { DeleteClient } from "@/components/delete-client";
import { addActivity, addContact, updateClient } from "@/app/actions";

type Client = {
  id: string; code: string; legal_name: string; trade_name: string | null; status: string; country_code: string;
  vat_number: string | null; company_id: string | null; address_line1: string | null; city: string | null; postal_code: string | null;
  billing_email: string | null; phone: string | null; preferred_locale: "bg" | "en"; currency: string;
  deposit_pct: string | null; balance_terms: "before_dispatch" | "net_days" | null; balance_net_days: number | null;
  credit_limit: string | null; notes: string | null; owner: string | null; owner_id: string | null; registration_address: string | null; website: string | null;
};
type Order = { id: string; code: string; status: string; total_packs: number; products: string | null };
type Contact = { id: string; first_name: string; last_name: string | null; position: string | null; email: string | null; phone: string | null; is_primary: boolean };
type ClientInvoice = { id: string; number: string | null; status: string; total: string | null; currency: string; issue_date: string | null };
type Activity = { id: string; type: string; subject: string; body: string | null; created_at: string; due_at: string | null; done_at: string | null; project_code: string | null };


export default async function ClientPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  const { user, locale, t } = await requireStaff();
  const d = t.clients.detail;
  const canEdit = user.role === "admin" || user.role === "sales";
  // Admin deletes any client; Sales and the bookkeeper only their own (delete_client decides; owner, Nov 2026)
  const mayDelete = (owner: string | null) => user.role === "admin" || ((user.role === "sales" || user.role === "bookkeeper") && owner === user.id);

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const client = (await tx.query<Client>(
      `select c.*, c.deposit_pct::text, c.credit_limit::text, pr.full_name as owner
         from clients c left join profiles pr on pr.id = c.owner_id where c.id = $1`, [id])).rows[0];
    if (!client) return null;
    const settings = (await tx.query<{ default_deposit_pct: string | null; default_balance_terms: "before_dispatch" | "net_days"; default_balance_net_days: number | null }>(
      "select default_deposit_pct::text, default_balance_terms, default_balance_net_days from company_settings limit 1")).rows[0];
    const contacts = (await tx.query<Contact>("select * from contacts where client_id = $1 order by is_primary desc, first_name", [id])).rows;
    const product = locale === "bg" ? "coalesce(l.product_bg, l.product)" : "l.product";
    const orders = (await tx.query<Order>(
      `select o.id, o.code, o.status, o.total_packs,
              (select string_agg(${product}, ', ' order by l.sort_order) from sales_order_line_overview l where l.order_id = o.id and l.kind <> 'service') as products
         from sales_order_overview o where o.client_id = $1
        order by o.status in ('closed', 'cancelled'), o.code desc`, [id])).rows;
    const activities = (await tx.query<Activity>(
      `select a.id, a.type, a.subject, a.body, a.created_at::text, a.due_at::text, a.done_at::text, p.code as project_code
         from activities a left join projects p on p.id = a.project_id
        where a.client_id = $1 order by a.created_at desc limit 30`, [id])).rows;
    // Mail with the client is read only through the AI assistant (owner, Nov 2026)
    const invoices = canEdit
      ? (await tx.query<ClientInvoice>(
          `select id, number, status, total::text, currency, issue_date::text from invoices
            where client_id = $1 and kind = 'invoice' order by status = 'issued', number desc nulls first limit 20`, [id])).rows
      : [];
    return { client, settings, contacts, orders, activities, invoices };
  });
  if (!data) notFound();
  const { client: c, settings, contacts, orders, activities, invoices } = data;

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
              {user.access !== "designer" && (
                <>
                  <Fact label={d.paymentTerms}>{termsText}{usingDefaults && <span className="text-ink-2"> ({d.defaultTerms})</span>}</Fact>
                  <Fact label={d.creditLimit}>{c.credit_limit ? formatMoney(locale, c.credit_limit, c.currency) : "—"}</Fact>
                </>
              )}
              <Fact label={d.documentsIn}>{t.enums.locale[c.preferred_locale]}</Fact>
              <Fact label={t.clients.form.billingEmail}>{c.billing_email ?? "—"}</Fact>
            </div>
            {(c.address_line1 || c.city) && (
              <p className="m-0 text-[13px] text-ink-2">{[c.address_line1, [c.postal_code, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</p>
            )}
            {c.registration_address && (
              <p className="m-0 text-[13px] text-ink-2">{t.clients.form.registrationAddress}: {c.registration_address}</p>
            )}
            {(c.phone || c.website) && <p className="m-0 text-[13px] text-ink-2 break-all">{[c.phone, c.website].filter(Boolean).join(" · ")}</p>}
            {c.notes && <p className="m-0 text-sm whitespace-pre-line">{c.notes}</p>}
            {canEdit && (
              <details className="border-t border-mist pt-3">
                <summary className="cursor-pointer text-xs font-semibold tracking-[2px] uppercase">{d.editClient}</summary>
                <ActionForm action={updateClient} submitLabel={t.common.save} resetOnSuccess={false} className="mt-4">
                  <input type="hidden" name="client_id" value={c.id} />
                  <ClientFields t={t} locale={locale} c={c} />
                </ActionForm>
              </details>
            )}
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
                    <label className="field sm:col-span-2"><span>{t.clients.form.contactName} *</span><input name="first_name" required className="input" /></label>
                    <label className="field"><span>{d.email} *</span><input name="email" type="email" required className="input" /></label>
                    <label className="field"><span>{t.clients.form.phone}</span><input name="phone" type="tel" className="input" /></label>
                  </div>
                </ActionForm>
              </details>
            )}
          </Card>

          {mayDelete(c.owner_id) && <DeleteClient clientId={c.id} name={c.legal_name} labels={t.clients.delete} />}
        </div>

        {/* ----------------------------------------------- right column */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={t.nav.orders} id="orders-h" action={canEdit ? <Link href={`/orders/new?client=${c.id}`} className="text-ink">+ {t.orders.newOrder}</Link> : <Link href="/orders" className="text-ink">{t.nav.orders} →</Link>}>
            {orders.length === 0 && <Empty>{t.orders.empty}</Empty>}
            {orders.map((o) => (
              <div key={o.id} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-3 text-sm last:border-0 md:grid-cols-[110px_minmax(0,1fr)_100px_auto]">
                <Link href={`/orders/${o.id}`} className="font-semibold text-ink">{o.code}</Link>
                <span className="hide-sm min-w-0 break-words">{o.products ?? "—"}</span>
                <span className="hide-sm">{formatNumber(locale, o.total_packs)}</span>
                <Chip tone={orderTone(o.status)}>{t.enums.orderStatus[o.status as "draft"]}</Chip>
              </div>
            ))}
          </Card>

          {canEdit && (
            <Card title={t.invoices.title} id="invoices-h" action={<Link href={`/invoices/new?client=${c.id}`} className="text-ink">+ {t.invoices.direct.title}</Link>}>
              {invoices.length === 0 && <Empty>{t.invoices.empty}</Empty>}
              {invoices.map((i) => (
                <Link key={i.id} href={`/invoices/${i.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 border-b border-mist text-sm text-ink no-underline last:border-0">
                  <span className="font-semibold">{i.number ?? t.invoices.statusDraft}</span>
                  <span className="text-ink-2">{formatDate(locale, i.issue_date)}{i.total ? ` · ${formatPrice(locale, i.total, i.currency)}` : ""}</span>
                </Link>
              ))}
            </Card>
          )}

          <ClientFiles clientId={c.id} userId={user.id} isAdmin={user.role === "admin"} canShare={!user.readOnly && (user.role === "admin" || user.role === "sales")} locale={locale} t={t} />

          {(user.role === "admin" || user.role === "sales") && (
            <>
              <ClientPortalAccess clientId={c.id} userId={user.id} isAdmin={user.access === "admin"} t={t} />
              <ClientMessages clientId={c.id} userId={user.id} canWrite={!user.readOnly} locale={locale} t={t} />
            </>
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
