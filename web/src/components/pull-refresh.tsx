"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const PULL = 72;

/** The installed app has no browser bar: pulling down at the top of a page draws it again (Android, iPhone). */
export function PullRefresh({ label }: { label: string }) {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);

  useEffect(() => {
    const app = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!app || !window.matchMedia("(pointer: coarse)").matches) return;
    // Only from the very top, and not inside a list that scrolls by itself (the chat), a dialog or a map
    const atTop = (el: EventTarget | null) => {
      if (window.scrollY > 0) return false;
      for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
        if (n.closest("[role=dialog]")) return false;
        const o = getComputedStyle(n).overflowY;
        if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight && n.scrollTop > 0) return false;
      }
      return true;
    };
    const down = (e: TouchEvent) => { start.current = e.touches.length === 1 && atTop(e.target) ? e.touches[0].clientY : null; };
    const move = (e: TouchEvent) => {
      if (start.current === null) return;
      const d = e.touches[0].clientY - start.current;
      setPull(d > 0 ? Math.min(d * 0.5, PULL * 1.4) : 0);
      if (d < 0) start.current = null;
    };
    const up = () => {
      if (start.current === null) return;
      start.current = null;
      setPull((p) => {
        if (p >= PULL) {
          setBusy(true);
          if (navigator.vibrate) navigator.vibrate(10);
          router.refresh();
          window.setTimeout(() => setBusy(false), 900);
        }
        return 0;
      });
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [router]);

  if (!pull && !busy) return null;
  const ready = pull >= PULL || busy;
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-0 z-[45] flex justify-center lg:hidden"
      style={{ transform: `translateY(${busy ? 56 : Math.max(pull - 16, 0)}px)`, transition: pull ? "none" : "transform .2s" }}>
      <span className={`grid h-10 w-10 place-items-center rounded-full bg-paper text-ink shadow-lg ${busy ? "animate-spin" : ""}`}
        style={{ transform: busy ? undefined : `rotate(${pull * 4}deg)`, opacity: ready ? 1 : 0.6 }}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" /></svg>
        {busy && <span className="sr-only">{label}</span>}
      </span>
    </div>
  );
}
