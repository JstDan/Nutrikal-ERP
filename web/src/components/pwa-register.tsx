"use client";

import { useEffect } from "react";

/** Registers the service worker, so the app can be installed and receive notifications (owner, Nov 2026). */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
