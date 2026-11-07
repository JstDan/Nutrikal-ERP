"use client";

import { useEffect, useState, useTransition } from "react";
import type { Dict } from "@/lib/i18n/en";
import { deletePushSubscription, savePushSubscription } from "@/app/push-actions";

type BeforeInstall = Event & { prompt: () => Promise<void> };
const fromB64 = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

/** Notifications on this device (Web Push) and installing the app; on iPhone the app has to be on the home screen first. */
export function PushToggle({ publicKey, T }: { publicKey: string | null; T: Dict["push"] }) {
  const [state, setState] = useState<"loading" | "unsupported" | "denied" | "off" | "on">("loading");
  const [ios, setIos] = useState(false);
  const [install, setInstall] = useState<BeforeInstall | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone);
    const onPrompt = (e: Event) => { e.preventDefault(); setInstall(e as BeforeInstall); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })().catch(() => setState("unsupported"));
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const turnOn = () => start(async () => {
    setError(null);
    if (!publicKey) return setError(T.notConfigured);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64(publicKey) });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const r = await savePushSubscription(json, navigator.userAgent);
      if (r.error) { setError(r.error); await sub.unsubscribe(); return; }
      setState("on");
    } catch {
      // The browser has no push service here (or refused it): said plainly, the page stays
      setError(ios ? T.ios : T.unsupported);
    }
  });
  const turnOff = () => start(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await deletePushSubscription(sub.endpoint); await sub.unsubscribe(); }
    } catch { /* nothing left to undo */ }
    setState("off");
  });

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {state === "off" && <button type="button" className="btn btn-primary" disabled={pending} onClick={turnOn}>{T.on}</button>}
        {state === "on" && <><span className="font-semibold text-green-ink">✓ {T.enabled}</span><button type="button" className="btn btn-outline" disabled={pending} onClick={turnOff}>{T.off}</button></>}
        {install && <button type="button" className="btn btn-outline" onClick={() => { void install.prompt(); setInstall(null); }}>{T.install}</button>}
      </div>
      {state === "denied" && <p className="m-0 text-ink-2">{T.denied}</p>}
      {state === "unsupported" && <p className="m-0 text-ink-2">{ios ? T.ios : T.unsupported}</p>}
      {ios && state !== "unsupported" && <p className="m-0 text-xs text-ink-2">{T.ios}</p>}
      {error && <p role="alert" className="m-0 font-semibold text-red-ink">{error}</p>}
    </div>
  );
}
