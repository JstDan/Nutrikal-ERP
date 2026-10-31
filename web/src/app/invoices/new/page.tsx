import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { createClientInvoice } from "@/app/batch-actions";

/** A new invoice without an order: services and anything else billed directly to a client. */
export default async function NewInvoicePage({ searchParams }: PageProps<"/invoices/new">) {
  const { user, t } = await requireRole("admin", "sales");
  const N = t.invoices.direct;
  const sp = await searchParams;
  const clients = await withUser(user.id, async (tx) => (
    await tx.query<{ id: string; legal_name: string; country_code: string }>(
      "select id, legal_name, country_code from clients where status <> 'inactive' order by lower(legal_name)")).rows);
  const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={N.title} subtitle={N.subtitle} crumb={<Link href="/invoices" className="text-ink-2">{t.invoices.title}</Link>} />
      <Card>
        <ActionForm action={createClientInvoice} submitLabel={N.create} resetOnSuccess={false}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="field md:col-span-2"><span>{t.invoices.client} *</span>
              <select name="client_id" required className="input" defaultValue={typeof sp.client === "string" ? sp.client : ""}>
                <option value="" disabled>—</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.legal_name} · {c.country_code}</option>)}
              </select>
            </label>
            <label className="field"><span>{N.vat}</span>
              <input name="vat_pct" type="number" min={0} max={100} step="any" className="input" aria-describedby="vat-hint" />
              <small id="vat-hint" className="text-xs text-ink-2">{N.vatHint}</small>
            </label>
            <label className="field"><span>{N.due}</span><input name="due_date" type="date" defaultValue={due} className="input" /></label>
            <label className="field"><span>{N.method}</span>
              <select name="method" className="input" defaultValue="bank">
                {(["bank", "cash", "card"] as const).map((m) => <option key={m} value={m}>{N.methods[m]}</option>)}
              </select>
            </label>
            <label className="field"><span>{N.ref}</span><input name="ref" className="input" /></label>
            <label className="field md:col-span-2"><span>{N.notes}</span><textarea name="notes" className="input" /></label>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
