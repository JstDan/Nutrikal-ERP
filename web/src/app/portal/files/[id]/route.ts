import { q } from "@/lib/db/engine";
import { CLIENT_BUCKET, getFile } from "@/lib/files";
import { validId } from "@/lib/portal";
import { getPortalSession } from "@/lib/session";

// A file the team shared with this client: a download; with ?view=1 a picture or PDF opens in the browser
// (a label to approve), any other type still downloads. Nothing else (HTML, SVG) is ever shown inline.
const INLINE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", pdf: "application/pdf" };
export async function GET(req: Request, ctx: RouteContext<"/portal/files/[id]">) {
  const { id } = await ctx.params;
  if (!validId(id)) return new Response("Not found", { status: 404 });
  const { user } = await getPortalSession();
  const [row] = await q<{ file_name: string; storage_path: string }>(user.id, "select file_name, storage_path from portal_file($1)", [id]);
  if (!row) return new Response("Not found", { status: 404 });
  const data = await getFile(CLIENT_BUCKET, row.storage_path);
  if (!data) return new Response("Not found", { status: 404 });
  const view = new URL(req.url).searchParams.get("view") === "1" ? INLINE[row.file_name.split(".").pop()?.toLowerCase() ?? ""] : undefined;
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": view ?? "application/octet-stream",
      "Content-Disposition": `${view ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
