"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { q, qChat } from "@/lib/db/engine";
import { CHAT_BUCKET, MAX_DESIGN_BYTES, newTaskFilePath, putFile } from "@/lib/files";
import { getSession } from "@/lib/session";
import { pushPending } from "@/lib/push-send";
import { pushConfigured } from "@/lib/webpush";
import type { ActionState } from "@/app/actions";
import type { ChatMessage, ChatPerson } from "@/components/chat-room";

// The chat is the one thing a read-only account writes: qChat, and the rules of the chat tables decide.
const COLS = "id, author_id, author, body, created_at::text, edited_at::text, attachments, reactions, parent_id, reply_count, last_reply_at::text, repliers, pinned_at::text"
  + ", exists (select 1 from chat_saved s where s.message_id = f.id and s.user_id = auth.uid()) as saved";
const FEED = `select ${COLS} from chat_feed($1) f`;
const THREAD = `select ${COLS} from chat_feed($1, $2) f`;
const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
/** When the person last read the channel (before opening it now): where the "New" line goes. */
export const lastReadOf = async (userId: string, channel: string) =>
  (await q<{ at: string | null }>(userId, "select read_at::text as at from chat_reads where channel_id = $1 and user_id = auth.uid()", [channel]))[0]?.at ?? null;
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

/** A thread: its message first, then the replies. Opening it reads its notifications. */
export async function pollThread(channel: string, thread: string): Promise<ChatMessage[]> {
  const { user } = await getSession();
  if (!uuid(channel) || !uuid(thread)) return [];
  const rows = await q<ChatMessage>(user.id, THREAD, [channel, thread]);
  await qChat(user.id, "select mark_notifications_seen($1)", [`/chat?c=${channel}&t=${thread}`]);
  return rows;
}

/** Pins a message to its channel for everyone, or takes the pin away. */
export async function pinChatMessage(id: string, on: boolean) {
  const { writerId } = await writer();
  await qChat(writerId, "select chat_pin($1, $2)", [id, on]);
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
  const lastRead = await lastReadOf(user.id, channel);
  const messages = await q<ChatMessage>(user.id, FEED, [channel]);
  await markRead(user.id, channel);
  return {
    messages, lastRead,
    people: await q<ChatPerson>(user.id, "select id, full_name from chat_people($1)", [channel]),
    notify: (await q<{ n: string | null }>(user.id, "select chat_my_notify($1) as n", [channel]))[0]?.n ?? "mentions",
  };
}

export async function chatUnread(): Promise<number> {
  const { user } = await getSession();
  return Number((await q<{ n: string | null }>(user.id, "select sum(unread) as n from chat_unread()"))[0]?.n ?? 0);
}

export async function openDirectChat(person: string): Promise<string> {
  const { user } = await getSession();
  return (await qChat<{ id: string }>(user.id, "select chat_open_direct($1) as id", [person]))[0].id;
}

/** A message with its files: fd has channel, body, mentions, files and, for a reply, parent. */
export async function sendChat(fd: FormData): Promise<{ error?: string }> {
  const { t, developer, writerId } = await writer();
  const channel = String(fd.get("channel") ?? "");
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.some((f) => f.size > MAX_DESIGN_BYTES)) return { error: t.chat.tooBig };
  const body = String(fd.get("body") ?? "").trim() || (files.length ? "📎" : "");
  if (!body) return {};
  try {
    const mentions = (JSON.parse(String(fd.get("mentions") ?? "[]")) as string[]).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    const [{ id }] = await qChat<{ id: string }>(writerId, "select chat_post($1, $2, $3::uuid[], $4) as id", [channel, body, mentions, uuid(fd.get("parent"))]);
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

/** Saves a message for later (one's own list, as in Slack), or takes it off. Personal, like reading: the person acted as. */
export async function saveChatMessage(id: string, on: boolean) {
  const { user } = await getSession();
  if (!uuid(id)) return;
  await qChat(user.id, "select chat_save($1, $2)", [id, on]);
}

export type SavedItem = { id: string; channel_id: string; channel: string; kind: string; author_id: string; author: string; body: string; created_at: string; parent_id: string | null; saved_at: string };
export async function savedChatItems(): Promise<SavedItem[]> {
  const { user } = await getSession();
  return q<SavedItem>(user.id, "select id, channel_id, channel, kind, author_id, author, body, created_at::text, parent_id, saved_at::text from chat_saved_list()");
}

/** Notifications of a channel for oneself: every message, mentions only, or nothing. */
export async function setChatNotify(channel: string, level: string) {
  const { user } = await getSession();
  if (!uuid(channel) || !["all", "mentions", "none"].includes(level)) return;
  await qChat(user.id, "select chat_set_notify($1, $2)", [channel, level]);
}

/** A huddle started in a direct conversation: the other person's phone rings (a notification, pushed at once). */
export async function ringHuddle(channel: string) {
  const { writerId } = await writer();
  if (!uuid(channel)) return;
  await qChat(writerId, "select chat_huddle_ring($1)", [channel]);
  if (pushConfigured()) after(() => pushPending(0).then(() => undefined).catch((e) => console.error("Push", e)));
}

/**
 * The servers a huddle's browsers use to reach each other: public STUN, and Cloudflare TURN when it is set up
 * (TURN_KEY_ID, TURN_KEY_API_TOKEN; needed when a phone network hides the device). Short-lived credentials.
 */
export async function huddleIceServers(): Promise<RTCIceServer[]> {
  await getSession();
  const stun: RTCIceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
  const id = process.env.TURN_KEY_ID?.trim(), token = process.env.TURN_KEY_API_TOKEN?.trim();
  if (!id || !token) return stun;
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ttl: 4 * 3600 }),
    });
    if (!r.ok) return stun;
    const data = await r.json() as { iceServers?: RTCIceServer | RTCIceServer[] };
    const got = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
    return got.length ? [...stun, ...got] : stun;
  } catch {
    return stun;
  }
}


/** A meme template: a picture with the number of text boxes it is made for. */
export type MemeTemplate = { id: string; name: string; url: string; width: number; height: number };
let memeCache: { at: number; list: MemeTemplate[] } | null = null;

/**
 * Memes in the chat (owner, Nov 2026): the 100 most used templates from Imgflip (free, no key; kept for an hour).
 * The picture is drawn with the words in the browser and sent as an image file of the message.
 */
export async function memeTemplates(): Promise<MemeTemplate[]> {
  const { user } = await getSession();
  if (user.role === "client") return [];
  if (memeCache && Date.now() - memeCache.at < 3600_000) return memeCache.list;
  try {
    const res = await fetch("https://api.imgflip.com/get_memes", { cache: "no-store" });
    if (!res.ok) return memeCache?.list ?? [];
    const data = (await res.json()) as { data?: { memes?: { id: string; name: string; url: string; width: number; height: number }[] } };
    const list = (data.data?.memes ?? [])
      .filter((m) => /^https:\/\/i\.imgflip\.com\/[\w.]+\.(?:jpg|png)$/.test(m.url))
      .map((m) => ({ id: m.id, name: m.name, url: m.url, width: m.width, height: m.height }));
    memeCache = { at: Date.now(), list };
    return list;
  } catch {
    return memeCache?.list ?? [];
  }
}
