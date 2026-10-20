import { fmt, formatDate, formatNumber, formatQty, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";

export type NotificationRow = { id: string; kind: string; params: Record<string, unknown>; link: string | null; created_at: string; read_at: string | null };

/** The text of a notification in the reader's language (rows store only kind + params). */
export function notificationText(n: NotificationRow, t: Dict, locale: Locale): string {
  const p = n.params;
  const s = (k: string) => (p[k] == null ? "" : String(p[k]));
  const item = locale === "bg" && p.item_bg ? s("item_bg") : s("item");
  const K = t.notifications.kinds;
  switch (n.kind) {
    case "stock_corrected": {
      const diff = Number(p.diff ?? 0);
      return fmt(K.stock_corrected, {
        item, lot: s("lot"), location: s("location"), reason: s("reason"),
        diff: `${diff > 0 ? "+" : ""}${formatQty(locale, diff, s("unit"))}`,
      });
    }
    case "delivery_received":
      return fmt(K.delivery_received, { code: s("code"), qty: formatQty(locale, s("quantity"), s("unit")), item, lot: s("lot"), photos: s("photos") });
    case "mo_completed": {
      const text = fmt(K.mo_completed, { code: s("code"), batch: s("batch"), quantity: formatNumber(locale, s("quantity")) });
      return Number(p.over ?? 0) > 0 ? `${text} · ${fmt(K.mo_completedOver, { n: s("over") })}` : text;
    }
    case "mo_sent":
      return fmt(K.mo_sent, { code: s("code"), quantity: formatNumber(locale, s("quantity")) })
        + (p.planned_date ? ` · ${formatDate(locale, s("planned_date"))}` : "");
    case "delivery_ordered":
      return fmt(K.delivery_ordered, { code: s("code"), qty: formatQty(locale, s("quantity"), s("unit")), item })
        + (p.expected_on ? ` · ${formatDate(locale, s("expected_on"))}` : "");
    default:
      return n.kind;
  }
}
