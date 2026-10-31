"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import type { ActionState } from "@/app/actions";
import type { ChatMessage } from "@/components/chat-room";

const FEED = "select id, author_id, author, body, created_at::text from chat_feed($1, $2::timestamptz)";

/** New messages since the last one seen; reading them marks the channel as read. */
export async function pollChat(channel: string, after: string | null): Promise<ChatMessage[]> {
  const { user } = await getSession();
  const rows = await q<ChatMessage>(user.id, FEED, [channel, after]);
  if (rows.length && !user.readOnly) {
    await q(user.id, "insert into chat_reads (channel_id, user_id) values ($1, auth.uid()) on conflict (channel_id, user_id) do update set read_at = now()", [channel]);
  }
  return rows;
}

export async function sendChat(channel: string, body: string): Promise<{ error?: string }> {
  const { user } = await getSession();
  const text = body.trim();
  if (!text) return {};
  try {
    await q(user.id, "insert into chat_messages (channel_id, body) values ($1, $2)", [channel, text]);
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
  return {};
}

export async function deleteChatMessage(id: string) {
  const { user } = await getSession();
  await q(user.id, "delete from chat_messages where id = $1", [id]);
}

export async function createChannel(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  const name = String(fd.get("name") ?? "").trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-");
  let id: string;
  try {
    id = (await q<{ id: string }>(user.id, "insert into chat_channels (name, description) values ($1, $2) returning id", [name, String(fd.get("description") ?? "").trim() || null]))[0].id;
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
  revalidatePath("/chat");
  redirect(`/chat?c=${id}`);
}
