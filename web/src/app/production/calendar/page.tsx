import Link from "next/link";
import { decideMoDate } from "@/app/calendar-actions";
import { CalendarToolbar } from "@/components/calendar-toolbar";
import { ProductionCalendar } from "@/components/production-calendar";
import { Card, Empty, PageHeader } from "@/components/ui";
import { calendarRange, today, validDay, type CalendarItem, type CalendarView } from "@/lib/calendar";
import { q } from "@/lib/db/engine";
import { fmt, formatDate } from "@/lib/i18n";
import { requireRole } from "@/lib/session";

/** What runs when: Admin drags batches; proposals of the partner and what is late come first. */
export default async function ProductionCalendarPage({ searchParams }: PageProps<"/production/calendar">) {
  const { user, locale, t } = await requireRole("admin", "sales");
  const C = t.calendar;
  const sp = await searchParams;
  const view: CalendarView = sp.view === "month" ? "month" : "week";
  const date = validDay(sp.date) ? sp.date : today();
  const range = calendarRange(view, date);
  const items = await q<CalendarItem>(user.id,
    `select id, code, status, on_date::text, product, product_bg, quantity, project_code, client, requested_date::text, date_state, proposed_date::text, date_note, late, past_requested
       from staff_calendar($1, $2)`, [range.from, range.to]);
  const canMove = user.role === "admin" && !user.readOnly;
  const proposals = items.filter((x) => x.date_state === "proposed");
  const late = items.filter((x) => x.late);
  const unplanned = items.filter((x) => !x.on_date);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={C.title} subtitle={C.subtitle} actions={<Link href="/production" className="btn btn-outline">{t.nav.batches}</Link>} />
      {proposals.length > 0 && (
        <Card title={C.proposals}>
          {proposals.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-mist py-2 text-sm last:border-0">
              <span className="flex min-w-0 flex-col">
                <Link href={`/production/${x.id}`} className="font-semibold text-ink">{x.code} · {x.client ?? x.project_code}</Link>
                <span className="text-xs text-ink-2">{fmt(C.proposedFrom, { from: formatDate(locale, x.on_date), to: formatDate(locale, x.proposed_date) })}{x.date_note ? ` · ${x.date_note}` : ""}</span>
              </span>
              {canMove && (
                <span className="flex gap-2">
                  <form action={decideMoDate}><input type="hidden" name="mo_id" value={x.id} /><input type="hidden" name="accept" value="on" /><button type="submit" className="btn btn-primary">{C.accept}</button></form>
                  <form action={decideMoDate}><input type="hidden" name="mo_id" value={x.id} /><button type="submit" className="btn btn-outline">{C.decline}</button></form>
                </span>
              )}
            </div>
          ))}
        </Card>
      )}
      {late.length > 0 && (
        <Card title={fmt(C.lateTitle, { n: late.length })}>
          {late.map((x) => <Link key={x.id} href={`/production/${x.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-mist py-1 text-sm text-ink no-underline last:border-0 hover:underline"><span className="font-semibold">{x.code} · {x.client ?? x.project_code}</span><span className="text-xs text-red-ink">{formatDate(locale, x.on_date)}</span></Link>)}
        </Card>
      )}
      <CalendarToolbar base="/production/calendar" view={view} date={date} from={range.from} prev={range.prev} next={range.next} locale={locale} t={t} />
      <ProductionCalendar items={items} from={range.from} to={range.to} month={view === "month" ? date.slice(0, 7) : null} locale={locale} canMove={canMove} linkBase="/production"
        labels={{ states: C.states, late: C.late, pastRequested: C.pastRequested, failed: C.failed, moveHint: C.moveHint, empty: C.empty }} />
      {items.filter((x) => x.on_date && x.on_date >= range.from && x.on_date <= range.to).length === 0 && <Empty>{C.empty}</Empty>}
      {unplanned.length > 0 && (
        <Card title={C.unplanned}>
          {unplanned.map((x) => <Link key={x.id} href={`/production/${x.id}`} className="flex min-h-11 items-center border-b border-mist py-1 text-sm text-ink no-underline last:border-0 hover:underline">{x.code} · {x.client ?? x.project_code ?? x.product}</Link>)}
        </Card>
      )}
    </div>
  );
}
