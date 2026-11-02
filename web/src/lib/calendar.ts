// Dates of the production calendar: plain YYYY-MM-DD strings, weeks start on Monday.

export type CalendarView = "week" | "month";
export type CalendarItem = {
  id: string; code: string; status: string; on_date: string | null; product: string; product_bg: string | null; quantity: number; project_code: string | null;
  client?: string | null; requested_date?: string | null; date_state: "pending" | "confirmed" | "proposed"; proposed_date: string | null; date_note: string | null;
  late: boolean; past_requested?: boolean;
};

const DAY = 864e5;
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => new Date(parse(d) + n * DAY).toISOString().slice(0, 10);
export const today = () => new Date().toISOString().slice(0, 10);
const monday = (d: string) => addDays(d, -((new Date(parse(d)).getUTCDay() + 6) % 7));
export const validDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(parse(d));

/** ISO week number. */
export function weekNumber(d: string) {
  const thursday = addDays(monday(d), 3);
  const start = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor((parse(thursday) - parse(start)) / (7 * DAY)) + 1;
}

/** Whole weeks shown for a date, with what the arrows move to. */
export function calendarRange(view: CalendarView, date: string) {
  if (view === "week") {
    const from = monday(date);
    return { from, to: addDays(from, 6), prev: addDays(from, -7), next: addDays(from, 7) };
  }
  const first = `${date.slice(0, 7)}-01`;
  const nextMonth = new Date(parse(first));
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const next = nextMonth.toISOString().slice(0, 10);
  return { from: monday(first), to: addDays(monday(addDays(next, -1)), 6), prev: addDays(first, -1), next };
}

export function daysBetween(from: string, to: string) {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}
