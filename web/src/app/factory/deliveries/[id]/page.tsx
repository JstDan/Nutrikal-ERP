import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { formatDate, formatQty } from "@/lib/i18n";
import { Card, Chip, Fact, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { PhotoInput } from "@/components/photo-input";
import { FileGallery, type DeliveryFile } from "@/components/file-gallery";
import { receiveDelivery } from "@/app/actions";

type Delivery = {
  id: string; code: string; sku: string; name: string; name_bg: string | null; base_unit: string; supplier: string | null; quantity: string;
  received: string; remaining: string; expected_on: string | null; status: string; is_overdue: boolean; is_partial: boolean; location: string;
};
type DLot = { lot_number: string; quantity: string; received_on: string; qc_status: string };

/** One delivery to production: details, waybill photos and the receipt form. */
export default async function FactoryDeliveryPage({ params }: PageProps<"/factory/deliveries/[id]">) {
  const { id } = await params;
  const { user, locale, t } = await requireRole("production", "admin");
  const D = t.factory.deliveries;

  const data = await withUser(user.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const d = (await tx.query<Delivery>(
      `select id, code, sku, name, name_bg, base_unit, supplier, quantity::text, received::text, remaining::text, expected_on::text,
              status, is_overdue, is_partial, location
         from production_deliveries where id = $1`, [id])).rows[0];
    if (!d) return null;
    const files = (await tx.query<DeliveryFile>(
      `select id, file_name, content_type, kind, uploaded_at::text,
              (uploaded_by = auth.uid() and uploaded_at > now() - interval '24 hours') as can_delete
         from delivery_attachments where delivery_id = $1 order by uploaded_at`, [id])).rows;
    const lots = (await tx.query<DLot>(
      `select l.lot_number, m.quantity::text, l.received_on::text, l.qc_status
         from lots l join stock_movements m on m.lot_id = l.id and m.type = 'receipt'
        where l.expected_delivery_id = $1 order by l.lot_number`, [id])).rows;
    const photoRule = (await tx.query<{ on: boolean }>(
      "select require_waybill_photo as on from production_settings()")).rows[0]?.on ?? true;
    return { d, files, lots, photoRule };
  });
  if (!data) notFound();
  const { d, files, lots, photoRule } = data;
  const nm = locale === "bg" && d.name_bg ? d.name_bg : d.name;
  const qty = (n: string) => formatQty(locale, n, d.base_unit);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={<><Link href="/factory/deliveries" className="text-ink-2">{D.title}</Link> / {d.code}</>}
        title={nm}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Chip tone={d.status === "received" ? "green" : d.is_overdue ? "red" : d.is_partial ? "amber" : "neutral"}>
              {d.is_partial && d.status === "open" ? t.deliveries.partial : t.enums.productionDeliveryStatus[d.status as "open"]}
            </Chip>
            <span>{d.code} · {d.sku}</span>
          </span>
        }
      />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Fact label={D.supplier}>{d.supplier ?? "—"}</Fact>
              <Fact label={D.expected}>{formatDate(locale, d.expected_on)}</Fact>
              <Fact label={D.ordered}>{qty(d.quantity)}</Fact>
              <Fact label={D.received}>{qty(d.received)}</Fact>
              <Fact label={t.deliveries.location}>{d.location}</Fact>
            </div>
            {lots.length > 0 && (
              <div className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-semibold tracking-[1px] uppercase text-ink-2">{t.deliveries.lots}</span>
                {lots.map((l) => (
                  <span key={l.lot_number}>{l.lot_number} · {qty(l.quantity)} · {formatDate(locale, l.received_on)} · {t.enums.qcStatus[l.qc_status as "released"]}</span>
                ))}
              </div>
            )}
          </Card>
          <Card title={D.photos} id="photos-h">
            <FileGallery files={files} locale={locale} empty={D.noPhotos} removeLabel={D.remove} />
            {files.some((f) => f.can_delete) && <p className="m-0 text-xs text-ink-2">{D.removeNote}</p>}
          </Card>
        </div>

        {d.status === "open" && (
          <Card title={D.receive} id="receive-h">
            <p className="m-0 text-sm text-ink-2">{D.receiveNote}</p>
            <ActionForm action={receiveDelivery} submitLabel={D.submit}>
              <input type="hidden" name="delivery_id" value={d.id} />
              <PhotoInput name="photos" label={D.photos} hint={D.photosHint} required={photoRule}
                preparing={D.preparing} ready={D.ready} error={D.photoError} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="field"><span>{D.quantity} *</span>
                  <input name="quantity" type="number" min="0.0001" step="any" required defaultValue={Number(d.remaining) > 0 ? Number(d.remaining) : undefined} className="input" />
                </label>
                <label className="field"><span>{D.supplierLot}</span><input name="supplier_lot" className="input" /></label>
                <label className="field"><span>{D.manufacturedOn}</span><input name="manufactured_on" type="date" className="input" /></label>
                <label className="field"><span>{D.expiresOn}</span><input name="expires_on" type="date" className="input" /></label>
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="close" className="h-5 w-5" /> {D.close}
              </label>
            </ActionForm>
          </Card>
        )}
      </div>
    </div>
  );
}
