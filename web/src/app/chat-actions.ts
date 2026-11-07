"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q, qChat } from "@/lib/db/engine";
import { CHAT_BUCKET, MAX_DESIGN_BYTES, newTaskFilePath, putFile } from "@/lib/files";
import { getSession } from "@/lib/session";
import type { ActionState } from "@/app/actions";
import type { ChatMessage, ChatPerson } from "@/components/chat-room";

// The chat is the one thing a read-only account writes: qChat, and the rules of the chat tables decide.
const FEED = "select id, author_id, author, body, created_at::text, edited_at::text, attachments, reactions from chat_feed($1)";
const text = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));

/**
 * Who writes: a developer acting as someone else writes under their own name (owner, Nov 2026);
 * reading, unread counts and the channels stay those of the person they act as.
 */
async function writer() {
  const s = await getSession();
  return { ...s, writerId: s.developer?.id ?? s.user.id };
}

/** The channel is read, and the notifications of mentions in it go away. */
const markRead = (userId: string, channel: string) =>
  qChat(userId, "insert into chat_reads (channel_id, user_id) values ($1, auth.uid()) on conflict (channel_id, user_id) do update set read_at = now()", [channel])
    .then(() => qChat(userId, "select mark_notifications_seen($1)", [`/chat?c=${channel}`]));

/** The last messages with their reactions and files. New ones mark the channel as read. */
export async function pollChat(channel: string, seen: string | null): Promise<ChatMessage[]> {
  const { user } = await getSession();
  const rows = await q<ChatMessage>(user.id, FEED, [channel]);
  if (rows.at(-1)?.id !== seen) await markRead(user.id, channel);
  return rows;
}

/** The channel is open on the screen: it is read now, with the notifications of its mentions. */
export async function markChatRead(channel: string): Promise<void> {
  const { user } = await getSession();
  await markRead(user.id, channel);
}

/** For the side panel: the channels and the people to write to. */
export async function chatList() {
  const { user } = await getSession();
  return {
    channels: await q<{ id: string; name: string; description: string | null; kind: string; unread: string }>(user.id, "select id, name, description, kind, unread::text from chat_channel_list()"),
    everyone: user.role === "production" ? [] : await q<ChatPerson>(user.id, "select id, full_name from chat_people()"),
  };
}

export async function chatRoomData(channel: string) {
  const { user } = await getSession();
  const messages = await q<ChatMessage>(user.id, FEED, [channel]);
  await markRead(user.id, channel);
  return { messages, people: await q<ChatPerson>(user.id, "select id, full_name from chat_people($1)", [channel]) };
}

export async function chatUnread(): Promise<number> {
  const { user } = await getSession();
  return Number((await q<{ n: string | null }>(user.id, "select sum(unread) as n from chat_unread()"))[0]?.n ?? 0);
}

export async function openDirectChat(person: string): Promise<string> {
  const { user } = await getSession();
  return (await qChat<{ id: string }>(user.id, "select chat_open_direct($1) as id", [person]))[0].id;
}

/** A message with its files: fd has channel, body, mentions and files. */
export async function sendChat(fd: FormData): Promise<{ error?: string }> {
  const { t, developer, writerId } = await writer();
  const channel = String(fd.get("channel") ?? "");
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.some((f) => f.size > MAX_DESIGN_BYTES)) return { error: t.chat.tooBig };
  const body = String(fd.get("body") ?? "").trim() || (files.length ? "📎" : "");
  if (!body) return {};
  try {
    const mentions = (JSON.parse(String(fd.get("mentions") ?? "[]")) as string[]).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    const [{ id }] = await qChat<{ id: string }>(writerId, "select chat_post($1, $2, $3::uuid[]) as id", [channel, body, mentions]);
    for (const f of files) {
      const key = newTaskFilePath(channel, randomUUID(), f.name);
      await putFile(CHAT_BUCKET, key, Buffer.from(await f.arrayBuffer()), f.type || "application/octet-stream");
      await qChat(writerId, "insert into chat_attachments (message_id, file_name, storage_path, mime, size_bytes) values ($1, $2, $3, $4, $5)",
        [id, f.name, key, f.type || null, f.size]);
    }
  } catch (e) {
    // A developer is not a member of the direct messages of the person they act as
    if (developer && /Not allowed in this channel/.test(text(e))) return { error: t.chat.developerDirect };
    return { error: text(e) };
  }
  return {};
}

export async function editChatMessage(id: string, body: string) {
  const { writerId } = await writer();
  await qChat(writerId, "update chat_messages set body = $2, edited_at = now() where id = $1", [id, body.trim()]);
}

export async function deleteChatMessage(id: string) {
  const { user, writerId } = await writer();
  const gone = await qChat(writerId, "delete from chat_messages where id = $1 returning id", [id]);
  // Someone else's message: only as the person acted as (an Admin may delete any)
  if (!gone.length && writerId !== user.id) await qChat(user.id, "delete from chat_messages where id = $1", [id]);
}

export async function toggleReaction(message: string, emoji: string) {
  const { writerId } = await writer();
  const gone = await qChat(writerId, "delete from chat_reactions where message_id = $1 and user_id = auth.uid() and emoji = $2 returning emoji", [message, emoji]);
  if (!gone.length) await qChat(writerId, "insert into chat_reactions (message_id, emoji) values ($1, $2)", [message, emoji]);
}

export type Gif = { id: string; url: string; preview: string; width: number; height: number; title: string };

/** GIFs from GIPHY (owner, Nov 2026): trending without a search. Needs GIPHY_API_KEY; only the search words leave the app. */
export async function searchGifs(term: string): Promise<Gif[]> {
  const { locale } = await getSession();
  const key = process.env.GIPHY_API_KEY;
  if (!key) return [];
  const words = term.trim().slice(0, 50);
  const url = new URL(`https://api.giphy.com/v1/gifs/${words ? "search" : "trending"}`);
  url.search = new URLSearchParams({ api_key: key, limit: "24", rating: "g", bundle: "messaging_non_clips", ...(words && { q: words, lang: locale }) }).toString();
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    type Img = { url?: string; width?: string; height?: string };
    const data = (await res.json()) as { data?: { id: string; title?: string; images?: Record<string, Img> }[] };
    return (data.data ?? []).flatMap((g) => {
      const full = g.images?.fixed_height;
      const small = g.images?.fixed_width_small ?? g.images?.fixed_height_small ?? full;
      if (!full?.url || !small?.url) return [];
      return [{ id: g.id, url: full.url, preview: small.url, width: Number(full.width) || 200, height: Number(full.height) || 200, title: g.title ?? "" }];
    });
  } catch {
    return [];
  }
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
