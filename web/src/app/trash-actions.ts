"use server";

// Trash (owner, Nov 2026): Admin restores what was deleted or deletes it for good.
// The database decides (trash_restore / trash_forget / trash_order); files leave
// Storage only when something is deleted for good.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { removeTrashFiles } from "@/lib/trash";
import type { ActionState } from "@/app/actions";

const errorText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));
const id = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
};

export async function restoreTrash(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "select trash_restore($1)", [id(fd, "id")]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t.trash.restored };
}

export async function forgetTrash(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    const [row] = await q<{ f: { bucket: string; path: string }[] }>(user.id, "select trash_forget($1) as f", [id(fd, "id")]);
    await removeTrashFiles(row?.f ?? []);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/settings/trash");
  return { ok: true, message: t.trash.forgotten };
}

/** Admin: an order before production goes to the trash with its draft invoices. */
export async function deleteOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "select trash_order($1)", [id(fd, "order_id")]);
  } catch (e) {
    const msg = errorText(e);
    return { error: /only be cancelled/.test(msg) ? t.orderDelete.blocked : msg };
  }
  revalidatePath("/orders");
  redirect("/orders");
}
