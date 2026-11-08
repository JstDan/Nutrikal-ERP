"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { openDirectChat } from "@/app/chat-actions";
import { Avatar } from "@/components/chat-room";
import { PresenceDot } from "@/components/live";

type Target = { kind: "channel" | "direct" | "person"; id: string; name: string; personId?: string };

/** Jump to a channel or a person (Ctrl+K), as in Slack. */
export function ChatSwitcher({ targets, label, hint, placeholder }: { targets: Target[]; label: string; hint: string; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !e.shiftKey) { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (open) { setTerm(""); setActive(0); requestAnimationFrame(() => input.current?.focus()); } }, [open]);
  useEffect(() => { setActive(0); }, [term]);

  const find = term.trim().toLowerCase();
  const shown = targets.filter((t) => !find || t.name.toLowerCase().includes(find)).slice(0, 12);
  const go = async (t: Target) => {
    setOpen(false);
    const id = t.kind === "person" ? await openDirectChat(t.id) : t.id;
    router.push(`/chat?c=${id}`);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-keyshortcuts="Control+K"
        className="flex min-h-10 w-full items-center gap-2 rounded-md border border-[#4a5160] bg-white/10 px-3 text-left text-sm text-side-text hover:bg-white/15">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <kbd className="hide-sm rounded border border-[#4a5160] px-1 text-[10px] text-side-muted">{hint}</kbd>
      </button>
      {open && (
        <div role="dialog" aria-label={label} className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="flex w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-line bg-paper text-ink shadow-2xl">
            <label className="sr-only" htmlFor="chat-jump">{label}</label>
            <input id="chat-jump" ref={input} value={term} onChange={(e) => setTerm(e.target.value)} placeholder={placeholder} autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                else if (e.key === "ArrowDown") { e.preventDefault(); setActive((n) => Math.min(n + 1, shown.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActive((n) => Math.max(n - 1, 0)); }
                else if (e.key === "Enter" && shown[active]) { e.preventDefault(); go(shown[active]); }
              }}
              className="min-h-14 border-0 border-b border-line bg-transparent px-4 text-base outline-none" />
            <div role="listbox" aria-label={label} className="flex max-h-[50vh] flex-col overflow-y-auto py-1">
              {shown.map((t, n) => (
                <button key={`${t.kind}${t.id}`} type="button" role="option" aria-selected={n === active} onMouseEnter={() => setActive(n)} onClick={() => go(t)}
                  className={`flex min-h-11 items-center gap-3 px-4 text-left text-sm ${n === active ? "bg-[#1264a3] text-white" : ""}`}>
                  {t.kind === "channel"
                    ? <span aria-hidden="true" className="grid w-6 place-items-center text-base font-bold opacity-70">#</span>
                    : <span className="relative"><span className="block overflow-hidden rounded-md"><Avatar name={t.name} id={t.personId ?? t.id} photo={!!t.personId} size={24} /></span><PresenceDot id={t.personId} ring={n === active ? "border-[#1264a3]" : "border-paper"} /></span>}
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
