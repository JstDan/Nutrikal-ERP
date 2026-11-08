"use server";

import { revalidatePath } from "next/cache";
import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import type { ActionState } from "@/app/actions";

// Nutri AI's memory (owner, Nov 2026): Admin writes, approves, changes and deletes the notes; the database allows
// it to Admin only (ai_knowledge policies), so these actions only pass the request on.

const done = (message: string): ActionState => { revalidatePath("/settings/ai"); return { ok: true, message }; };
const fail = (e: unknown): ActionState => ({ error: e instanceof Error ? e.message.split("\n")[0] : String(e) });

export async function addKnowledge(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const body = String(fd.get("body") ?? "").trim();
  if (!body) return { error: t.adminSettings.ai.emptyNote };
  try {
    await q(user.id, "insert into ai_knowledge (body, status) values ($1, 'approved')", [body.slice(0, 1000)]);
  } catch (e) { return fail(e); }
  return done(t.common.saved);
}

export async function saveKnowledge(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const body = String(fd.get("body") ?? "").trim();
  if (!body) return { error: t.adminSettings.ai.emptyNote };
  try {
    // Saving a proposal approves it
    await q(user.id, "update ai_knowledge set body = $2, status = 'approved' where id = $1", [String(fd.get("id")), body.slice(0, 1000)]);
  } catch (e) { return fail(e); }
  return done(t.common.saved);
}

export async function deleteKnowledge(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "delete from ai_knowledge where id = $1", [String(fd.get("id"))]);
  } catch (e) { return fail(e); }
  return done(t.common.saved);
}
