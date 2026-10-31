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
export const LOT_BUCKET = "lot-documents";
export const CLIENT_BUCKET = "client-files";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Designs are larger; the limit of a request is 25 MB (next.config.ts). */
export const MAX_DESIGN_BYTES = 24 * 1024 * 1024;

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

// Files of tasks: {order_id}/{task_id}/{uuid}-{name}
const TASK_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$/;

function checkKey(key: string) {
  if (!SAFE_KEY.test(key) && !TASK_KEY.test(key)) throw new Error("Invalid file path");
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

/** Path for a new file of a task; the name stays readable but safe for Storage. */
export function newTaskFilePath(orderId: string, taskId: string, name: string): string {
  const ext = (name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "").toLowerCase();
  const base = name.replace(/\.[A-Za-z0-9]+$/, "").normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 100) || "file";
  return `${orderId}/${taskId}/${randomUUID()}-${base}${ext ? `.${ext}` : ""}`;
}

/** A short-lived link to a file in Storage (Supabase only; null locally). */
export async function signedFileUrl(bucket: string, key: string, seconds = 60, download?: string): Promise<string | null> {
  if (!supabaseConfigured()) return null;
  checkKey(key);
  const { data, error } = await supabaseAdmin().storage.from(bucket).createSignedUrl(key, seconds, download ? { download } : undefined);
  return error ? null : data.signedUrl;
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
