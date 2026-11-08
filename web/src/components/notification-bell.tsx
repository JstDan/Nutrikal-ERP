import { q } from "@/lib/db/engine";
import { LiveBell } from "./live-bell";

/** Bell with the number of unread notifications; opens the notifications page. The number follows new ones at once. */
export async function NotificationBell({ userId, label, unreadLabel }: { userId: string; label: string; unreadLabel: string }) {
  const [row] = await q<{ n: number }>(userId, "select count(*)::int as n from notifications where read_at is null");
  return <LiveBell initial={row?.n ?? 0} label={label} unreadLabel={unreadLabel} />;
}
