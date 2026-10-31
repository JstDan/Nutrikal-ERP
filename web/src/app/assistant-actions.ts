"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q } from "@/lib/db/engine";
import type { ChatLine, ChatProposal } from "@/components/assistant-chat";
import { getSession } from "@/lib/session";
import type { ActionState } from "@/app/actions";

async function conversation(userId: string, id: string) {
  return {
    messages: await q<ChatLine>(userId, "select id, role, content, model, created_at::text from ai_messages where conversation_id = $1 order by created_at", [id]),
    proposals: await q<ChatProposal>(userId, "select id, recipe, estimate, formula_id, created_at::text from ai_recipe_proposals where conversation_id = $1 order by created_at", [id]),
  };
}

export async function openPanelConversation(id: string) {
  const { user } = await getSession();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const c = await conversation(user.id, id);
  return c.messages.length ? c : null;
}

/** A person saves the proposal as a draft recipe, to review and approve as usual. */
export async function saveProposal(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  let id: string;
  try {
    id = (await q<{ id: string }>(user.id, "select recipe_from_proposal($1) as id", [String(fd.get("id") ?? "")]))[0].id;
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
  revalidatePath("/", "layout");
  redirect(`/formulas/${id}`);
}

export async function deleteConversation(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "delete from ai_conversations where id = $1", [String(fd.get("id") ?? "")]);
  revalidatePath("/assistant");
  redirect("/assistant");
}
