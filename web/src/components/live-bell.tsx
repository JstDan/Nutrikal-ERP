"use client";

import { useEffect, useState } from "react";
import { fmt } from "@/lib/i18n";
import { notificationCount } from "@/app/push-actions";
import { onPing } from "./live";

export function LiveBell({ initial, label, unreadLabel }: { initial: number; label: string; unreadLabel: string }) {
  const [n, setN] = useState(initial);
  useEffect(() => setN(initial), [initial]);
  // A new notification (the live connection) or one read elsewhere: the number again
  useEffect(() => onPing((event) => { if (event === "notify" || event === "chat") notificationCount().then(setN).catch(() => {}); }), []);
  // The app icon on the phone shows the number too, where the system allows it
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (n > 0) void nav.setAppBadge?.(n).catch(() => {}); else void nav.clearAppBadge?.().catch(() => {});
  }, [n]);
  const text = n > 0 ? `${label}: ${fmt(unreadLabel, { n })}` : label;
  return (
    <a href="/notifications" aria-label={text} title={text}
      className="relative grid h-[44px] w-11 shrink-0 place-items-center rounded-sm border border-line-strong bg-white text-ink no-underline hover:bg-canvas">
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
