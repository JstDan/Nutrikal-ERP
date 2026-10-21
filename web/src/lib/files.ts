// File storage for delivery documents (waybill photos, COAs).
// With Supabase: the private Storage bucket "delivery-docs"; locally:
// web/.data/files/<bucket>/<path>. Same path either way
// ({delivery_id}/{uuid}.{ext}). Who may read or add a file is decided by
// the database (row-level security on delivery_attachments) before these
// functions are called, never here.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, supabaseConfigured } from "./supabase/server";

export const DELIVERY_BUCKET = "delivery-docs";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

const root = () => process.env.NK_FILES_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "files");
const SAFE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z]{3,4}$/;

function checkKey(key: string) {
  if (!SAFE_KEY.test(key)) throw new Error("Invalid file path");
}

function fullPath(bucket: string, key: string) {
  checkKey(key);
  return path.join(/*turbopackIgnore: true*/ root(), bucket, key);
}

/** Path for a new file of a delivery, or null when the type is not allowed. */
export function newDeliveryPath(deliveryId: string, type: string): string | null {
  const ext = EXT[type];
  return ext ? `${deliveryId}/${randomUUID()}.${ext}` : null;
}

export async function putFile(bucket: string, key: string, data: Buffer, contentType?: string) {
  if (supabaseConfigured()) {
    checkKey(key);
    const { error } = await supabaseAdmin().storage.from(bucket).upload(key, data, { contentType, upsert: false });
    if (error) throw new Error(error.message);
    return;
  }
  const p = fullPath(bucket, key);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, data);
}

export async function getFile(bucket: string, key: string): Promise<Buffer | null> {
  if (supabaseConfigured()) {
    checkKey(key);
    const { data, error } = await supabaseAdmin().storage.from(bucket).download(key);
    return error || !data ? null : Buffer.from(await data.arrayBuffer());
  }
  try {
    return await fs.readFile(fullPath(bucket, key));
  } catch {
    return null;
  }
}

export async function removeFile(bucket: string, key: string) {
  if (supabaseConfigured()) {
    checkKey(key);
    await supabaseAdmin().storage.from(bucket).remove([key]);
    return;
  }
  await fs.rm(fullPath(bucket, key), { force: true });
}
