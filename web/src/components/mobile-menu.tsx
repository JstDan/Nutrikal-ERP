"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/** Below 1024px the menu folds behind a toggle; from 1024px it is always shown. */
export function MobileMenu({ label, closeLabel, children }: { label: string; closeLabel: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="side-menu"
        onClick={() => setOpen((o) => !o)}
        className="absolute top-5 right-4 flex min-h-11 items-center gap-2 rounded-sm border border-[#4a5160] px-3 text-xs font-semibold tracking-[2px] text-white uppercase lg:hidden"
      >
        <span aria-hidden="true">{open ? "✕" : "☰"}</span>
        {open ? closeLabel : label}
      </button>
      <div id="side-menu" className={`${open ? "block" : "hidden"} lg:block`}>
        {children}
      </div>
    </>
  );
}
