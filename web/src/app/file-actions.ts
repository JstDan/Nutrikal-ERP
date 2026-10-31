"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { q } from "@/lib/db/engine";
import { CLIENT_BUCKET, MAX_DESIGN_BYTES, newTaskFilePath, putFile, removeFile } from "@/lib/files";
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
