"use client";

import { useEffect, useState, useTransition } from "react";
import type { Dict } from "@/lib/i18n/en";
import { subscribePush } from "@/components/push-toggle";
import { pushSubscriptionKnown, savePushSubscription } from "@/app/push-actions";

const LATER = "nk-push-later";
const SYNCED = "nk-push-synced";

/**
 * A device with notifications on is signed up again when the server no longer has it (the push service dropped it,
 * or someone else signed in on the phone), at most every few hours. One switched off under Notifications has no
 * subscription and is left alone.
 */
async function keepPushAlive(publicKey: string) {
  try { if (Number(localStorage.getItem(SYNCED) ?? 0) > Date.now()) return; } catch { /* check anyway */ }
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(() => navigator.serviceWorker.ready);
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  if (!(await pushSubscriptionKnown(sub.endpoint))) {
    await sub.unsubscribe().catch(() => false);
    const fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) });
    await savePushSubscription(fresh.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }, navigator.userAgent);
  }
  try { localStorage.setItem(SYNCED, String(Date.now() + 6 * 3600e3)); } catch { /* fine */ }
}
const b64 = (s: string) => {
  const raw = atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/**
 * On a phone without notifications yet: one line that offers them (owner, Nov 2026: phone notifications).
 * "Not now" hides it for two weeks on this device; the switch stays under Notifications.
 */
export function PushPrompt({ publicKey, T }: { publicKey: string | null; T: Dict["push"] }) {
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
    if (Notification.permission === "granted") { keepPushAlive(publicKey).catch(() => {}); return; }
    if (Notification.permission !== "default") return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    try { if (Number(localStorage.getItem(LATER) ?? 0) > Date.now()) return; } catch { /* private window: ask */ }
    let live = true;
    navigator.serviceWorker.register("/sw.js", { scope: "/" })
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => { if (live && !sub) setShow(true); })
      .catch(() => {});
    return () => { live = false; };
  }, [publicKey]);

  if (!show || !publicKey) return null;
  const later = () => {
    try { localStorage.setItem(LATER, String(Date.now() + 14 * 864e5)); } catch { /* nothing kept */ }
    setShow(false);
  };
  const turnOn = () => start(async () => {
    try {
      const r = await subscribePush(publicKey);
      if (typeof r === "object") return setError(r.error);
      if (r === "off") return later();
      setShow(false);
    } catch {
      setError(T.unsupported);
    }
  });

  return (
    <section aria-label={T.promptTitle} className="chat-in mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-paper px-4 py-3 print:hidden">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-green-ink">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      <div className="min-w-0 flex-[1_1_200px]">
        <p className="m-0 text-sm font-bold">{T.promptTitle}</p>
        <p className="m-0 text-xs text-ink-2">{T.promptText}</p>
        {error && <p role="alert" className="m-0 text-xs font-semibold text-red-ink">{error}</p>}
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn btn-outline" onClick={later}>{T.later}</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={turnOn}>{T.on}</button>
      </div>
    </section>
  );
}
