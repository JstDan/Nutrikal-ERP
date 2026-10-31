"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q, qChat } from "@/lib/db/engine";
import { CHAT_BUCKET, MAX_DESIGN_BYTES, newTaskFilePath, putFile } from "@/lib/files";
import { getSession } from "@/lib/session";
import type { ActionState } from "@/app/actions";
import type { ChatMessage } from "@/components/chat-room";

// The chat is the one thing a read-only account writes: qChat, and the rules of the chat tables decide.
const FEED = "select id, author_id, author, body, created_at::text, edited_at::text, attachments, reactions from chat_feed($1)";
const text = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));

const markRead = (userId: string, channel: string) =>
  qChat(userId, "insert into chat_reads (channel_id, user_id) values ($1, auth.uid()) on conflict (channel_id, user_id) do update set read_at = now()", [channel]);

/** The last messages with their reactions and files. New ones mark the channel as read. */
export async function pollChat(channel: string, seen: string | null): Promise<ChatMessage[]> {
  const { user } = await getSession();
  const rows = await q<ChatMessage>(user.id, FEED, [channel]);
  if (rows.at(-1)?.id !== seen) await markRead(user.id, channel);
  return rows;
}

/** A message with its files: fd has channel, body, mentions and files. */
export async function sendChat(fd: FormData): Promise<{ error?: string }> {
  const { user, t } = await getSession();
  const channel = String(fd.get("channel") ?? "");
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.some((f) => f.size > MAX_DESIGN_BYTES)) return { error: t.chat.tooBig };
  const body = String(fd.get("body") ?? "").trim() || (files.length ? "📎" : "");
  if (!body) return {};
  try {
    const mentions = (JSON.parse(String(fd.get("mentions") ?? "[]")) as string[]).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    const [{ id }] = await qChat<{ id: string }>(user.id, "select chat_post($1, $2, $3::uuid[]) as id", [channel, body, mentions]);
    for (const f of files) {
      const key = newTaskFilePath(channel, randomUUID(), f.name);
      await putFile(CHAT_BUCKET, key, Buffer.from(await f.arrayBuffer()), f.type || "application/octet-stream");
      await qChat(user.id, "insert into chat_attachments (message_id, file_name, storage_path, mime, size_bytes) values ($1, $2, $3, $4, $5)",
        [id, f.name, key, f.type || null, f.size]);
    }
  } catch (e) {
    return { error: text(e) };
  }
  return {};
}

export async function editChatMessage(id: string, body: string) {
  const { user } = await getSession();
  await qChat(user.id, "update chat_messages set body = $2, edited_at = now() where id = $1", [id, body.trim()]);
}

export async function deleteChatMessage(id: string) {
  const { user } = await getSession();
  await qChat(user.id, "delete from chat_messages where id = $1", [id]);
}

export async function toggleReaction(message: string, emoji: string) {
  const { user } = await getSession();
  const gone = await qChat(user.id, "delete from chat_reactions where message_id = $1 and user_id = auth.uid() and emoji = $2 returning emoji", [message, emoji]);
  if (!gone.length) await qChat(user.id, "insert into chat_reactions (message_id, emoji) values ($1, $2)", [message, emoji]);
}

export async function openDirect(fd: FormData) {
  const { user } = await getSession();
  const [{ id }] = await qChat<{ id: string }>(user.id, "select chat_open_direct($1) as id", [String(fd.get("user") ?? "")]);
  revalidatePath("/chat");
  redirect(`/chat?c=${id}`);
}

export async function createChannel(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  const name = String(fd.get("name") ?? "").trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-");
  let id: string;
  try {
    id = (await q<{ id: string }>(user.id, "insert into chat_channels (name, description, kind) values ($1, $2, $3) returning id",
      [name, String(fd.get("description") ?? "").trim() || null, fd.get("partner") === "on" ? "external" : "team"]))[0].id;
  } catch (e) {
    return { error: text(e) };
  }
  revalidatePath("/chat");
  redirect(`/chat?c=${id}`);
}
