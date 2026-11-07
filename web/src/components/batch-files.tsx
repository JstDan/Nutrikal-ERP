import { fmt, formatDate, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { q } from "@/lib/db/engine";
import { deleteBatchFile, shareBatchFile, uploadBatchFiles } from "@/app/batch-actions";
import { ActionForm } from "@/components/action-form";
import { PhotoInput } from "@/components/photo-input";

type Row = { id: string; name: string; mime: string | null; note: string | null; shared_with_client: boolean; uploaded_by: string; created_at: string; by_name: string | null };

/**
 * Photos and files of a batch: a gallery, upload (photos made smaller in the browser), share with the client
 * (team) and delete (own; Admin any). The partner sees it for its released batches; row-level security decides.
 */
export async function BatchFiles({ moId, userId, isAdmin, canShare, canUpload, locale, t }: {
  moId: string; userId: string; isAdmin: boolean; canShare: boolean; canUpload: boolean; locale: Locale; t: Dict;
}) {
  const B = t.batchFiles;
  const files = await q<Row>(userId,
    `select f.id, f.name, f.mime, f.note, f.shared_with_client, f.uploaded_by, f.created_at::text,
            (select full_name from board_people() p where p.id = f.uploaded_by) as by_name
       from batch_files f where f.mo_id = $1 order by f.created_at desc`, [moId]).catch(() => [] as Row[]);
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-ink-2">{B.hint}</p>
      {files.length === 0 ? <p className="m-0 text-sm text-ink-2">{B.empty}</p> : (
        <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(150px, 100%), 1fr))" }}>
          {files.map((f) => (
            <li key={f.id} className="flex min-w-0 flex-col gap-1">
              <a href={`/files/batch/${f.id}`} target="_blank" rel="noopener" className="relative block overflow-hidden rounded-md border border-line bg-canvas">
                {f.mime?.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private files behind a permission check
                  <img src={`/files/batch/${f.id}`} alt={f.name} loading="lazy" className="block aspect-square w-full object-cover" />
                ) : <span className="grid aspect-square w-full place-items-center text-sm font-semibold text-ink">PDF</span>}
                {f.shared_with_client && <span className="absolute top-1.5 left-1.5 rounded-full bg-green px-2 py-0.5 text-[11px] font-semibold text-white">{B.shared}</span>}
              </a>
              <span className="truncate text-xs font-semibold" title={f.name}>{f.name}</span>
              {f.note && <span className="text-xs break-words text-ink-2">{f.note}</span>}
              <span className="text-xs text-ink-2">{fmt(B.by, { name: f.by_name ?? "—", date: formatDate(locale, f.created_at, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) })}</span>
              <span className="flex flex-wrap gap-x-3">
                {canShare && (
                  <form action={shareBatchFile}>
                    <input type="hidden" name="file_id" value={f.id} />
                    <input type="hidden" name="on" value={f.shared_with_client ? "0" : "1"} />
                    <button type="submit" className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-ink underline">{f.shared_with_client ? B.unshare : B.share}</button>
                  </form>
                )}
                {(isAdmin || f.uploaded_by === userId) && (
                  <form action={deleteBatchFile}>
                    <input type="hidden" name="file_id" value={f.id} />
                    <button type="submit" className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-red-ink underline">{B.remove}</button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <ActionForm action={uploadBatchFiles} submitLabel={B.upload}>
          <input type="hidden" name="mo_id" value={moId} />
          <PhotoInput name="photos" label={B.photos} hint={B.photosHint} preparing={B.preparing} ready={B.ready} error={B.error} required />
          <label className="field"><span>{B.note}</span><input name="note" maxLength={500} className="input" /></label>
        </ActionForm>
      )}
    </div>
  );
}
