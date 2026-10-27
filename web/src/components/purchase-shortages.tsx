import { Card, Empty } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { generatePurchaseOrders } from "@/app/purchase-order-actions";
import { fmt, formatQty, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";

export type Shortage = {
  source: "request" | "low_stock"; purchase_request_id: string | null; request_code: string | null; item_id: string;
  sku: string; name: string; name_bg: string | null; base_unit: string; quantity: string; reorder_level: string | null;
  available: string; supplier_id: string | null; unit_price: string | null;
};

/** Admin, in Доставки: what is missing; the ticked lines become draft purchase orders, one per supplier. */
export function PurchaseShortages({ rows, suppliers, locale, t }: {
  rows: Shortage[]; suppliers: { id: string; name: string }[]; locale: Locale; t: Dict;
}) {
  const P = t.purchaseOrders;
  const nm = (r: Shortage) => (locale === "bg" && r.name_bg ? r.name_bg : r.name);
  return (
    <Card title={P.shortages} id="shortages-h">
      <p className="m-0 text-[13px] text-ink-2">{P.shortagesNote}</p>
      {rows.length === 0 ? <Empty>{P.noShortages}</Empty> : (
        <ActionForm action={generatePurchaseOrders} submitLabel={P.generate} resetOnSuccess={false}>
          <div className="flex flex-col">
            {rows.map((r, i) => (
              <div key={`${r.item_id}-${r.purchase_request_id ?? ""}`} className="flex flex-col gap-2 border-b border-mist py-3 last:border-0">
                <input type="hidden" name={`item_${i}`} value={r.item_id} />
                {r.purchase_request_id && <input type="hidden" name={`request_${i}`} value={r.purchase_request_id} />}
                <label className="flex min-h-11 items-start gap-3 text-sm">
                  <input type="checkbox" name="pick" value={i} className="mt-0.5 size-5 shrink-0" aria-label={`${P.pick}: ${nm(r)}`} />
                  <span className="min-w-0">
                    <span className="block font-semibold break-words">{nm(r)}</span>
                    <span className="block text-xs text-ink-2">
                      {r.sku} · {r.source === "request"
                        ? fmt(P.fromRequest, { code: r.request_code ?? "" })
                        : fmt(P.lowStock, { available: formatQty(locale, r.available, r.base_unit), min: formatQty(locale, r.reorder_level ?? 0, r.base_unit) })}
                    </span>
                  </span>
                </label>
                <div className="grid grid-cols-1 gap-3 pl-8 sm:grid-cols-[140px_minmax(0,1fr)_140px]">
                  <label className="field"><span>{P.quantity} ({r.base_unit === "pcs" ? t.common.units : r.base_unit})</span>
                    <input name={`qty_${i}`} type="number" min="0.001" step="any" defaultValue={Number(r.quantity)} className="input" />
                  </label>
                  <label className="field"><span>{P.supplier}</span>
                    <select name={`supplier_${i}`} defaultValue={r.supplier_id ?? ""} className="input">
                      <option value="">{P.noSupplier}</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>{P.unitPrice}</span>
                    <input name={`price_${i}`} type="number" min={0} step="any" defaultValue={r.unit_price != null ? Number(r.unit_price) : ""} className="input" />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </ActionForm>
      )}
    </Card>
  );
}
