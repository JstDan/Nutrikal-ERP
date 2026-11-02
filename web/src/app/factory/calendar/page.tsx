import { answerMoDate } from "@/app/calendar-actions";
import { ActionForm } from "@/components/action-form";
import { CalendarToolbar } from "@/components/calendar-toolbar";
import { ProductionCalendar } from "@/components/production-calendar";
import { Card, Empty, PageHeader } from "@/components/ui";
import { calendarRange, today, validDay, type CalendarItem, type CalendarView } from "@/lib/calendar";
import { q } from "@/lib/db/engine";
import { fmt, formatDate, formatNumber } from "@/lib/i18n";
import { requireRole } from "@/lib/session";

/** The partner's calendar: project codes only. Dates waiting for an answer come first. */
export default async function FactoryCalendarPage({ searchParams }: PageProps<"/factory/calendar">) {
  const { user, locale, t } = await requireRole("production", "admin");
  const C = t.calendar;
  const sp = await searchParams;
  const view: CalendarView = sp.view === "month" ? "month" : "week";
  const date = validDay(sp.date) ? sp.date : today();
  const range = calendarRange(view, date);
  const items = await q<CalendarItem>(user.id,
    `select id, code, status, on_date::text, product, product_bg, quantity, project_code, date_state, proposed_date::text, date_note, late
       from production_calendar($1, $2)`, [range.from, range.to]);
  const waiting = items.filter((x) => x.date_state === "pending" && x.status !== "completed");
  const canAnswer = user.access === "production";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={C.title} subtitle={C.factorySubtitle} />
      {waiting.length > 0 && (
        <Card title={fmt(C.toConfirm, { n: waiting.length })}>
          {waiting.map((x) => (
            <div key={x.id} className="flex flex-col gap-2 border-b border-mist py-3 text-sm last:border-0">
              <span className="font-semibold">{x.code} · {x.project_code} · {locale === "bg" && x.product_bg ? x.product_bg : x.product} · {formatNumber(locale, x.quantity)}</span>
              <span className="text-ink-2">{formatDate(locale, x.on_date)}</span>
              {canAnswer && (
                <div className="flex flex-wrap items-start gap-4">
                  <ActionForm action={answerMoDate} submitLabel={C.confirm} resetOnSuccess={false}>
                    <input type="hidden" name="mo_id" value={x.id} />
                  </ActionForm>
                  <ActionForm action={answerMoDate} submitLabel={C.propose} className="min-w-0 flex-[1_1_260px]">
                    <input type="hidden" name="mo_id" value={x.id} />
                    <label className="field"><span>{C.proposedDate}</span><input name="date" type="date" required className="input" /></label>
                    <label className="field"><span>{C.note}</span><input name="note" className="input" /></label>
                  </ActionForm>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
      <CalendarToolbar base="/factory/calendar" view={view} date={date} from={range.from} prev={range.prev} next={range.next} locale={locale} t={t} />
      <ProductionCalendar items={items} from={range.from} to={range.to} month={view === "month" ? date.slice(0, 7) : null} locale={locale} canMove={false} linkBase="/factory/orders"
        labels={{ states: C.states, late: C.late, pastRequested: C.pastRequested, failed: C.failed, moveHint: C.moveHint, empty: C.empty }} />
      {items.filter((x) => x.on_date && x.on_date >= range.from && x.on_date <= range.to).length === 0 && <Empty>{C.empty}</Empty>}
    </div>
  );
}
