import { q } from "@/lib/db/engine";
import { getFile, LOT_BUCKET } from "@/lib/files";
import { validId } from "@/lib/portal";
import { getPortalSession } from "@/lib/session";

// The certificate of analysis of a batch of this client, once the team shared it.
export async function GET(_req: Request, ctx: RouteContext<"/portal/coa/[id]">) {
  const { id } = await ctx.params;
  if (!validId(id)) return new Response("Not found", { status: 404 });
  const { user } = await getPortalSession();
  const [lot] = await q<{ lot_number: string; coa_path: string }>(user.id, "select lot_number, coa_path from portal_coa($1)", [id]);
  if (!lot) return new Response("Not found", { status: 404 });
  const data = await getFile(LOT_BUCKET, lot.coa_path);
  if (!data) return new Response("Not found", { status: 404 });
  const ext = lot.coa_path.split(".").pop() ?? "pdf";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`COA-${lot.lot_number}.${ext}`)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
