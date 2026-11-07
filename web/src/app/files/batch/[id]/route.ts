import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { BATCH_BUCKET, getFile, signedFileUrl } from "@/lib/files";

// One photo or file of a batch, if the signed-in user may see it (row-level security
// on batch_files: the team, and the partner for released batches). With Supabase: a 60-second signed
// link; locally: streamed from the folder. ?download=1 saves it.
export async function GET(req: Request, ctx: RouteContext<"/files/batch/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const { user } = await getSession();
  const [f] = await q<{ storage_path: string; mime: string | null; name: string }>(
    user.id, "select storage_path, mime, name from batch_files where id = $1", [id]);
  if (!f) return new Response("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  const signed = await signedFileUrl(BATCH_BUCKET, f.storage_path, 60, download ? f.name : undefined);
  if (signed) return Response.redirect(signed, 302);
  const data = await getFile(BATCH_BUCKET, f.storage_path);
  if (!data) return new Response("Not found", { status: 404 });
  // Only images and PDF open in the browser; everything else downloads (no HTML or SVG rendered inline)
  const inline = !download && /^(image\/(png|jpeg|webp)|application\/pdf)$/.test(f.mime ?? "");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": inline ? f.mime! : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
