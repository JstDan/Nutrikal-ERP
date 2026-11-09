"use client";

import { useEffect } from "react";

const MINE = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
const EVERY_MS = 5 * 60 * 1000;
const TRIED = "nk-reloaded-for";

/** Someone is typing or has unsent text on the page: a reload would lose it. */
function busy(): boolean {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(el.type))) {
    if (el.value.trim()) return true;
  }
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  // Unsent words anywhere (a chat message being written, a comment) count too
  if ([...document.querySelectorAll("textarea")].some((t) => t.value.trim())) return true;
  return !!document.querySelector("dialog[open]");
}

/**
 * After a release, a page left open would call the actions of the release before and fail ("Failed to find Server
 * Action"). The page asks the server which release it runs (every few minutes, on coming back to the tab, after an
 * action failed) and reloads itself when it is newer, never while someone is typing or has a window open.
 */
export function NewVersion() {
  useEffect(() => {
    if (!MINE) return;
    let newer = false;
    let checking = false;
    const reload = () => {
      if (document.visibilityState !== "visible" || busy()) return;
      try {
        // Once per release: a server still answering with the older one must not make a loop
        if (sessionStorage.getItem(TRIED) === "1") return;
        sessionStorage.setItem(TRIED, "1");
      } catch { /* reload anyway */ }
      location.reload();
    };
    const check = async () => {
      if (newer) return reload();
      if (checking || !navigator.onLine) return;
      checking = true;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const { build } = (await r.json()) as { build?: string };
        if (build && build !== MINE) { newer = true; reload(); }
        else try { sessionStorage.removeItem(TRIED); } catch { /* fine */ }
      } catch { /* offline or a hiccup: next time */ } finally { checking = false; }
    };
    const onFail = (e: PromiseRejectionEvent) => {
      if (/Server Action|older or newer deployment|unexpected response/i.test(String((e.reason as Error)?.message ?? e.reason))) void check();
    };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    const timer = window.setInterval(() => void check(), EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("unhandledrejection", onFail);
    const onLeave = () => { if (newer) window.setTimeout(reload, 1500); };
    window.addEventListener("focusout", onLeave);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("unhandledrejection", onFail);
      window.removeEventListener("focusout", onLeave);
    };
  }, []);
  return null;
}
