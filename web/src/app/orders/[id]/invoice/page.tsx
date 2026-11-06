import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt } from "@/lib/i18n";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { openOrderInvoice } from "@/app/actions";

const PURPOSES = ["advance", "final", "full"] as const;

/**
 * A direct link to the invoice of an order (?purpose=advance|final|full), e.g. from Nutri AI:
 * opens the invoice when it exists, else one click makes the draft. Opening the link changes nothing.
 */
export default async function OrderInvoicePage({ params, searchParams }: PageProps<"/orders/[id]/invoice">) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, t } = await requireRole("admin", "sales");
  const purpose = PURPOSES.find((p) => p === sp.purpose);
  if (!purpose || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [order] = await q<{ code: string; invoice_id: string | null }>(user.id,
    `select so.code, (select i.id from invoices i where i.order_id = so.id and i.kind = 'invoice' and i.purpose = $2) as invoice_id
       from sales_orders so where so.id = $1`, [id, purpose]);
  if (!order) notFound();
  if (order.invoice_id) redirect(`/invoices/${order.invoice_id}`);
  const S = t.orders.invoiceStart;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={fmt(S.title, { kind: S[purpose], code: order.code })}
        crumb={<Link href={`/orders/${id}`} className="text-ink-2">{S.back}</Link>} />
      <Card>
        <ActionForm action={openOrderInvoice} submitLabel={S.make} resetOnSuccess={false}>
          <input type="hidden" name="order_id" value={id} />
          <input type="hidden" name="purpose" value={purpose} />
          <p className="m-0 text-sm text-ink-2">{S.note}</p>
        </ActionForm>
      </Card>
    </div>
  );
}
