"use client";

import { useState } from "react";

const OTHER = "other";

/** A reason from the usual ones, kept as a code for the report, or written by hand under Other. */
export function ReasonField({ name, label, choose, otherText, otherLabel, options }: {
  name: string; label: string; choose: string; otherText: string; otherLabel: string; options: Record<string, string>;
}) {
  const [picked, setPicked] = useState("");
  const typed = picked === OTHER;
  return (
    <>
      <label className="field"><span className="text-xs">{label}</span>
        <select name={typed ? undefined : name} value={picked} onChange={(e) => setPicked(e.target.value)} className="input">
          <option value="">{choose}</option>
          {Object.entries(options).map(([code, text]) => <option key={code} value={code}>{text}</option>)}
          <option value={OTHER}>{otherText}</option>
        </select>
      </label>
      {typed && <label className="field"><span className="text-xs">{otherLabel}</span><input name={name} required autoFocus className="input" /></label>}
    </>
  );
}
