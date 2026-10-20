import { q } from "@/lib/db/engine";
import { fmt } from "@/lib/i18n";

/** Bell with the number of unread notifications; opens the notifications page. */
export async function NotificationBell({ userId, label, unreadLabel }: { userId: string; label: string; unreadLabel: string }) {
  const [row] = await q<{ n: number }>(userId, "select count(*)::int as n from notifications where read_at is null");
  const n = row?.n ?? 0;
  const text = n > 0 ? `${label}: ${fmt(unreadLabel, { n })}` : label;
  return (
    <a
      href="/notifications"
      aria-label={text}
      title={text}
      className="relative grid h-[44px] w-11 shrink-0 place-items-center rounded-sm border border-line-strong bg-white text-ink no-underline hover:bg-canvas"
    >
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {n > 0 && (
        <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-red px-1 text-[11px] font-bold text-[#fff]">
          {n > 99 ? "99+" : n}
        </span>
      )}
    </a>
  );
}
