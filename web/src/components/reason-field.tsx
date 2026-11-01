"use client";

import { useState } from "react";

/** A reason from the usual ones, or written by hand under Other. */
export function ReasonField({ name, label, choose, other, otherLabel, options }: { name: string; label: string; choose: string; other: string; otherLabel: string; options: string[] }) {
  const [picked, setPicked] = useState("");
  const typed = picked === other;
  return (
    <>
      <label className="field"><span className="text-xs">{label}</span>
        <select name={typed ? undefined : name} value={picked} onChange={(e) => setPicked(e.target.value)} className="input">
          <option value="">{choose}</option>
          {[...options, other].map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      {typed && <label className="field"><span className="text-xs">{otherLabel}</span><input name={name} required autoFocus className="input" /></label>}
    </>
  );
}
