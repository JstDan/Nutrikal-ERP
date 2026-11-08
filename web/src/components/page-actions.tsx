"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/** A few words the shared parts of every page need in the browser (set once by the app shell). */
const UiText = createContext<{ moreActions: string }>({ moreActions: "…" });
export function UiTextProvider({ moreActions, children }: { moreActions: string; children: ReactNode }) {
  return <UiText.Provider value={{ moreActions }}>{children}</UiText.Provider>;
}

/**
 * The buttons at the top of a page. On a phone, with three or more, only the main (dark) one stays in sight and the
 * others wait behind ⋯ (owner, Nov 2026: too many buttons on the phone looked crowded). Rules in globals.css.
 */
export function PageActions({ children }: { children: ReactNode }) {
  const { moreActions } = useContext(UiText);
  const [open, setOpen] = useState(false);
  return (
    <div className={`page-actions flex flex-wrap gap-2 ${open ? "open" : ""}`}>
      {children}
      <button type="button" className="page-more" aria-expanded={open} aria-label={moreActions} title={moreActions} onClick={() => setOpen(!open)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
    </div>
  );
}
