import { deleteDeliveryFile } from "@/app/actions";
import { formatDate, type Locale } from "@/lib/i18n";

export type DeliveryFile = {
  id: string; file_name: string | null; content_type: string | null; kind: string; uploaded_at: string; can_delete?: boolean;
};

/** Waybill photos and documents of a delivery or lot; each opens full size. */
export function FileGallery({ files, locale, empty, removeLabel }: { files: DeliveryFile[]; locale: Locale; empty: string; removeLabel?: string }) {
  if (files.length === 0) return <p className="m-0 text-sm text-ink-2">{empty}</p>;
  return (
    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3 p-0">
      {files.map((f) => (
        <li key={f.id} className="flex min-w-0 flex-col gap-1">
          <a href={`/files/delivery/${f.id}`} target="_blank" rel="noopener" className="block overflow-hidden rounded border border-line bg-canvas">
            {f.content_type?.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element -- private files behind a permission check, not optimisable
              <img src={`/files/delivery/${f.id}`} alt={f.file_name ?? ""} loading="lazy" className="block aspect-square w-full object-cover" />
            ) : (
              <span className="grid aspect-square w-full place-items-center text-sm font-semibold text-ink">PDF</span>
            )}
          </a>
          <span className="truncate text-xs text-ink-2" title={f.file_name ?? ""}>{formatDate(locale, f.uploaded_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          {f.can_delete && removeLabel && (
            <form action={deleteDeliveryFile}>
              <input type="hidden" name="file_id" value={f.id} />
              <button type="submit" className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-red-ink underline">{removeLabel}</button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
