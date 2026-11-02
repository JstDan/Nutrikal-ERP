"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { q } from "@/lib/db/engine";
import { CLIENT_BUCKET, MAX_DESIGN_BYTES, newTaskFilePath, putFile, removeFile } from "@/lib/files";
import { getDict, isLocale } from "@/lib/i18n";
import { mailConfigured, sendMail } from "@/lib/mail";
import { getSession } from "@/lib/session";
import type { ActionState } from "@/app/actions";

/** Who may add or remove a file is decided by the rules of client_files: the row comes first, then the file. */
export async function uploadClientFile(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const F = t.clientFiles;
  const file = fd.get("file");
  const client = String(fd.get("client_id") ?? "");
  const order = String(fd.get("order_id") ?? "") || null;
  if (!(file instanceof File) || file.size === 0) return { error: F.invalid };
  if (file.size > MAX_DESIGN_BYTES) return { error: F.tooBig };
  const key = newTaskFilePath(client, randomUUID(), file.name);
  try {
    const [row] = await q<{ id: string }>(user.id,
      "insert into client_files (client_id, order_id, file_name, storage_path, mime, size_bytes, note) values ($1, $2, $3, $4, $5, $6, $7) returning id",
      [client, order, file.name, key, file.type || null, file.size, String(fd.get("note") ?? "").trim() || null]);
    try {
      await putFile(CLIENT_BUCKET, key, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
    } catch (e) {
      await q(user.id, "delete from client_files where id = $1", [row.id]);
      throw e;
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: F.uploaded };
}

export async function deleteClientFile(fd: FormData) {
  const { user } = await getSession();
  const [row] = await q<{ storage_path: string }>(user.id, "delete from client_files where id = $1 returning storage_path", [String(fd.get("id") ?? "")]);
  if (row) await removeFile(CLIENT_BUCKET, row.storage_path).catch((e) => console.error("Client file", e));
  revalidatePath("/", "layout");
}

/** Share a file with the client in the customer panel, or take it back. */
export async function shareClientFile(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "select client_file_share($1, $2)", [String(fd.get("id") ?? ""), fd.get("on") === "on"]);
  revalidatePath("/", "layout");
}

/** An answer in the customer panel. The e-mail only says there is one; the text stays in the panel. */
export async function replyToClient(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const client = String(fd.get("client_id") ?? "");
  const order = String(fd.get("order_id") ?? "") || null;
  const body = String(fd.get("body") ?? "").trim();
  if (!body || body.length > 4000) return { error: t.portal.staff.empty };
  try {
    await q(user.id, "select client_message_send($1, $2, $3)", [client, order, body]);
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
  if (mailConfigured()) {
    const people = await q<{ email: string; locale: string | null }>(user.id,
      `select u.email, c.preferred_locale::text as locale from client_user_list($1) u, clients c where c.id = $1 and u.is_active`, [client]);
    for (const p of people) {
      const S = getDict(isLocale(p.locale) ? p.locale : "en").portal.staff;
      await sendMail({ to: p.email, cc: null, replyTo: null, subject: S.mailSubject, text: S.mailBody.replace("{url}", `https://${process.env.PORTAL_HOST?.trim() || "portal.nutrikal.com"}`) })
        .catch((e) => console.error("Client message mail", e));
    }
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setClientThread(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "select client_thread_set($1, $2, $3, $4)", [String(fd.get("client_id") ?? ""), String(fd.get("order_id") ?? "") || null, String(fd.get("status") ?? "open"), String(fd.get("assigned_to") ?? "") || null]);
  revalidatePath("/", "layout");
}
