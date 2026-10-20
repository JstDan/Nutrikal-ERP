// File storage for delivery documents (waybill photos, COAs).
// Locally the files live in web/.data/files/<bucket>/<path>; on Supabase
// they go to the private Storage bucket "delivery-docs" with the same
// path ({delivery_id}/{uuid}.{ext}) and are shown through signed URLs.
// Who may read or add a file is decided by the database (row-level
// security on delivery_attachments), never here.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

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

function fullPath(bucket: string, key: string) {
  if (!SAFE_KEY.test(key)) throw new Error("Invalid file path");
  return path.join(/*turbopackIgnore: true*/ root(), bucket, key);
}

/** Path for a new file of a delivery, or null when the type is not allowed. */
export function newDeliveryPath(deliveryId: string, type: string): string | null {
  const ext = EXT[type];
  return ext ? `${deliveryId}/${randomUUID()}.${ext}` : null;
}

export async function putFile(bucket: string, key: string, data: Buffer) {
  const p = fullPath(bucket, key);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, data);
}

export async function getFile(bucket: string, key: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(fullPath(bucket, key));
  } catch {
    return null;
  }
}

export async function removeFile(bucket: string, key: string) {
  await fs.rm(fullPath(bucket, key), { force: true });
}
