import Link from "next/link";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt } from "@/lib/i18n";
import { loadBoards } from "@/lib/boards";
import { BOARD_HEX, type BoardSummary } from "@/lib/boards-shared";
import { Empty, PageHeader } from "@/components/ui";
import { NewBoardForm } from "@/components/boards/new-board-form";

// Boards like Trello: the team's own planning (members and Admin; never Production or clients)
export default async function BoardsPage() {
  const { user, t } = await requireRole("admin", "sales", "designer");
  const B = t.boards;
  const { boards, people } = await withUser(user.id, async (tx) => ({
    boards: await loadBoards(tx),
    people: (await tx.query<{ id: string; full_name: string }>("select id, full_name from board_people() where id <> auth.uid()")).rows,
  }));
  const open = boards.filter((b) => !b.archived_at);
  const mine = open.filter((b) => b.member);
  const others = open.filter((b) => !b.member);
  const archived = boards.filter((b) => b.archived_at);

  const grid = (list: BoardSummary[]) => (
    <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))" }}>
      {list.map((b) => (
        <li key={b.id}>
          <Link href={`/boards/${b.id}`} className="flex min-h-24 flex-col justify-between gap-2 rounded-sm p-4 text-white no-underline hover:opacity-90"
            style={{ background: BOARD_HEX[b.color] ?? BOARD_HEX.blue }}>
            <span className="text-base font-bold break-words">{b.name}</span>
            <span className="flex flex-wrap gap-x-3 text-xs font-semibold">
              <span>{fmt(B.openCards, { n: b.open_cards })}</span>
              {b.mine > 0 && <span>{fmt(B.mineCount, { n: b.mine })}</span>}
              <span>{fmt(B.membersCount, { n: b.members })}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={B.title} subtitle={B.subtitle}
        actions={<Link href="/my-tasks" className="btn btn-outline">{B.myTasks}</Link>} />

      {!user.readOnly && <NewBoardForm people={people} T={B} />}

      <section aria-labelledby="my-boards-h" className="flex flex-col gap-3">
        <h2 id="my-boards-h" className="m-0 text-base font-bold">{B.myBoards}</h2>
        {mine.length === 0 ? <Empty>{B.none}</Empty> : grid(mine)}
      </section>

      {others.length > 0 && (
        <section aria-labelledby="other-boards-h" className="flex flex-col gap-3">
          <h2 id="other-boards-h" className="m-0 text-base font-bold">{B.otherBoards}</h2>
          {grid(others)}
        </section>
      )}

      {archived.length > 0 && (
        <details className="flex flex-col gap-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-base font-bold">{B.archivedBoards} · {archived.length}</summary>
          {grid(archived)}
        </details>
      )}
    </div>
  );
}
