import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { loadBoard } from "@/lib/boards";
import { todaySofia } from "@/lib/boards-shared";
import { BoardView } from "@/components/boards/board-view";

export default async function BoardPage({ params, searchParams }: PageProps<"/boards/[id]">) {
  const { user, locale, t } = await requireRole("admin", "sales", "designer");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withUser(user.id, (tx) => loadBoard(tx, id));
  if (!data) notFound();
  const isMember = data.members.some((m) => m.user_id === user.id);
  const canEdit = !user.readOnly && (isMember || user.role === "admin");
  const card = typeof sp.card === "string" && data.cards.some((c) => c.id === sp.card) ? sp.card : null;

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={t.boards.allBoards} className="text-sm">
        <Link href="/boards" className="text-ink underline">{t.boards.allBoards}</Link>
      </nav>
      <BoardView key={data.board.id} data={data} locale={locale} userId={user.id} isAdmin={user.role === "admin" && !user.readOnly}
        canEdit={canEdit} T={t.boards} today={todaySofia()} initialCard={card}
        fileText={{ tooBig: t.tasks.panel.fileTooBig, type: t.tasks.panel.fileType, limits: t.tasks.panel.fileLimits }} />
    </div>
  );
}
