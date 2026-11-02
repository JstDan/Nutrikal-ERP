import Link from "next/link";
import { today, weekNumber, type CalendarView } from "@/lib/calendar";
import { fmt } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";

/** The period shown and the way to another one. */
export function CalendarToolbar({ base, view, date, from, prev, next, locale, t }: {
  base: string; view: CalendarView; date: string; from: string; prev: string; next: string; locale: string; t: Dict;
}) {
  const C = t.calendar;
  const link = (v: CalendarView, d: string) => `${base}?view=${v}&date=${d}`;
  const title = view === "week"
    ? fmt(C.weekNo, { n: weekNumber(from) })
    : new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date.slice(0, 7)}-01T00:00:00Z`));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={link(view, prev)} aria-label={C.prev} className="btn btn-outline">←</Link>
      <Link href={link(view, today())} className="btn btn-outline">{C.today}</Link>
      <Link href={link(view, next)} aria-label={C.next} className="btn btn-outline">→</Link>
      <strong className="min-w-0 px-2 text-base">{title}</strong>
      <span className="ml-auto flex gap-2">
        <Link href={link("week", date)} aria-current={view === "week" ? "page" : undefined} className={`btn ${view === "week" ? "btn-primary" : "btn-outline"}`}>{C.week}</Link>
        <Link href={link("month", date)} aria-current={view === "month" ? "page" : undefined} className={`btn ${view === "month" ? "btn-primary" : "btn-outline"}`}>{C.month}</Link>
      </span>
    </div>
  );
}
