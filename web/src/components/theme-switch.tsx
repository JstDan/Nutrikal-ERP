"use client";

import { useEffect, useState } from "react";
import { THEME_COOKIE } from "@/lib/theme";

/** Dark now: chosen with the switch, or (nothing chosen yet) the system setting. */
function isDark() {
  const chosen = document.documentElement.dataset.theme;
  return chosen ? chosen === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Light / dark switch. The choice is kept in a cookie on this device. */
export function ThemeSwitch({ toDark, toLight, saved, cookie = THEME_COOKIE, className = "rounded-sm border border-line-strong bg-white hover:bg-canvas" }: {
  toDark: string; toLight: string; saved?: string; cookie?: string; className?: string;
}) {
  // The saved choice is known on the server, so the right icon shows at once
  const [dark, setDark] = useState(saved === "dark");
  useEffect(() => setDark(isDark()), []);

  function toggle() {
    const next = !isDark();
    document.documentElement.dataset.theme = next ? "dark" : "light";
    document.cookie = `${cookie}=${next ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
    setDark(next);
  }

  const label = dark ? toLight : toDark;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`grid h-[44px] w-11 shrink-0 cursor-pointer place-items-center text-ink ${className}`}
    >
      {dark ? (
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
        </svg>
      ) : (
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
        </svg>
      )}
    </button>
  );
}
