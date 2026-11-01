import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Empty } from "@/components/ui";
import { portalPost } from "@/app/portal/actions";
import { fmt, formatDate, formatPrice, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import type { PortalDocument, PortalInvoiceRow, PortalMessage } from "@/lib/portal";

const when = (locale: Locale, at: string) => `${formatDate(locale, at.slice(0, 10))} ${at.slice(11, 16)}`;

/** A conversation: from the client's side here, from the team's side in client-messages.tsx. */
export function PortalThread({ orderId, rows, locale, t }: { orderId: string | null; rows: PortalMessage[]; locale: Locale; t: Dict }) {
  const S = t.portal.support;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {rows.length === 0 && <Empty>{S.empty}</Empty>}
      {rows.map((m) => (
        <div key={m.id} className={`flex min-w-0 flex-col gap-0.5 ${m.from_client ? "items-end" : "items-start"}`}>
          <span className="text-xs text-ink-2">{m.from_client ? S.you : `${m.author || S.team} · ${S.team}`} · {when(locale, m.created_at)}</span>
          <p className={`m-0 max-w-[85%] min-w-0 rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap ${m.from_client ? "bg-ink text-white" : "bg-neutral-tint"}`}>{m.body}</p>
        </div>
      ))}
      <ActionForm action={portalPost} submitLabel={S.send}>
        {orderId && <input type="hidden" name="order_id" value={orderId} />}
        <label className="field"><span className="sr-only">{S.placeholder}</span>
          <textarea name="body" required maxLength={4000} rows={3} placeholder={S.placeholder} className="input w-full resize-y" />
        </label>
      </ActionForm>
    </div>
  );
}

export function DocumentList({ rows, showOrder, locale, t }: { rows: PortalDocument[]; showOrder: boolean; locale: Locale; t: Dict }) {
  const D = t.portal.docs;
  if (rows.length === 0) return <Empty>{D.empty}</Empty>;
  return rows.map((d) => (
    <a key={`${d.kind}-${d.id}`} href={`/portal/${d.kind === "coa" ? "coa" : "files"}/${d.id}`}
      className="flex min-h-11 min-w-0 flex-col justify-center border-b border-mist py-1.5 text-sm text-ink no-underline last:border-0 hover:underline">
      <span className="font-semibold break-all">{d.kind === "coa" ? fmt(D.coa, { lot: d.name }) : d.name}</span>
      <span className="text-xs text-ink-2">
        {[showOrder ? (d.order_code ? fmt(D.order, { code: d.order_code }) : D.general) : null, d.shared_at ? formatDate(locale, d.shared_at.slice(0, 10)) : null, d.note].filter(Boolean).join(" · ")}
      </span>
    </a>
  ));
}

export function InvoiceList({ rows, locale, t }: { rows: PortalInvoiceRow[]; locale: Locale; t: Dict }) {
  const I = t.portal.invoices;
  if (rows.length === 0) return <Empty>{I.empty}</Empty>;
  return rows.map((x) => {
    const open = Number(x.open_amount ?? 0);
    return (
      <Link key={x.id} href={`/portal/invoices/${x.id}`} className="grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-mist py-1.5 text-sm text-ink no-underline last:border-0 hover:underline">
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold break-words">{I.kinds[x.kind]} {x.number}</span>
          <span className="text-xs text-ink-2">{[formatDate(locale, x.issue_date), x.order_code, x.due_date ? `${I.due}: ${formatDate(locale, x.due_date)}` : null].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="flex flex-col items-end text-right">
          <span className="font-semibold">{formatPrice(locale, Number(x.total), x.currency)}</span>
          {x.kind === "invoice" && <span className={`text-xs ${open > 0 ? "text-[#D72C0D]" : "text-ink-2"}`}>{open > 0 ? `${I.open}: ${formatPrice(locale, open, x.currency)}` : I.paid}</span>}
        </span>
      </Link>
    );
  });
}
