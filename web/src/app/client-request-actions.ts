"use server";

// The team's side of the customer panel requests (owner, Nov 2026): orders from reorder requests and labels sent
// for approval. The database checks the roles (make_order_from_reorder, decline_reorder, request_label_approval).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import type { ActionState } from "@/app/actions";

const errorText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));
const val = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function makeOrderFromReorder(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  let id: string;
  try {
    id = (await q<{ id: string }>(user.id, "select make_order_from_reorder($1) as id", [val(fd, "request_id")]))[0].id;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/orders");
  redirect(`/orders/${id}`);
}

export async function declineReorder(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  try {
    await q(user.id, "select decline_reorder($1, $2)", [val(fd, "request_id"), val(fd, "reason")]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/orders/${val(fd, "order_id")}`);
  return { ok: true };
}

export async function sendLabelForApproval(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  try {
    await q(user.id, "select request_label_approval($1, $2, $3)", [val(fd, "order_id"), val(fd, "file_id"), val(fd, "note")]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/orders/${val(fd, "order_id")}`);
  return { ok: true };
}
