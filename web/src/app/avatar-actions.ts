"use server";

// Profile photos: one's own, or anyone's by Admin (set_avatar decides).
// The browser sends a small square picture; the old file is removed after the change.
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { withUser } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { putFile, removeFile } from "@/lib/files";
import { AVATAR_BUCKET, AVATAR_MAX_BYTES } from "@/lib/avatar";

export type AvatarResult = { ok?: boolean; error?: string };
const EXT: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };
const errorText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));

export async function uploadAvatar(fd: FormData): Promise<AvatarResult> {
  const { user, t } = await getSession();
  const target = String(fd.get("user_id") ?? "");
  const file = fd.get("file");
  if (!/^[0-9a-f-]{36}$/i.test(target) || !(file instanceof File) || file.size === 0) return { error: t.avatar.invalid };
  const ext = EXT[file.type];
  if (!ext || file.size > AVATAR_MAX_BYTES) return { error: t.avatar.invalid };
  const key = `${target}/${randomUUID()}.${ext}`;
  let old: string | null = null;
  try {
    await withUser(user.id, async (tx) => {
      old = (await tx.query<{ old: string | null }>("select set_avatar($1, $2) as old", [target, key])).rows[0]?.old ?? null;
      await putFile(AVATAR_BUCKET, key, Buffer.from(await file.arrayBuffer()), file.type);
    });
  } catch (e) {
    return { error: errorText(e) };
  }
  if (old) await removeFile(AVATAR_BUCKET, old).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeAvatar(target: string): Promise<AvatarResult> {
  const { user } = await getSession();
  if (!/^[0-9a-f-]{36}$/i.test(target)) return { error: "Unknown user" };
  try {
    const old = (await withUser(user.id, (tx) => tx.query<{ old: string | null }>("select set_avatar($1, null) as old", [target]))).rows[0]?.old;
    if (old) await removeFile(AVATAR_BUCKET, old).catch(() => {});
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
