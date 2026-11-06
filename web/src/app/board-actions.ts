"use server";

// Boards (like Trello). Every change is a plain statement run as the
// signed-in user: row-level security and the triggers of the boards
// migration decide (members and Admin; never Production or clients).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { q, withUser } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { fmt } from "@/lib/i18n";
import { newTaskFilePath, putFile, removeFile } from "@/lib/files";
import { BOARD_BUCKET, BOARD_COLORS, LABEL_COLORS } from "@/lib/boards-shared";
import { fileExt, TASK_FILE_MAX, TASK_FILE_TYPES } from "@/lib/tasks-shared";

export type BoardResult = { ok?: boolean; error?: string; id?: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));
const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const color = (v: unknown, list: readonly string[]) => (typeof v === "string" && list.includes(v) ? v : null);

/** Statements that change something and must touch a row; 0 rows means not allowed or gone. */
type Op = [sql: string, params: unknown[]];
const OPS = {
  renameBoard: (a: Args): Op => ["update boards set name = $2, color = coalesce($3, color) where id = $1 returning id",
    [a.board, text(a.name), color(a.color, BOARD_COLORS)]],
  archiveBoard: (a: Args): Op => ["update boards set archived_at = case when $2 then now() end where id = $1 returning id", [a.board, a.on === true]],
  addMember: (a: Args): Op => ["insert into board_members (board_id, user_id) values ($1, $2) on conflict do nothing returning board_id as id", [a.board, uuid(a.user)]],
  removeMember: (a: Args): Op => ["delete from board_members where board_id = $1 and user_id = $2 returning board_id as id", [a.board, uuid(a.user)]],
  addList: (a: Args): Op => ["insert into board_lists (board_id, name, position) values ($1, $2, $3) returning id", [a.board, text(a.name), num(a.position) ?? 1]],
  renameList: (a: Args): Op => ["update board_lists set name = $3 where id = $2 and board_id = $1 returning id", [a.board, uuid(a.list), text(a.name)]],
  moveList: (a: Args): Op => ["update board_lists set position = $3 where id = $2 and board_id = $1 returning id", [a.board, uuid(a.list), num(a.position)]],
  archiveList: (a: Args): Op => ["update board_lists set archived_at = case when $3 then now() end where id = $2 and board_id = $1 returning id",
    [a.board, uuid(a.list), a.on === true]],
  addCard: (a: Args): Op => ["insert into board_cards (list_id, title, position) select id, $3, $4 from board_lists where id = $2 and board_id = $1 returning id",
    [a.board, uuid(a.list), text(a.title), num(a.position) ?? 1]],
  saveCard: (a: Args): Op => ["update board_cards set title = $3, description = $4 where id = $2 and board_id = $1 returning id",
    [a.board, uuid(a.card), text(a.title), typeof a.description === "string" ? a.description : ""]],
  setDue: (a: Args): Op => ["update board_cards set due_on = $3::date where id = $2 and board_id = $1 returning id", [a.board, uuid(a.card), date(a.due)]],
  setDone: (a: Args): Op => ["update board_cards set done_at = case when $3 then coalesce(done_at, now()) end where id = $2 and board_id = $1 returning id",
    [a.board, uuid(a.card), a.on === true]],
  // The list decides the board: a list of another board moves the card there
  moveCard: (a: Args): Op => ["update board_cards set list_id = $3, position = $4 where id = $2 and board_id = $1 returning id",
    [a.board, uuid(a.card), uuid(a.list), num(a.position) ?? 1]],
  archiveCard: (a: Args): Op => ["update board_cards set archived_at = case when $3 then now() end where id = $2 and board_id = $1 returning id",
    [a.board, uuid(a.card), a.on === true]],
  linkCard: (a: Args): Op => ["update board_cards set client_id = $3, project_id = $4, sales_order_id = $5 where id = $2 and board_id = $1 returning id",
    [a.board, uuid(a.card), uuid(a.client), uuid(a.project), uuid(a.order)]],
  cardMember: (a: Args): Op => a.on === true
    ? ["insert into board_card_members (card_id, user_id) select id, $3 from board_cards where id = $2 and board_id = $1 on conflict do nothing returning card_id as id",
       [a.board, uuid(a.card), uuid(a.user)]]
    : ["delete from board_card_members cm using board_cards c where c.id = cm.card_id and c.board_id = $1 and cm.card_id = $2 and cm.user_id = $3 returning cm.card_id as id",
       [a.board, uuid(a.card), uuid(a.user)]],
  cardLabel: (a: Args): Op => a.on === true
    ? ["insert into board_card_labels (card_id, label_id) select id, $3 from board_cards where id = $2 and board_id = $1 on conflict do nothing returning card_id as id",
       [a.board, uuid(a.card), uuid(a.label)]]
    : ["delete from board_card_labels cl using board_cards c where c.id = cl.card_id and c.board_id = $1 and cl.card_id = $2 and cl.label_id = $3 returning cl.card_id as id",
       [a.board, uuid(a.card), uuid(a.label)]],
  addLabel: (a: Args): Op => ["insert into board_labels (board_id, name, color) values ($1, $2, $3) returning id",
    [a.board, text(a.name) ?? "", color(a.color, LABEL_COLORS)]],
  saveLabel: (a: Args): Op => ["update board_labels set name = $3, color = coalesce($4, color) where id = $2 and board_id = $1 returning id",
    [a.board, uuid(a.label), text(a.name) ?? "", color(a.color, LABEL_COLORS)]],
  deleteLabel: (a: Args): Op => ["delete from board_labels where id = $2 and board_id = $1 returning id", [a.board, uuid(a.label)]],
  addItem: (a: Args): Op => ["insert into board_checklist_items (card_id, text, position) select id, $3, $4 from board_cards where id = $2 and board_id = $1 returning id",
    [a.board, uuid(a.card), text(a.text), num(a.position) ?? 1]],
  updateItem: (a: Args): Op => [`update board_checklist_items i set done = coalesce($3, i.done), text = coalesce($4, i.text), position = coalesce($5, i.position)
                                   from board_cards c where c.id = i.card_id and c.board_id = $1 and i.id = $2 returning i.id`,
    [a.board, uuid(a.item), typeof a.done === "boolean" ? a.done : null, text(a.text) || null, num(a.position)]],
  deleteItem: (a: Args): Op => ["delete from board_checklist_items i using board_cards c where c.id = i.card_id and c.board_id = $1 and i.id = $2 returning i.id",
    [a.board, uuid(a.item)]],
  postComment: (a: Args): Op => ["insert into board_comments (card_id, body, mentions) select id, $3, $4::uuid[] from board_cards where id = $2 and board_id = $1 returning id",
    [a.board, uuid(a.card), text(a.body), Array.isArray(a.mentions) ? a.mentions.map(uuid).filter(Boolean) : []]],
  editComment: (a: Args): Op => ["update board_comments m set body = $3 from board_cards c where c.id = m.card_id and c.board_id = $1 and m.id = $2 returning m.id",
    [a.board, uuid(a.comment), text(a.body)]],
  deleteComment: (a: Args): Op => ["delete from board_comments m using board_cards c where c.id = m.card_id and c.board_id = $1 and m.id = $2 returning m.id",
    [a.board, uuid(a.comment)]],
} satisfies Record<string, (a: Args) => Op>;
type Args = Record<string, unknown>;
export type BoardOp = keyof typeof OPS;

