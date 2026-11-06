"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { markSeen } from "@/app/actions";

/** Tells the server which address is open, so its notifications are read; the bell is refreshed when some were. */
export function NotificationsSeen() {
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    const link = path + window.location.search;
    void markSeen(link).then((n) => { if (n > 0) router.refresh(); }).catch(() => {});
  }, [path, router]);
  return null;
}

/** The same for something opened without a new address (a card, a channel in the side panel). */
export function useSeen(link: string | null) {
  const router = useRouter();
  useEffect(() => {
    if (!link) return;
    void markSeen(link).then((n) => { if (n > 0) router.refresh(); }).catch(() => {});
  }, [link, router]);
}
