import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { CHAT_BUCKET, getFile } from "@/lib/files";

const SHOWN = /^image\/(png|jpeg|webp|gif)$/;

// A file of the chat, if the signed-in user is in its channel (row-level security decides). Only plain images open in the page.
export async function GET(req: Request, ctx: RouteContext<"/files/chat/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const { user } = await getSession();
  const [row] = await q<{ file_name: string; storage_path: string; mime: string | null }>(user.id, "select file_name, storage_path, mime from chat_attachments where id = $1", [id]);
  if (!row) return new Response("Not found", { status: 404 });
  const data = await getFile(CHAT_BUCKET, row.storage_path);
  if (!data) return new Response("Not found", { status: 404 });
  const inline = SHOWN.test(row.mime ?? "") && !new URL(req.url).searchParams.has("download");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": inline ? row.mime! : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
