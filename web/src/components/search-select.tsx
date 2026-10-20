"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { matchesQuery } from "@/lib/calculator/search";

export type SearchOption = { value: string; label: string; group?: string; hint?: string; keywords?: string };

type Props = {
  name: string;
  options: SearchOption[];
  placeholder: string;
  noResults: string;
  required?: boolean;
  defaultValue?: string;
  id?: string;
  /** Shown as the first option when the field is optional (e.g. "—"). */
  emptyLabel?: string;
};

const MAX_OPTIONS = 80;

/**
 * A dropdown you can type into (combobox pattern): the list narrows to the
 * options containing every typed word (name, code, lot, supplier…). The
 * chosen value is sent in a hidden field with the given name, like a <select>.
 */
export function SearchSelect({ name, options, placeholder, noResults, required, defaultValue = "", id, emptyLabel }: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? "";
  const [value, setValue] = useState(defaultValue);
  const [query, setQuery] = useState(labelOf(defaultValue));
  const [typing, setTyping] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const all = useMemo(
    () => (emptyLabel && !required ? [{ value: "", label: emptyLabel }, ...options] : options),
    [options, emptyLabel, required],
  );
  const shown = useMemo(
    () => (typing && query.trim()
      ? all.filter((o) => o.value !== "" && matchesQuery(`${o.label} ${o.hint ?? ""} ${o.keywords ?? ""} ${o.group ?? ""}`, query))
      : all).slice(0, MAX_OPTIONS),
    [all, query, typing],
  );

  // Back to the start value when the form is reset (e.g. after a successful save)
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onReset = () => {
      setValue(defaultValue);
      setQuery(labelOf(defaultValue));
      setTyping(false);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  });

  // A required field is valid only when an option is chosen, not just typed
  useEffect(() => {
    inputRef.current?.setCustomValidity(required && !value && query.trim() ? noResults : "");
  }, [required, value, query, noResults]);

  const pick = (o: SearchOption) => {
    setValue(o.value);
    setQuery(o.value ? o.label : "");
    setTyping(false);
    setOpen(false);
  };
  const close = () => {
    setOpen(false);
    setTyping(false);
    // Typed text that is not an option goes back to the chosen one; an empty field clears the choice
    if (!query.trim()) setValue("");
    else setQuery(labelOf(value));
  };

  let lastGroup: string | undefined;
  return (
    <div className="relative">
      <input type="hidden" name={name} value={value} />
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        required={required}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setTyping(true);
          setOpen(true);
          setActive(0);
        }}
        onFocus={(e) => {
          e.currentTarget.select();
          setOpen(true);
          setActive(Math.max(0, shown.findIndex((o) => o.value === value)));
        }}
        onBlur={close}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && shown[active]) {
            e.preventDefault();
            pick(shown[active]);
          } else if (e.key === "Escape") {
            close();
          }
        }}
        className="input pr-9!"
      />
      <span aria-hidden="true" className="pointer-events-none absolute top-0 right-3 flex h-11 items-center text-ink-2">⌕</span>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-12 z-30 m-0 max-h-80 list-none overflow-y-auto rounded-sm border border-line-strong bg-white p-1 shadow-lg"
        >
          {shown.length === 0 && <li className="px-3 py-3 text-sm text-ink-2">{noResults}</li>}
          {shown.map((o, i) => {
            const header = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return [
              header && (
                <li key={`g-${header}`} role="presentation" className="px-3 pt-2 pb-1 text-xs font-semibold tracking-[1px] uppercase text-ink-2">
                  {header}
                </li>
              ),
              <li
                key={o.value || "empty"}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === value}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the input
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm ${i === active ? "bg-canvas" : ""} ${o.value === value ? "font-semibold" : ""}`}
              >
                <span className="min-w-0 flex-1 break-words">{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs text-ink-2">{o.hint}</span>}
              </li>,
            ];
          })}
        </ul>
      )}
    </div>
  );
}
