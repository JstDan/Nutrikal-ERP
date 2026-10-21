import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { DELIVERY_BUCKET, getFile } from "@/lib/files";

// One delivery file, if the signed-in user may see it (row-level security
// on delivery_attachments decides), streamed from Storage or the local folder.
export async function GET(_req: Request, ctx: RouteContext<"/files/delivery/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const { user } = await getSession();
  const [f] = await q<{ storage_path: string; content_type: string | null; file_name: string | null }>(
    user.id, "select storage_path, content_type, file_name from delivery_attachments where id = $1", [id]);
  if (!f) return new Response("Not found", { status: 404 });
  const data = await getFile(DELIVERY_BUCKET, f.storage_path);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": f.content_type ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(f.file_name ?? f.storage_path.split("/")[1])}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
