import * as XLSX from "xlsx";
import { getSession } from "@/lib/session";
import { loadAccounting, period } from "@/lib/accounting";

// Excel workbook for the accountant, in the user's language: summary,
// movements, production consumption, stock value and open deliveries.
export async function GET(request: Request) {
  const { user, locale, t } = await getSession();
  if (user.role !== "admin" && user.role !== "inventory") return new Response("Forbidden", { status: 403 });

  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const { from, to } = period(sp);
  const d = await loadAccounting(user.id, from, to);
  const A = t.accounting;
  const C = A.cols;
  const n = (v: string | null) => (v == null ? null : Number(v));
  const day = (v: string | null) => (v ? new Date(`${v}T00:00:00Z`) : null);
  const nm = (r: { name: string; name_bg: string | null }) => (locale === "bg" && r.name_bg ? r.name_bg : r.name);
  const unit = (u: string) => (u === "pcs" ? t.common.units : u);

  const sheet = (rows: unknown[][], widths: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: "yyyy-mm-dd" });
    ws["!cols"] = widths.map((wch) => ({ wch }));
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: widths.length - 1 } }) };
    return ws;
  };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([
    [C.metric, C.value],
    [C.period, `${from} – ${to}`],
    [A.movements, d.movements.length],
    [A.receivedValue, d.totals.received],
    [A.consumedValue, d.totals.consumed],
    [A.stockValue, d.totals.stock],
    [A.openDeliveries, d.totals.commitments],
    [A.sheetNote, ""],
  ], [40, 24]), A.sheets.summary);

  XLSX.utils.book_append_sheet(wb, sheet([
    [C.date, C.type, C.sku, C.item, C.lot, C.location, C.quantity, C.unit, C.unitCost, C.value, C.reference, C.production, C.project, C.reason],
    ...d.movements.map((m) => [
      day(m.date), t.enums.movementType[m.type as "receipt"] ?? m.type, m.sku, nm(m), m.lot_number, m.location,
      n(m.quantity), unit(m.base_unit), n(m.unit_cost), n(m.value), m.reference, m.mo_code, m.project_code, m.reason,
    ]),
  ], [11, 18, 12, 34, 12, 26, 12, 7, 12, 12, 16, 14, 12, 30]), A.sheets.movements);

  XLSX.utils.book_append_sheet(wb, sheet([
    [C.production, C.project, C.sku, C.item, C.quantity, C.unit, C.value],
    ...d.consumption.map((c) => [c.mo_code, c.project_code, c.sku, nm(c), n(c.quantity), unit(c.base_unit), n(c.value)]),
  ], [16, 12, 12, 34, 12, 7, 12]), A.sheets.consumption);

  XLSX.utils.book_append_sheet(wb, sheet([
    [C.sku, C.item, C.lot, C.location, C.qcStatus, C.expires, C.quantity, C.unit, C.unitCost, C.value],
    ...d.stock.map((s) => [
      s.sku, nm(s), s.lot_number, s.location, t.enums.qcStatus[s.qc_status as "released"] ?? s.qc_status, day(s.expires_on),
      n(s.quantity), unit(s.base_unit), n(s.unit_cost), n(s.value),
    ]),
  ], [12, 34, 12, 26, 12, 11, 12, 7, 12, 12]), A.sheets.stock);

  XLSX.utils.book_append_sheet(wb, sheet([
    [C.delivery, C.supplier, C.sku, C.item, C.expectedOn, C.remaining, C.unit, C.unitPrice, C.value, C.reference],
    ...d.commitments.map((c) => [
      c.code, c.supplier, c.sku, nm(c), day(c.expected_on), n(c.remaining), unit(c.base_unit), n(c.unit_price), n(c.value), c.po_reference,
    ]),
  ], [11, 26, 12, 34, 11, 12, 7, 12, 12, 16]), A.sheets.commitments);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="nutrikal-accounting-${from}_${to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
