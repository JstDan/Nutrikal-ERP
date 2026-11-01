import Link from "next/link";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { Empty } from "@/components/ui";
import { portalPost } from "@/app/portal/actions";
import { fmt, formatDate, formatPrice, type AnyLocale } from "@/lib/i18n";
import type { PortalDict } from "@/lib/i18n/portal";
import type { PortalDocument, PortalInvoiceRow, PortalMessage } from "@/lib/portal";

const when = (locale: AnyLocale, at: string) => `${formatDate(locale, at.slice(0, 10))} ${at.slice(11, 16)}`;

/** How far an order has come, out of the steps a client sees. */
const STAGE: Record<string, number> = { confirmed: 25, in_production: 55, ready: 80, dispatched: 100, closed: 100 };

export function Panel({ title, action, children }: { title?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="p-panel p-in">
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="m-0 text-base font-bold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function OrderBar({ status }: { status: string }) {
  const at = STAGE[status];
  if (at == null) return null;
  return <span aria-hidden="true" className="p-bar"><span style={{ width: `${at}%` }} /></span>;
}

/** A conversation: from the client's side here, from the team's side in client-messages.tsx. */
export function PortalThread({ orderId, rows, locale, t }: { orderId: string | null; rows: PortalMessage[]; locale: AnyLocale; t: PortalDict }) {
  const S = t.portal.support;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {rows.length === 0 && <Empty>{S.empty}</Empty>}
      {rows.map((m) => (
        <div key={m.id} className={`p-in flex min-w-0 flex-col gap-0.5 ${m.from_client ? "items-end" : "items-start"}`}>
          <span className="text-xs text-ink-2">{m.from_client ? S.you : `${m.author || S.team} · ${S.team}`} · {when(locale, m.created_at)}</span>
          <p className={`m-0 max-w-[85%] min-w-0 rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap ${m.from_client ? "rounded-br-md bg-ink text-white" : "rounded-bl-md bg-neutral-tint"}`}>{m.body}</p>
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

function FileMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-2">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" />
    </svg>
  );
}

export function DocumentList({ rows, showOrder, locale, t }: { rows: PortalDocument[]; showOrder: boolean; locale: AnyLocale; t: PortalDict }) {
  const D = t.portal.docs;
  if (rows.length === 0) return <Empty>{D.empty}</Empty>;
  return rows.map((d) => (
    <a key={`${d.kind}-${d.id}`} href={`/portal/${d.kind === "coa" ? "coa" : "files"}/${d.id}`} className="p-row">
      <FileMark />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold break-all">{d.kind === "coa" ? fmt(D.coa, { lot: d.name }) : d.name}</span>
        <span className="text-xs text-ink-2">
          {[showOrder ? (d.order_code ? fmt(D.order, { code: d.order_code }) : D.general) : null, d.shared_at ? formatDate(locale, d.shared_at.slice(0, 10)) : null, d.note].filter(Boolean).join(" · ")}
        </span>
      </span>
    </a>
  ));
}

export function InvoiceList({ rows, locale, t }: { rows: PortalInvoiceRow[]; locale: AnyLocale; t: PortalDict }) {
  const I = t.portal.invoices;
  if (rows.length === 0) return <Empty>{I.empty}</Empty>;
  return rows.map((x) => {
    const open = Number(x.open_amount ?? 0);
    const total = Number(x.total);
    return (
      <Link key={x.id} href={`/portal/invoices/${x.id}`} className="p-row flex-col !items-stretch">
        <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold break-words">{I.kinds[x.kind]} {x.number}</span>
            <span className="text-xs text-ink-2">{[formatDate(locale, x.issue_date), x.order_code, x.due_date ? `${I.due}: ${formatDate(locale, x.due_date)}` : null].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="flex flex-col items-end text-right">
            <span className="font-semibold">{formatPrice(locale, total, x.currency)}</span>
            {x.kind === "invoice" && <span className={`text-xs ${open > 0 ? "text-[#b42318]" : "text-[#2f6b16]"}`}>{open > 0 ? `${I.open}: ${formatPrice(locale, open, x.currency)}` : I.paid}</span>}
          </span>
        </span>
        {x.kind === "invoice" && total > 0 && <span aria-hidden="true" className="p-bar"><span style={{ width: `${Math.round(((total - open) / total) * 100)}%` }} /></span>}
      </Link>
    );
  });
}
