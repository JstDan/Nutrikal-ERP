"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Fills the screen below where it starts, above the phone's bar at the foot (the chat: its box stays in sight). */
export function FillHeight({ className, min = 420, children }: { className?: string; min?: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const bar = document.getElementById("tab-bar");
      const foot = bar && getComputedStyle(bar).display !== "none" ? window.innerHeight - bar.getBoundingClientRect().top : 0;
      const gap = window.innerWidth < 640 ? 0 : 24;
      el.style.height = `${Math.max(min, window.innerHeight - top - foot - gap)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [min]);
  return <div ref={box} className={className}>{children}</div>;
}
