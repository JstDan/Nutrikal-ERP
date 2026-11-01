import { q } from "@/lib/db/engine";
import { CLIENT_BUCKET, getFile } from "@/lib/files";
import { validId } from "@/lib/portal";
import { getPortalSession } from "@/lib/session";

// A file the team shared with this client. Always a download, never shown in the page.
export async function GET(_req: Request, ctx: RouteContext<"/portal/files/[id]">) {
  const { id } = await ctx.params;
  if (!validId(id)) return new Response("Not found", { status: 404 });
  const { user } = await getPortalSession();
  const [row] = await q<{ file_name: string; storage_path: string }>(user.id, "select file_name, storage_path from portal_file($1)", [id]);
  if (!row) return new Response("Not found", { status: 404 });
  const data = await getFile(CLIENT_BUCKET, row.storage_path);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
