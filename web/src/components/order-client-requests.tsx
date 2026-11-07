import { fmt, formatDate, formatNumber, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { q } from "@/lib/db/engine";
import { declineReorder, makeOrderFromReorder, sendLabelForApproval } from "@/app/client-request-actions";
import { ActionForm } from "@/components/action-form";
import { Fold } from "@/components/ui";

type Reorder = { id: string; lines: { description: string; quantity: number }[]; note: string | null; status: string; asked_at: string; reason: string | null; new_order_id: string | null; new_code: string | null };
type Approval = { id: string; file_name: string; status: string; note: string | null; client_comment: string | null; requested_at: string; decided_at: string | null; decided_name: string | null };

/** What the client asked for in the customer panel on this order: orders again, and the labels sent for its approval. */
export async function OrderClientRequests({ orderId, clientId, userId, canHandle, canSendLabels, locale, t }: {
  orderId: string; clientId: string; userId: string; canHandle: boolean; canSendLabels: boolean; locale: Locale; t: Dict;
}) {
  const R = t.reorders;
  const A = t.labelApproval;
  const reorders = canHandle ? await q<Reorder>(userId,
    `select r.id, r.lines, r.note, r.status, r.asked_at::text, r.reason, r.new_order_id, so.code as new_code
       from client_reorders r left join sales_orders so on so.id = r.new_order_id
      where r.source_order_id = $1 order by r.asked_at desc`, [orderId]) : [];
  const approvals = await q<Approval>(userId,
    `select a.id, f.file_name, a.status, a.note, a.client_comment, a.requested_at::text, a.decided_at::text, a.decided_name
       from label_approvals a join client_files f on f.id = a.client_file_id where a.order_id = $1 order by a.requested_at desc`, [orderId]).catch(() => [] as Approval[]);
  const files = canSendLabels ? await q<{ id: string; file_name: string }>(userId,
    "select id, file_name from client_files where client_id = $1 order by (order_id = $2) desc nulls last, created_at desc limit 100", [clientId, orderId]).catch(() => []) : [];
  const newOnes = reorders.filter((r) => r.status === "new").length;

  return (
    <>
      {reorders.length > 0 && (
        <Fold title={R.title} note={newOnes ? String(newOnes) : undefined} open={newOnes > 0}>
          {reorders.map((r) => (
            <div key={r.id} className="flex flex-col gap-2 border-b border-mist pb-3 text-sm last:border-0">
              <span className="break-words font-semibold">{r.lines.map((l) => fmt(R.lines, { qty: formatNumber(locale, Number(l.quantity)), name: l.description })).join(", ")}</span>
              <span className="text-xs text-ink-2">{fmt(R.asked, { date: formatDate(locale, r.asked_at) })}{r.note ? ` · ${r.note}` : ""}</span>
              {r.status === "done" && r.new_order_id && <a href={`/orders/${r.new_order_id}`} className="font-semibold text-green-ink underline">{fmt(R.made, { code: r.new_code ?? "" })}</a>}
              {r.status === "declined" && <span className="text-ink-2">{fmt(R.declined, { reason: r.reason ?? "" })}</span>}
              {r.status === "new" && (
                <div className="flex flex-wrap items-end gap-3">
                  <ActionForm action={makeOrderFromReorder} submitLabel={R.make} resetOnSuccess={false}>
                    <input type="hidden" name="request_id" value={r.id} />
                  </ActionForm>
                  <details>
                    <summary className="btn btn-outline cursor-pointer list-none">{R.decline}</summary>
                    <div className="mt-2 max-w-[420px]">
                      <ActionForm action={declineReorder} submitLabel={R.decline} resetOnSuccess={false}>
                        <input type="hidden" name="request_id" value={r.id} />
                        <input type="hidden" name="order_id" value={orderId} />
                        <label className="field"><span>{R.reason} *</span><input name="reason" required maxLength={500} className="input" /></label>
                      </ActionForm>
                    </div>
                  </details>
                </div>
              )}
            </div>
          ))}
        </Fold>
      )}

      {(approvals.length > 0 || canSendLabels) && (
        <Fold title={A.title} note={approvals.length ? String(approvals.length) : undefined} open={approvals.some((a) => a.status === "changes")}>
          {approvals.length === 0 && <p className="m-0 text-sm text-ink-2">{A.none}</p>}
          {approvals.map((a) => (
            <div key={a.id} className="flex flex-col gap-1 border-b border-mist pb-2 text-sm last:border-0">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold break-all">{a.file_name}</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${a.status === "approved" ? "bg-green-tint text-green-ink" : a.status === "changes" ? "bg-amber-tint text-amber-ink" : "bg-neutral-tint text-ink"}`}>
                  {a.status === "approved" ? fmt(A.approved, { name: a.decided_name ?? "", date: formatDate(locale, a.decided_at) })
                    : a.status === "changes" ? fmt(A.changes, { name: a.decided_name ?? "", date: formatDate(locale, a.decided_at) }) : A.pending}
                </span>
              </span>
              {a.note && <span className="text-xs text-ink-2">{a.note}</span>}
              {a.client_comment && <span className="rounded-sm bg-amber-tint p-2 break-words">{fmt(A.comment, { comment: a.client_comment })}</span>}
            </div>
          ))}
          {canSendLabels && (files.length === 0 ? <p className="m-0 text-sm text-ink-2">{A.noFiles}</p> : (
            <ActionForm action={sendLabelForApproval} submitLabel={A.send}>
              <input type="hidden" name="order_id" value={orderId} />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="field"><span>{A.file} *</span>
                  <select name="file_id" required className="input" defaultValue="">
                    <option value="" disabled>—</option>
                    {files.map((f) => <option key={f.id} value={f.id}>{f.file_name}</option>)}
                  </select>
                </label>
                <label className="field"><span>{A.note}</span><input name="note" maxLength={2000} className="input" /></label>
              </div>
            </ActionForm>
          ))}
        </Fold>
      )}
    </>
  );
}
