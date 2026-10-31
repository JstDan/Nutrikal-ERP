import Link from "next/link";
import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { formatDate, formatMoney, formatNumber } from "@/lib/i18n";
import { enquiryToClient, setEnquiryStatus } from "@/app/catalog-actions";

type Line = { code: string; name: string; name_bg: string | null; quantity: number; unit_price: number };
type Enquiry = {
  id: string; number: string; company: string; contact_name: string; email: string; phone: string | null; country_code: string | null;
  message: string | null; status: "new" | "handled" | "spam"; client_id: string | null; created_at: string; lines: Line[];
};

/** What clients sent from the open catalogue. Spam stays out of the way, nothing is deleted. */
export default async function CatalogEnquiriesPage() {
  const { user, locale, t } = await requireRole("admin", "sales");
  const C = t.catalog;
  const canWrite = !user.readOnly;
  const rows = await q<Enquiry>(user.id,
    `select e.id, e.number, e.company, e.contact_name, e.email::text, e.phone, e.country_code, e.message, e.status, e.client_id, e.created_at::text,
            coalesce((select jsonb_agg(jsonb_build_object('code', l.product_code, 'name', l.product_name, 'name_bg', p.name_bg, 'quantity', l.quantity, 'unit_price', l.unit_price) order by l.product_code)
                        from catalog_enquiry_lines l join catalog_products p on p.id = l.product_id where l.enquiry_id = e.id), '[]') as lines
       from catalog_enquiries e
      where e.status <> 'spam'
      order by e.status = 'new' desc, e.created_at desc
      limit 200`);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader crumb={<Link href="/catalog" className="text-ink-2">{C.title}</Link>} title={C.enquiries} subtitle={C.enquiriesNote} />
      {rows.length === 0 && <Empty>{C.noEnquiries}</Empty>}
      {rows.map((e) => (
        <section key={e.id} aria-label={e.number} className="card flex min-w-0 flex-col gap-3 p-5 text-sm">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-words font-semibold">{e.number} · {e.company}</span>
            <span className="flex items-center gap-2">
              <span className="text-xs text-ink-2">{formatDate(locale, e.created_at)}</span>
              <Chip tone={e.status === "new" ? "amber" : "green"}>{C.enquiryStatus[e.status]}</Chip>
            </span>
          </div>
          <p className="m-0 min-w-0 break-words text-ink-2">
            {[e.contact_name, e.email, e.phone, e.country_code].filter(Boolean).join(" · ")}
          </p>
          <div className="flex flex-col">
            {e.lines.map((l) => (
              <div key={l.code} className="row grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-mist py-2 last:border-0">
                <span className="min-w-0 break-words">{l.code} · {locale === "bg" && l.name_bg ? l.name_bg : l.name}</span>
                <span>{formatNumber(locale, l.quantity)}</span>
                <span className="font-semibold">{formatMoney(locale, l.unit_price, "EUR", 2)}</span>
              </div>
            ))}
          </div>
          {e.message && <p className="m-0 min-w-0 break-words whitespace-pre-wrap">{e.message}</p>}
          <div className="flex flex-wrap gap-2">
            {e.client_id
              ? <Link href={`/clients/${e.client_id}`} className="btn btn-outline">{C.openClient}</Link>
              : canWrite && (
                <form action={enquiryToClient}>
                  <input type="hidden" name="id" value={e.id} />
                  <button type="submit" className="btn btn-primary">{C.toClient}</button>
                </form>
              )}
            {canWrite && e.status === "new" && (
              <form action={setEnquiryStatus}>
                <input type="hidden" name="id" value={e.id} />
                <input type="hidden" name="status" value="handled" />
                <button type="submit" className="btn btn-outline">{C.markHandled}</button>
              </form>
            )}
            {canWrite && !e.client_id && (
              <form action={setEnquiryStatus}>
                <input type="hidden" name="id" value={e.id} />
                <input type="hidden" name="status" value="spam" />
                <button type="submit" className="btn btn-outline">{C.markSpam}</button>
              </form>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
