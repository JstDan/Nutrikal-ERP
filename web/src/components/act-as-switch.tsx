"use client";

import { actAs } from "@/app/actions";

type Option = { id: string; label: string };

/** Developer only: pick the user to act as. Every page then runs as that user. */
export function ActAsSwitch({ current, options, label, id = "act-as" }: { current: string; options: Option[]; label: string; id?: string }) {
  return (
    <form action={actAs} className="flex min-w-0 max-w-full items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        name="user"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="input min-w-0 max-w-[260px]"
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
