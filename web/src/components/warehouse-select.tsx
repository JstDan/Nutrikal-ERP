"use client";

/** Choice of warehouse on the stock page: the page reloads with it as soon as one is picked. */
export function WarehouseSelect({ label, allLabel, value, options, keep }: {
  label: string; allLabel: string; value: string;
  options: { id: string; name: string }[];
  keep: Record<string, string>;             // other filters kept in the address (tab, search)
}) {
  return (
    <form method="get" action="/inventory">
      {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="flex items-center gap-2">
        <span className="sr-only">{label}</span>
        <select name="loc" defaultValue={value} key={value} onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="input min-h-11 w-auto max-w-full min-w-[200px]">
          <option value="">{allLabel}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
    </form>
  );
}
