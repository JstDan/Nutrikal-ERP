// Google Drive through the shared Google connection (the mailbox Admin connected; scope drive.file: the app sees
// only the files it puts there). Contracts are uploaded for Google Workspace eSignature, which Google offers only
// in its own screens: the request for signatures is made there by hand (owner, Nov 2026).
import { forgetAccess, liveAccess } from "@/lib/gmail";

export class DriveScopeError extends Error {}
const FOLDER = "Nutrikal – Contracts";

async function drive<T>(access: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://www.googleapis.com${path}`, { ...init, headers: { Authorization: `Bearer ${access}`, ...(init.headers ?? {}) } });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "";
    if (res.status === 403 && /insufficient|scope/i.test(detail)) throw new DriveScopeError(detail);
    throw new Error(`Drive ${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
}

/** The app's own folder for contracts (made the first time). */
async function folderId(access: string): Promise<string> {
  const q = encodeURIComponent(`name = '${FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const found = await drive<{ files: { id: string }[] }>(access, `/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`);
  if (found.files[0]) return found.files[0].id;
  const made = await drive<{ id: string }>(access, "/drive/v3/files?fields=id", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER, mimeType: "application/vnd.google-apps.folder" }),
  });
  return made.id;
}

/** Puts a PDF (base64) into the contracts folder; returns the file and the link that opens it in Drive. */
export async function uploadPdfToDrive(base64: string, fileName: string): Promise<{ id: string; url: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const access = await liveAccess();
    if (!access) throw new Error("Google is not connected");
    try {
      const parent = await folderId(access);
      const b = `nk_${crypto.randomUUID()}`;
      const body = [`--${b}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify({ name: fileName, parents: [parent], mimeType: "application/pdf" }),
        `--${b}`, "Content-Type: application/pdf", "Content-Transfer-Encoding: base64", "", base64, `--${b}--`, ""].join("\r\n");
      const f = await drive<{ id: string; webViewLink: string }>(access, "/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
        method: "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body,
      });
      return { id: f.id, url: f.webViewLink };
    } catch (e) {
      // A token from before the reconnect: once more with a fresh one
      if (e instanceof DriveScopeError && attempt === 0) { forgetAccess(); continue; }
      throw e;
    }
  }
  throw new DriveScopeError("Drive permission missing");
}
