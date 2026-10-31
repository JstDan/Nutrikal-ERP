"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Search box for server-filtered lists: the list follows the text as it is typed (keeps the other filters in the URL). */
export function LiveSearch({ id, param = "q", defaultValue, placeholder, className = "" }: {
  id: string; param?: string; defaultValue: string; placeholder: string; className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(defaultValue);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const change = (text: string) => {
    setValue(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (text.trim()) next.set(param, text.trim());
      else next.delete(param);
      const query = next.toString();
      start(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
    }, 250);
  };

  return (
    <input
      id={id} name={param} type="search" value={value} autoComplete="off" placeholder={placeholder}
      onChange={(e) => change(e.target.value)} aria-busy={pending} className={className}
    />
  );
}
