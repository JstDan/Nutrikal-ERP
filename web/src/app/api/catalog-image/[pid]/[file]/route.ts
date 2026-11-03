import { CATALOG_BUCKET, getFile } from "@/lib/files";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/**
 * A product picture of the catalogue, uploaded by Admin (catalog-images bucket). Open to everyone, like the
 * catalogue itself: the address holds a random id, and the picture is the same one shown on the open page.
 * The path ends in the file type, so the middleware lets it through on every host.
 */
export async function GET(_: Request, { params }: { params: Promise<{ pid: string; file: string }> }) {
  const { pid, file } = await params;
  const m = file.match(/^([0-9a-f-]{36})\.(jpg|png|webp)$/i);
  if (!/^[0-9a-f-]{36}$/i.test(pid) || !m) return new Response("Not found", { status: 404 });
  const data = await getFile(CATALOG_BUCKET, `${pid.toLowerCase()}/${file.toLowerCase()}`);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": TYPES[m[2].toLowerCase()],
      // a new picture gets a new address, so this one never changes
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
