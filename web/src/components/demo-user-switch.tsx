"use client";

import { switchDemoUser } from "@/app/actions";

type Option = { id: string; label: string };

/** Demo only: pick which role you are signed in as. Replaced by Supabase Auth. */
export function DemoUserSwitch({ current, options, label }: { current: string; options: Option[]; label: string }) {
  return (
    <form action={switchDemoUser} className="flex min-w-0 items-center gap-2">
      <label htmlFor="demo-user" className="text-xs font-semibold text-ink-2 hidden lg:block">
        {label}
      </label>
      <select
        id="demo-user"
        name="user"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="input max-w-[220px]"
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="btn btn-outline">OK</button>
      </noscript>
    </form>
  );
}
