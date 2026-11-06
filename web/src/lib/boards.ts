// Boards (like Trello): loads as the signed-in user. Row-level security
// decides what is seen: members and Admin; never Production or clients.
import type { Tx } from "@/lib/db/engine";
import type { BoardData, BoardSummary } from "@/lib/boards-shared";

/** The boards the user sees: own (member) first, then the others Admin sees. */
export async function loadBoards(tx: Tx): Promise<BoardSummary[]> {
  return (await tx.query<BoardSummary>(
    `select b.id, b.name, b.color, b.archived_at::text,
            exists (select 1 from board_members m where m.board_id = b.id and m.user_id = auth.uid()) as member,
            (select count(*)::int from board_members m where m.board_id = b.id) as members,
            (select count(*)::int from board_cards c join board_lists l on l.id = c.list_id
              where c.board_id = b.id and c.done_at is null and c.archived_at is null and l.archived_at is null) as open_cards,
            (select count(*)::int from board_cards c join board_card_members cm on cm.card_id = c.id and cm.user_id = auth.uid()
              join board_lists l on l.id = c.list_id
              where c.board_id = b.id and c.done_at is null and c.archived_at is null and l.archived_at is null) as mine
       from boards b
      order by b.archived_at is not null, b.name`)).rows;
}

/** One board with everything on it, or null when it does not exist or is not visible. */
export async function loadBoard(tx: Tx, id: string): Promise<BoardData | null> {
  const board = (await tx.query<BoardData["board"]>(
    "select id, name, color, created_by, archived_at::text from boards where id = $1", [id])).rows[0];
  if (!board) return null;
  const rows = async <T>(sql: string) => (await tx.query<T>(sql, [id])).rows;
  // One after another: the queries share one transaction
  const members = await rows<BoardData["members"][number]>(
      `select m.user_id, p.full_name from board_members m join board_people() p on p.id = m.user_id
        where m.board_id = $1 order by p.full_name`);
  const people = (await tx.query<BoardData["people"][number]>("select id, full_name from board_people()")).rows;
  const lists = await rows<BoardData["lists"][number]>("select id, name, position, archived_at::text from board_lists where board_id = $1 order by position");
  const labels = await rows<BoardData["labels"][number]>("select id, name, color from board_labels where board_id = $1 order by color, name");
  // Linked records are named as the user may see them (a hidden one shows no name)
  const cards = await rows<BoardData["cards"][number]>(
      `select c.id, c.list_id, c.title, c.description, c.position, c.due_on::text, c.done_at::text, c.archived_at::text,
              c.created_by, c.created_at::text,
              c.client_id, (select legal_name from clients where id = c.client_id) as client,
              c.project_id, (select code || ' · ' || name from projects where id = c.project_id) as project,
              c.sales_order_id, (select code from sales_order_overview where id = c.sales_order_id) as sales_order
         from board_cards c where c.board_id = $1 order by c.position`);
  const cardMembers = await rows<BoardData["cardMembers"][number]>(
      "select cm.card_id, cm.user_id from board_card_members cm join board_cards c on c.id = cm.card_id where c.board_id = $1");
  const cardLabels = await rows<BoardData["cardLabels"][number]>(
      "select cl.card_id, cl.label_id from board_card_labels cl join board_cards c on c.id = cl.card_id where c.board_id = $1");
  const checklist = await rows<BoardData["checklist"][number]>(
      `select i.id, i.card_id, i.text, i.done, i.position from board_checklist_items i
         join board_cards c on c.id = i.card_id where c.board_id = $1 order by i.position`);
  const comments = await rows<BoardData["comments"][number]>(
      `select m.id, m.card_id, m.author_id, m.body, m.created_at::text, m.edited_at::text from board_comments m
         join board_cards c on c.id = m.card_id where c.board_id = $1 order by m.created_at`);
  const files = await rows<BoardData["files"][number]>(
      `select f.id, f.card_id, f.name, f.size::int, f.mime, f.uploaded_by, f.created_at::text from board_files f
         join board_cards c on c.id = f.card_id where c.board_id = $1 order by f.created_at`);
  const clients = await tx.query<{ id: string; label: string }>("select id, legal_name as label from clients order by legal_name");
  const projects = await tx.query<{ id: string; label: string }>("select id, code || ' · ' || name as label from projects order by code desc");
  const orders = await tx.query<{ id: string; label: string }>(
    "select id, code || ' · ' || client as label from sales_order_overview where status <> 'cancelled' order by created_at desc limit 300");
  const targets = await tx.query<BoardData["moveTargets"][number]>(
      `select b.id, b.name, coalesce((select json_agg(json_build_object('id', l.id, 'name', l.name) order by l.position)
                                        from board_lists l where l.board_id = b.id and l.archived_at is null), '[]') as lists
         from boards b where b.id <> $1 and b.archived_at is null and can_edit_board(b.id)
          and exists (select 1 from board_members m where m.board_id = b.id and m.user_id = auth.uid())
        order by b.name`, [id]);
  return {
    board, members, people, lists, labels, cards, cardMembers, cardLabels, checklist, comments, files,
    options: { clients: clients.rows, projects: projects.rows, orders: orders.rows },
    moveTargets: targets.rows.filter((b) => b.lists.length > 0),
  };
}

export type MyCard = {
  kind: "card" | "task"; id: string; title: string; due_on: string | null; href: string; where: string;
};

/** Open cards the user is on (any board) and open order tasks assigned to them. */
export async function loadMyWork(tx: Tx, locale: string): Promise<MyCard[]> {
  const cards = (await tx.query<MyCard>(
    `select 'card' as kind, c.id, c.title, c.due_on::text, '/boards/' || c.board_id || '?card=' || c.id as href,
            b.name || ' · ' || l.name as "where"
       from board_cards c
       join board_card_members cm on cm.card_id = c.id and cm.user_id = auth.uid()
       join boards b on b.id = c.board_id
       join board_lists l on l.id = c.list_id
      where c.done_at is null and c.archived_at is null and l.archived_at is null and b.archived_at is null`)).rows;
  // Order tasks are read by Admin and Sales only; others simply get none
  const tasks = (await tx.query<MyCard>(
    `select 'task' as kind, t.id, case when $1 = 'en' then coalesce(t.title_en, t.title) else t.title end as title,
            null::text as due_on, '/orders/' || b.sales_order_id || '?task=' || t.id as href,
            o.code || ' · ' || case when $1 = 'en' then coalesce(c.name_en, c.name_bg) else c.name_bg end as "where"
       from order_tasks t
       join order_task_boards b on b.id = t.board_id
       join order_task_columns c on c.id = t.column_id
       join sales_orders o on o.id = b.sales_order_id
      where t.assignee_id = auth.uid() and t.status <> 'done' and t.kind = 'manual' and o.status <> 'cancelled'`, [locale])).rows;
  return [...cards, ...tasks];
}
