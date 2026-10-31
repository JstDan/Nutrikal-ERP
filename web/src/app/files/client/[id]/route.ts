import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { CLIENT_BUCKET, getFile } from "@/lib/files";

// A file of a client, if the signed-in user may see it (row-level security decides). Always a download, never shown in the page.
export async function GET(_req: Request, ctx: RouteContext<"/files/client/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const { user } = await getSession();
  const [row] = await q<{ file_name: string; storage_path: string }>(user.id, "select file_name, storage_path from client_files where id = $1", [id]);
  if (!row) return new Response("Not found", { status: 404 });
  const data = await getFile(CLIENT_BUCKET, row.storage_path);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
