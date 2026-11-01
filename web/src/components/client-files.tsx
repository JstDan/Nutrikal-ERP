import { q } from "@/lib/db/engine";
import { formatDate, formatNumber, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { ActionForm } from "@/components/action-form";
import { Card, Empty } from "@/components/ui";
import { deleteClientFile, shareClientFile, uploadClientFile } from "@/app/file-actions";

type Row = { id: string; file_name: string; size_bytes: string; note: string | null; created_at: string; author: string | null; uploaded_by: string | null; shared_with_client: boolean };

/** Designs and other files of a client; on an order, the files of that order. */
export async function ClientFiles({ clientId, orderId, userId, isAdmin, canShare, locale, t }: {
  clientId: string; orderId?: string; userId: string; isAdmin: boolean; canShare: boolean; locale: Locale; t: Dict;
}) {
  const F = t.clientFiles;
  const rows = await q<Row>(userId,
    `select f.id, f.file_name, f.size_bytes::text, f.note, f.created_at::text, f.uploaded_by, f.shared_with_client, p.full_name as author
       from client_files f left join profiles p on p.id = f.uploaded_by
      where f.client_id = $1 and ($2::uuid is null or f.order_id = $2) order by f.created_at desc limit 50`, [clientId, orderId ?? null]);
  return (
    <Card title={F.title} id="files-h">
      {rows.length === 0 && <Empty>{F.empty}</Empty>}
      {rows.map((x) => (
        <div key={x.id} className="flex flex-wrap items-center justify-between gap-x-3 border-b border-mist py-1 text-sm last:border-0">
          <a href={`/files/client/${x.id}`} className="flex min-h-11 min-w-0 flex-col justify-center text-ink">
            <span className="font-semibold break-all">{x.file_name}</span>
            <span className="text-xs text-ink-2">
              {formatDate(locale, x.created_at.slice(0, 10))} · {formatNumber(locale, Number(x.size_bytes) / 1048576, 1)} MB{x.author ? ` · ${x.author}` : ""}{x.note ? ` · ${x.note}` : ""}{x.shared_with_client ? ` · ${t.portal.staff.shared}` : ""}
            </span>
          </a>
          {canShare && (
            <form action={shareClientFile}>
              <input type="hidden" name="id" value={x.id} />
              <input type="hidden" name="on" value={x.shared_with_client ? "" : "on"} />
              <button type="submit" className="min-h-11 text-xs text-ink underline">{x.shared_with_client ? t.portal.staff.unshare : t.portal.staff.share}</button>
            </form>
          )}
          {(isAdmin || x.uploaded_by === userId) && (
            <form action={deleteClientFile}>
              <input type="hidden" name="id" value={x.id} />
              <button type="submit" className="min-h-11 text-xs text-ink-2 underline">{F.delete}</button>
            </form>
          )}
        </div>
      ))}
      <ActionForm action={uploadClientFile} submitLabel={F.upload}>
        <input type="hidden" name="client_id" value={clientId} />
        {orderId && <input type="hidden" name="order_id" value={orderId} />}
        <label className="field"><span>{F.file} *</span><input name="file" type="file" required className="input" /></label>
        <label className="field"><span>{F.note}</span><input name="note" className="input" /></label>
      </ActionForm>
    </Card>
  );
}
