"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { portalPost } from "@/app/portal/actions";

export type ChatLine = { id: string; mine: boolean; who: string; initials: string; time: string; body: string; day: string | null };
const POLL_MS = 20000;

/** A conversation in the panel: newest at the bottom, Enter sends, new answers arrive by themselves. */
export function PortalChat({ orderId, lines, empty, placeholder, send }: { orderId: string | null; lines: ChatLine[]; empty: string; placeholder: string; send: string }) {
  const router = useRouter();
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [lines.length]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) router.refresh(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div ref={box} className="p-chat">
        {lines.length === 0 && <p className="m-auto text-sm text-ink-2">{empty}</p>}
        {lines.map((m) => (
          <div key={m.id} className="flex min-w-0 flex-col gap-2">
            {m.day && <span className="p-day">{m.day}</span>}
            <div className={`p-in flex min-w-0 items-end gap-2 ${m.mine ? "flex-row-reverse" : ""}`}>
              <span aria-hidden="true" className={`p-face ${m.mine ? "p-face-mine" : ""}`}>{m.initials}</span>
              <div className={`flex max-w-[80%] min-w-0 flex-col gap-0.5 ${m.mine ? "items-end" : "items-start"}`}>
                <span className="text-xs text-ink-2">{m.who} · {m.time}</span>
                <p className={`m-0 min-w-0 rounded-2xl px-3.5 py-2 text-sm break-words whitespace-pre-wrap ${m.mine ? "rounded-br-md bg-ink text-white" : "rounded-bl-md bg-paper shadow-sm"}`}>{m.body}</p>
              </div>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <ActionForm action={portalPost} submitLabel={send}>
        {orderId && <input type="hidden" name="order_id" value={orderId} />}
        <label className="field"><span className="sr-only">{placeholder}</span>
          <textarea name="body" required maxLength={4000} rows={2} placeholder={placeholder} className="input w-full resize-y"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
        </label>
      </ActionForm>
    </div>
  );
}
