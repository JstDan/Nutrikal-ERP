"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveChatMessage } from "@/app/chat-actions";
import { onPing } from "@/components/live";

/** The channel list follows new messages at once: a ping for another channel draws the page again. */
export function ChatListRefresh({ current }: { current: string | null }) {
  const router = useRouter();
  useEffect(() => {
    let timer = 0;
    const off = onPing((event, p) => {
      if (event !== "chat" || p.channel === current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => router.refresh(), 400);
    });
    return () => { window.clearTimeout(timer); off(); };
  }, [current, router]);
  return null;
}

/** Takes a message off one's saved items. */
export function UnsaveButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => { await saveChatMessage(id, false); router.refresh(); })}
      className="min-h-9 shrink-0 rounded-md border border-line px-2 text-xs font-semibold text-ink-2 hover:text-ink">{label}</button>
  );
}
