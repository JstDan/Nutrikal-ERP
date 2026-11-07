// Files of things deleted for good leave Storage (server only; never a server action).
import { removeFile } from "@/lib/files";

export async function removeTrashFiles(files: { bucket: string; path: string }[]) {
  for (const f of files) await removeFile(f.bucket, f.path).catch(() => undefined);
}
