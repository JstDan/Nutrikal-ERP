import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { formatDate } from "@/lib/i18n";
import { loadMyWork, type MyCard } from "@/lib/boards";
import { DUE_TONE, dueState, todaySofia } from "@/lib/boards-shared";
import { Empty, PageHeader } from "@/components/ui";

type Group = "overdue" | "today" | "week" | "later" | "noDate";

/** Everything open for the signed-in user: cards of every board, and manual order tasks assigned to them. */
export default async function MyTasksPage() {
  const { user, locale, t } = await requireRole("admin", "sales", "designer");
  const B = t.boards;
  const M = B.my;
  const work = await withUser(user.id, (tx) => loadMyWork(tx, locale));
  const today = todaySofia();
  const inWeek = new Date(Date.parse(today) + 7 * 86400000).toISOString().slice(0, 10);
  const groupOf = (w: MyCard): Group =>
    !w.due_on ? "noDate" : w.due_on < today ? "overdue" : w.due_on === today ? "today" : w.due_on <= inWeek ? "week" : "later";
  const order: Group[] = ["overdue", "today", "week", "later", "noDate"];
  const sorted = [...work].sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999") || a.title.localeCompare(b.title));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={M.title} subtitle={M.subtitle} actions={<Link href="/boards" className="btn btn-outline">{B.allBoards}</Link>} />
      {work.length === 0 && <Empty>{M.empty}</Empty>}
      {order.map((g) => {
        const rows = sorted.filter((w) => groupOf(w) === g);
        if (rows.length === 0) return null;
        return (
          <section key={g} aria-labelledby={`my-${g}`} className="card px-5 py-3">
            <h2 id={`my-${g}`} className={`m-0 py-1 text-base font-bold ${g === "overdue" ? "text-red-ink" : ""}`}>{M[g]} · {rows.length}</h2>
            <ul className="m-0 list-none p-0">
              {rows.map((w) => {
                const due = dueState(w.due_on, false, today);
                return (
                  <li key={`${w.kind}-${w.id}`} className="border-b border-mist last:border-0">
                    <Link href={w.href} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm text-ink no-underline hover:bg-canvas">
                      <span className="min-w-0 flex-[1_1_240px]">
                        <span className="block font-semibold break-words">{w.title}</span>
                        <span className="block text-xs break-words text-ink-2">{w.kind === "card" ? M.card : M.task} · {w.where}</span>
                      </span>
                      {due && w.due_on && (
                        <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${DUE_TONE[due]}`}>
                          {B.due[due]} · {formatDate(locale, w.due_on)}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
