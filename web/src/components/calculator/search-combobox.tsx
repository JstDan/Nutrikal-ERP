"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { matchesQuery } from "@/lib/calculator/search";

const MAX_OPTIONS = 60;

/** Search-as-you-type list (combobox pattern, keyboard friendly): raw materials and catalog products. */
export function SearchCombobox<T>({ id, items, searchText, optionKey, renderOption, onPick, placeholder, listLabel, noResults, describedBy, invalid }: {
  id: string;
  items: T[];
  /** Text the query is matched against. */
  searchText: (item: T) => string;
  optionKey: (item: T) => string;
  renderOption: (item: T) => ReactNode;
  onPick: (item: T) => void;
  placeholder: string;
  listLabel: string;
  noResults: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const options = useMemo(
    () => (query.trim() ? items.filter((x) => matchesQuery(searchText(x), query)) : items).slice(0, MAX_OPTIONS),
    [items, query, searchText],
  );

  const pick = (x: T) => {
    onPick(x);
    setQuery("");
    setOpen(false);
    setActive(0);
  };

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        aria-describedby={describedBy ?? `${id}-msg`}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && options[active]) {
            e.preventDefault();
            pick(options[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={`input pl-10! ${invalid ? "border-red!" : ""}`}
      />
      <span aria-hidden="true" className="pointer-events-none absolute top-0 left-3 flex h-11 items-center text-ink-2">⌕</span>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={listLabel}
          className="absolute inset-x-0 top-12 z-20 m-0 max-h-80 list-none overflow-y-auto rounded-sm border border-line-strong bg-white p-1 shadow-lg"
        >
          {options.length === 0 && <li className="px-3 py-3 text-sm text-ink-2">{noResults}</li>}
          {options.map((x, i) => (
            <li
              key={optionKey(x)}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the input
                pick(x);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm ${i === active ? "bg-canvas" : ""}`}
            >
              {renderOption(x)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
