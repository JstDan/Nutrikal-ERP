"use server";

// The production calendar. The SQL functions decide who may do what.
import { revalidatePath } from "next/cache";
import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import type { ActionState } from "@/app/actions";

const failure = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));

export async function rescheduleMo(id: string, date: string): Promise<{ error?: string }> {
  const { user } = await getSession();
  try {
    await q(user.id, "select mo_reschedule($1, $2::date)", [id, date]);
  } catch (e) {
    return { error: failure(e) };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function moveMoDate(_: ActionState, fd: FormData): Promise<ActionState> {
  const { t } = await getSession();
  const r = await rescheduleMo(String(fd.get("mo_id") ?? ""), String(fd.get("date") ?? ""));
  return r.error ? { error: r.error } : { ok: true, message: t.common.saved };
}

/** The partner: without a date it confirms, with a date it proposes. */
export async function answerMoDate(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "select mo_date_answer($1, $2::date, $3)", [String(fd.get("mo_id") ?? ""), String(fd.get("date") ?? "") || null, String(fd.get("note") ?? "")]);
  } catch (e) {
    return { error: failure(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t.common.saved };
}

export async function decideMoDate(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "select mo_date_decide($1, $2)", [String(fd.get("mo_id") ?? ""), fd.get("accept") === "on"]);
  revalidatePath("/", "layout");
}
