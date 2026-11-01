"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { rescheduleMo } from "@/app/calendar-actions";
import { daysBetween, today, type CalendarItem } from "@/lib/calendar";

type Labels = { states: Record<CalendarItem["date_state"], string>; late: string; pastRequested: string; failed: string; moveHint: string; empty: string };

/** Days with their batches. Admin moves a batch by dragging it; on a phone the days stack and only days with work show. */
export function ProductionCalendar({ items, from, to, month, locale, labels, canMove, linkBase }: {
  items: CalendarItem[]; from: string; to: string; month: string | null; locale: string; labels: Labels; canMove: boolean; linkBase: string;
}) {
  const router = useRouter();
  const [list, setList] = useState(items);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [, start] = useTransition();
  useEffect(() => setList(items), [items]);
  const now = today();

  const move = (id: string, day: string) => {
    setError("");
    const before = list;
    setList(list.map((x) => (x.id === id ? { ...x, on_date: day, date_state: "pending", late: day < now } : x)));
    start(async () => {
      const r = await rescheduleMo(id, day);
      if (r.error) { setList(before); setError(r.error || labels.failed); }
      router.refresh();
    });
  };
  const weekday = (d: string) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {canMove && <p className="m-0 hidden text-xs text-ink-2 md:block">{labels.moveHint}</p>}
      {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
      <div className="cal-grid">
        {daysBetween(from, to).map((d) => {
          const rows = list.filter((x) => x.on_date === d);
          return (
            <section key={d} aria-label={weekday(d)} data-empty={rows.length === 0 || undefined} data-today={d === now || undefined} data-other={(month && d.slice(0, 7) !== month) || undefined} data-over={over === d || undefined} className="cal-day"
              onDragOver={canMove ? (e) => { e.preventDefault(); setOver(d); } : undefined}
              onDragLeave={canMove ? () => setOver((o) => (o === d ? null : o)) : undefined}
              onDrop={canMove ? (e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) move(id, d); } : undefined}>
              <h3 className="m-0 text-xs font-semibold text-ink-2">{weekday(d)}</h3>
              {rows.map((x) => <Batch key={x.id} x={x} locale={locale} labels={labels} draggable={canMove && x.status !== "completed"} href={`${linkBase}/${x.id}`} />)}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Batch({ x, locale, labels, draggable, href }: { x: CalendarItem; locale: string; labels: Labels; draggable: boolean; href: string }) {
  const name = locale.startsWith("bg") && x.product_bg ? x.product_bg : x.product;
  return (
    <Link href={href} draggable={draggable} onDragStart={(e) => e.dataTransfer.setData("text/plain", x.id)} data-state={x.status === "completed" ? "done" : x.date_state} data-late={x.late || undefined} className="cal-batch">
      <span className="font-semibold">{x.code}</span>
      <span className="break-words">{name}</span>
      <span className="text-ink-2">{[x.client ?? x.project_code, x.quantity.toLocaleString(locale)].filter(Boolean).join(" · ")}</span>
      <span className="text-ink-2">{x.status === "completed" ? "" : labels.states[x.date_state]}</span>
      {x.late && <span className="font-semibold text-red-ink">{labels.late}</span>}
      {x.past_requested && !x.late && <span className="font-semibold text-red-ink">{labels.pastRequested}</span>}
    </Link>
  );
}