const refresh = (boardId: string) => {
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/boards");
  revalidatePath("/my-tasks");
};

/** One change on a board; the page is refreshed afterwards. */
export async function boardOp(boardId: string, op: BoardOp, args: Args): Promise<BoardResult> {
  const { user, t } = await getSession();
  const build = OPS[op] as ((a: Args) => Op) | undefined;
  if (!build || !uuid(boardId)) return { error: "Unknown action" };
  try {
    const [sql, params] = build({ ...args, board: boardId });
    const rows = await q<{ id: string }>(user.id, sql, params);
    // Nothing touched: the row is gone or this user may not change it
    if (rows.length === 0 && !["addMember", "cardMember", "cardLabel"].includes(op)) return { error: t.boards.notAllowed };
    refresh(boardId);
    return { ok: true, id: rows[0]?.id };
  } catch (e) {
    return { error: errorText(e) };
  }
}

/** A new board from a ready template (texts in the user's language); opens it. */
export async function createBoard(fd: FormData): Promise<BoardResult> {
  const { user, t } = await getSession();
  const name = text(fd.get("name"));
  if (!name) return { error: t.boards.nameRequired };
  const members = fd.getAll("member").map(uuid).filter(Boolean);
  const templates = t.boards.templates as Record<string, { labels: unknown; lists: unknown }>;
  const tpl = templates[String(fd.get("template") ?? "")] ?? templates.blank;
  let id: string | undefined;
  try {
    id = (await q<{ id: string }>(user.id, "select create_board_from($1, $2, $3::jsonb, $4::uuid[]) as id",
      [name, color(fd.get("color"), BOARD_COLORS) ?? "blue", JSON.stringify({ labels: tpl.labels, lists: tpl.lists }), members]))[0]?.id;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/boards");
  redirect(`/boards/${id}`);
}

/** A copy of a board one sees (lists, labels, cards, checklists); opens it. */
export async function copyBoard(boardId: string, name: string): Promise<BoardResult> {
  const { user, t } = await getSession();
  const n = name.trim();
  if (!uuid(boardId)) return { error: "Unknown board" };
  if (!n) return { error: t.boards.nameRequired };
  let id: string | undefined;
  try {
    id = (await q<{ id: string }>(user.id, "select copy_board($1, $2) as id", [boardId, n.slice(0, 100)]))[0]?.id;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/boards");
  redirect(`/boards/${id}`);
}

/** Removes rows that hold files, then their files from Storage (after the rows are gone). */
async function deleteWithFiles(userId: string, sql: string, params: unknown[], filesSql: string): Promise<boolean> {
  let paths: string[] = [];
  const n = await withUser(userId, async (tx) => {
    paths = (await tx.query<{ storage_path: string }>(filesSql, params)).rows.map((r) => r.storage_path);
    return (await tx.query(sql, params)).rows.length;
  });
  for (const p of paths) await removeFile(BOARD_BUCKET, p).catch(() => {});
  return n > 0;
}

/** Deletes a card, a list (with its cards) or the whole board, files included. */
export async function deleteBoardPart(boardId: string, part: "card" | "list" | "board", id: string): Promise<BoardResult> {
  const { user, t } = await getSession();
  if (!uuid(boardId) || !uuid(id)) return { error: "Unknown action" };
  const sql = {
    card: ["delete from board_cards where id = $2 and board_id = $1 returning id",
      "select f.storage_path from board_files f join board_cards c on c.id = f.card_id where c.id = $2 and c.board_id = $1"],
    list: ["delete from board_lists where id = $2 and board_id = $1 returning id",
      "select f.storage_path from board_files f join board_cards c on c.id = f.card_id where c.list_id = $2 and c.board_id = $1"],
    board: ["delete from boards where id = $1 and id = $2 returning id",
      "select f.storage_path from board_files f join board_cards c on c.id = f.card_id where c.board_id = $1 and c.board_id = $2"],
  }[part];
  try {
    if (!(await deleteWithFiles(user.id, sql[0], [boardId, id], sql[1]))) return { error: t.boards.notAllowed };
  } catch (e) {
    return { error: errorText(e) };
  }
  refresh(boardId);
  if (part === "board") redirect("/boards");
  return { ok: true };
}

/** Deletes a file of a card (own; Admin any) and removes it from Storage. */
export async function deleteBoardFile(boardId: string, fileId: string): Promise<BoardResult> {
  const { user, t } = await getSession();
  try {
    const [row] = await q<{ storage_path: string }>(user.id,
      `delete from board_files f using board_cards c where c.id = f.card_id and c.board_id = $1 and f.id = $2 returning f.storage_path`,
      [uuid(boardId), uuid(fileId)]);
    if (!row) return { error: t.boards.notAllowed };
    await removeFile(BOARD_BUCKET, row.storage_path).catch(() => {});
  } catch (e) {
    return { error: errorText(e) };
  }
  refresh(boardId);
  return { ok: true };
}

/** One file of a card: recorded (row-level security decides), then stored; nothing is kept if storing fails. */
export async function uploadBoardFile(fd: FormData): Promise<BoardResult> {
  const { user, t } = await getSession();
  const P = t.tasks.panel;
  const boardId = uuid(fd.get("board_id")), cardId = uuid(fd.get("card_id"));
  const file = fd.get("file");
  if (!boardId || !cardId || !(file instanceof File) || file.size === 0) return { error: "Unknown file" };
  if (file.size > TASK_FILE_MAX) return { error: fmt(P.fileTooBig, { name: file.name }) };
  if (!TASK_FILE_TYPES.includes(fileExt(file.name))) return { error: fmt(P.fileType, { name: file.name }) };
  const key = newTaskFilePath(boardId, cardId, file.name);
  try {
    await withUser(user.id, async (tx) => {
      await tx.query("insert into board_files (card_id, storage_path, name, size, mime) values ($1, $2, $3, $4, $5)",
        [cardId, key, file.name.slice(0, 200), file.size, file.type || null]);
      await putFile(BOARD_BUCKET, key, Buffer.from(await file.arrayBuffer()), file.type || undefined);
    });
  } catch (e) {
    return { error: errorText(e) };
  }
  refresh(boardId);
  return { ok: true };
}
