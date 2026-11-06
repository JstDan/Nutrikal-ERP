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
    case "task_mention":
      return fmt(K.task_mention, { by: s("by"), order: s("order"), task: locale === "en" && p.task_en ? s("task_en") : s("task") });
    case "chat_mention":
      return fmt(p.channel ? K.chat_mention : K.chat_mentionDirect, { by: s("by"), channel: s("channel") });
    case "mo_date_changed":
      return fmt(K.mo_date_changed, { code: s("code"), date: formatDate(locale, s("date")) });
    case "mo_date_answer":
      return p.proposed ? fmt(K.mo_date_proposed, { code: s("code"), date: formatDate(locale, s("proposed")) }) : fmt(K.mo_date_confirmed, { code: s("code") });
    case "mo_date_decided":
      return fmt(p.accepted ? K.mo_date_accepted : K.mo_date_declined, { code: s("code") });
    case "client_message":
      return fmt(K.client_message, { client: s("client"), code: s("code") || "—" });
    case "catalog_enquiry":
      return fmt(K.catalog_enquiry, { company: s("company"), no: s("no") });
    case "board_assigned": case "board_mention": case "board_comment":
      return fmt(K[n.kind], { by: s("by"), card: s("card"), board: s("board") });
    case "board_due":
      return fmt(p.overdue ? K.board_overdue : K.board_due, { card: s("card"), board: s("board"), due: formatDate(locale, s("due")) });
    case "materials_short":
      return fmt(K.materials_short, { by: s("by"), item, order: s("order") });
    default:
      return n.kind;
  }
}
