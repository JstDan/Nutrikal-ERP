import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { getFile, LOT_BUCKET } from "@/lib/files";

// The certificate of analysis of a lot, if the signed-in user may see the lot (row-level security decides).
export async function GET(_req: Request, ctx: RouteContext<"/files/coa/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const { user } = await getSession();
  const [lot] = await q<{ coa_path: string | null; lot_number: string }>(user.id, "select coa_path, lot_number from lots where id = $1", [id]);
  if (!lot?.coa_path) return new Response("Not found", { status: 404 });
  const data = await getFile(LOT_BUCKET, lot.coa_path);
  if (!data) return new Response("Not found", { status: 404 });
  const type = lot.coa_path.endsWith(".pdf") ? "application/pdf" : `image/${lot.coa_path.split(".").pop()}`;
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `inline; filename="COA-${encodeURIComponent(lot.lot_number)}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
