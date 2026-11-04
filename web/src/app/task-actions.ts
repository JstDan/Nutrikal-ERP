"use server";

// Order Task Manager actions. Every change goes through a database
// function that checks the role (admin and sales; production is refused)
// and writes the activity log; nothing is decided here.
import { revalidatePath } from "next/cache";
import { q, withUser } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { fmt } from "@/lib/i18n";
import { getFile, newTaskFilePath, putFile, removeFile } from "@/lib/files";
import { TASK_BUCKET } from "@/lib/tasks";
import { fileExt, TASK_FILE_MAX, TASK_FILE_TYPES } from "@/lib/tasks-shared";
import type { ActionState } from "@/app/actions";

export type TaskResult = ActionState & { id?: string; n?: number };

const errorText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));
const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
const text = (v: unknown) => (typeof v === "string" ? v : null);

// op -> SQL and its parameters (only these can be run)
const OPS = {
  addTask: (a: Args) => ["select add_order_task($1, $2) as id", [uuid(a.column), text(a.title)]],
  saveTask: (a: Args) => ["select save_order_task($1, $2, $3, $4)", [uuid(a.task), text(a.title), text(a.description) ?? "", uuid(a.assignee)]],
  setStatus: (a: Args) => ["select set_order_task_status($1, $2::order_task_status)", [uuid(a.task), text(a.status)]],
  moveTask: (a: Args) => ["select move_order_task($1, $2, $3)", [uuid(a.task), uuid(a.column), num(a.position)]],
  deleteTask: (a: Args) => ["select delete_order_task($1)", [uuid(a.task)]],
  override: (a: Args) => ["select override_order_task($1, $2, $3)", [uuid(a.task), a.done === true, text(a.reason)]],
  clearOverride: (a: Args) => ["select clear_order_task_override($1)", [uuid(a.task)]],
  addItem: (a: Args) => ["select add_order_task_checklist_item($1, $2) as id", [uuid(a.task), text(a.text)]],
  updateItem: (a: Args) => ["select update_order_task_checklist_item($1, $2, $3, $4)",
    [uuid(a.item), typeof a.done === "boolean" ? a.done : null, text(a.text), num(a.position)]],
  deleteItem: (a: Args) => ["select delete_order_task_checklist_item($1)", [uuid(a.item)]],
  setDependency: (a: Args) => ["select set_order_task_dependency($1, $2, $3)", [uuid(a.task), uuid(a.on), a.add !== false]],
  addLink: (a: Args) => ["select add_order_task_link($1, $2, $3) as id", [uuid(a.task), text(a.type), uuid(a.entity)]],
  removeLink: (a: Args) => ["select remove_order_task_link($1)", [uuid(a.link)]],
  postComment: (a: Args) => ["select post_order_task_comment($1, $2, $3::uuid[]) as id",
    [uuid(a.task), text(a.body) ?? "", Array.isArray(a.mentions) ? a.mentions.map(uuid).filter(Boolean) : []]],
  editComment: (a: Args) => ["select edit_order_task_comment($1, $2)", [uuid(a.comment), text(a.body)]],
  deleteComment: (a: Args) => ["select delete_order_task_comment($1)", [uuid(a.comment)]],
  markRead: (a: Args) => ["select mark_order_task_read($1)", [uuid(a.task)]],
  refreshMaterials: (a: Args) => ["select refresh_order_materials($1)", [uuid(a.order)]],
  requestMissing: (a: Args) => ["select create_order_shortfall_requests($1) as n", [uuid(a.order)]],
  addColumn: (a: Args) => ["select add_order_task_column($1, $2, $3, $4, $5, $6) as id",
    [uuid(a.board), text(a.name_bg), text(a.name_en), text(a.color) ?? "grey", uuid(a.before), a.template === true]],
  updateColumn: (a: Args) => ["select update_order_task_column($1, $2, $3, $4, $5, $6)",
    [uuid(a.column), text(a.name_bg), text(a.name_en), text(a.color), typeof a.hidden === "boolean" ? a.hidden : null, a.template === true]],
  moveColumn: (a: Args) => ["select move_order_task_column($1, $2, $3)", [uuid(a.column), num(a.position), a.template === true]],
  deleteColumn: (a: Args) => ["select delete_order_task_column($1, $2)", [uuid(a.column), uuid(a.moveTo)]],
} satisfies Record<string, (a: Args) => [string, unknown[]]>;
type Args = Record<string, unknown>;
export type TaskOp = keyof typeof OPS;
function num(v: unknown) {
  const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** A money amount (2 decimals; a comma is a decimal point too). */
function amount(v: unknown) {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.trim().replace(/\s/g, "").replace(",", ".")) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** One change on an order's board; the page is refreshed afterwards. */
export async function taskOp(orderId: string, op: TaskOp, args: Args): Promise<TaskResult> {
  const { user } = await getSession();
  const build = OPS[op] as ((a: Args) => [string, unknown[]]) | undefined;
  if (!build || !uuid(orderId)) return { error: "Unknown action" };
  try {
    const [sql, params] = build({ ...args, order: orderId });
    const row = (await q<{ id?: string; n?: number }>(user.id, sql, params))[0];
    if (op !== "markRead") revalidatePath(`/orders/${orderId}`);
    return { ok: true, id: row?.id, n: row?.n };
  } catch (e) {
    return { error: errorText(e) };
  }
}

/** Deletes a file of a task (own; admin any) and removes it from Storage. */
export async function deleteTaskFile(orderId: string, fileId: string): Promise<TaskResult> {
  const { user } = await getSession();
  try {
    const [row] = await q<{ path: string }>(user.id, "select delete_order_task_file($1) as path", [uuid(fileId)]);
    if (row?.path) await removeFile(TASK_BUCKET, row.path);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

/** One file of a task (several are sent one by one): stored, then recorded; removed again if recording fails. */
export async function uploadTaskFile(fd: FormData): Promise<TaskResult> {
  const { user, t } = await getSession();
  const P = t.tasks.panel;
  const orderId = uuid(fd.get("order_id")), taskId = uuid(fd.get("task_id")), commentId = uuid(fd.get("comment_id"));
  const file = fd.get("file");
  if (!orderId || !taskId || !(file instanceof File) || file.size === 0) return { error: "Unknown file" };
  if (file.size > TASK_FILE_MAX) return { error: fmt(P.fileTooBig, { name: file.name }) };
  if (!TASK_FILE_TYPES.includes(fileExt(file.name))) return { error: fmt(P.fileType, { name: file.name }) };
  const key = newTaskFilePath(orderId, taskId, file.name);
  let stored = false;
  try {
    await withUser(user.id, async (tx) => {
      const ok = (await tx.query<{ ok: boolean }>("select can_access_order_task_path($1) as ok", [key])).rows[0]?.ok;
      if (!ok) throw new Error("Invalid file path");
      await putFile(TASK_BUCKET, key, Buffer.from(await file.arrayBuffer()), file.type || undefined);
      stored = true;
      await tx.query("select add_order_task_file($1, $2, $3, $4, $5, $6)", [taskId, key, file.name, file.size, file.type || null, commentId]);
    });
  } catch (e) {
    if (stored) await removeFile(TASK_BUCKET, key);
    return { error: errorText(e) };
  }
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

// ------------------------------------------------------------ proformas
type ProformaKind = "advance" | "final";

/** Stores one proforma file and records it on its task (or as waiting); replaced copies are removed. */
async function storeProforma(userId: string, orderId: string, kind: ProformaKind, name: string, data: Buffer) {
  const [{ task }] = await q<{ task: string | null }>(userId, "select order_proforma_task($1, $2) as task", [orderId, kind]);
  const key = newTaskFilePath(orderId, task ?? crypto.randomUUID(), name);
  await putFile(TASK_BUCKET, key, data, "application/pdf");
  try {
    const [{ old }] = await q<{ old: string[] }>(userId, "select keep_order_proforma($1, $2, $3, $4, $5) as old", [orderId, kind, key, name, data.length]);
    for (const p of old ?? []) await removeFile(TASK_BUCKET, p).catch(() => {});
  } catch (e) {
    await removeFile(TASK_BUCKET, key).catch(() => {});
    throw e;
  }
}

/**
 * A proforma was downloaded (owner, Nov 2026): the same PDF goes to Tasks, Payments & invoices
 * (the advance one to Payment, the final one to Final payment), or waits there for the board.
 */
export async function keepProforma(orderId: string, final: boolean, fileName: string, base64: string): Promise<TaskResult> {
  const { user } = await getSession();
  const order = uuid(orderId);
  const data = Buffer.from(base64, "base64");
  const name = fileName.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120);
  if (!order || !/\.pdf$/i.test(name) || data.length === 0 || data.length > TASK_FILE_MAX || data.subarray(0, 4).toString() !== "%PDF")
    return { error: "Invalid file" };
  try {
    await storeProforma(user.id, order, final ? "final" : "advance", name, data);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/orders/${order}`);
  return { ok: true };
}

/** Right after the board is made: proformas downloaded before it move to their tasks. */
async function movePendingProformas(userId: string, orderId: string) {
  const rows = await q<{ kind: ProformaKind; storage_path: string; name: string }>(userId,
    "select kind, storage_path, name from order_proforma_pending where order_id = $1", [orderId]);
  for (const r of rows) {
    try {
      const data = await getFile(TASK_BUCKET, r.storage_path);
      if (data) await storeProforma(userId, orderId, r.kind, r.name, data);
    } catch (e) {
      console.error("Proforma to task", e);
    }
  }
}

// ------------------------------------------------------------- payments
/** Admin: the first payment (the advance received, VAT included, or 100 %) and the board from the chosen template. */
export async function confirmFirstPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const orderId = uuid(fd.get("order_id"));
  try {
    await q(user.id, "select confirm_order_payment($1, $2, $3, $4)", [
      orderId, fd.get("received") === "full" ? "full" : "advance", amount(fd.get("amount")), uuid(fd.get("template_id")),
    ]);
  } catch (e) {
    return { error: errorText(e) };
  }
  if (orderId) await movePendingProformas(user.id, orderId);
  revalidatePath("/", "layout");
  return { ok: true, message: t.tasks.payment.confirmed };
}

/** Admin: the balance of an order paid with an advance. */
export async function confirmFinalPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "select confirm_final_payment($1)", [uuid(fd.get("order_id"))]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t.tasks.payment.finalConfirmed };
}

/** Admin: cancels a payment confirmed by mistake; the order is unpaid again and its task files are removed from Storage. */
export async function cancelOrderPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    const [row] = await q<{ files: string[] | null }>(user.id, "select cancel_order_payment($1, $2) as files", [uuid(fd.get("order_id")), text(fd.get("reason"))]);
    for (const path of row?.files ?? []) await removeFile(TASK_BUCKET, path);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t.tasks.payment.paymentCancelled };
}
