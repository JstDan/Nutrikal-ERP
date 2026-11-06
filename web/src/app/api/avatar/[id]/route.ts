import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { getFile } from "@/lib/files";
import { AVATAR_BUCKET, avatarColour, avatarInitials } from "@/lib/avatar";

// The picture of a person: their photo, or their initials on a colour (SVG),
// if the signed-in account may see them (avatar_of decides). Cached for a few
// minutes; a changed photo is asked for with a new ?v=.
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function GET(_req: Request, ctx: RouteContext<"/api/avatar/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const { user } = await getSession();
  const [p] = await q<{ full_name: string; avatar_path: string | null }>(user.id, "select full_name, avatar_path from avatar_of($1)", [id]);
  if (!p) return new Response("Not found", { status: 404 });
  const headers = { "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" };
  if (p.avatar_path) {
    const data = await getFile(AVATAR_BUCKET, p.avatar_path);
    const type = p.avatar_path.endsWith(".png") ? "image/png" : p.avatar_path.endsWith(".jpg") ? "image/jpeg" : "image/webp";
    if (data) return new Response(new Uint8Array(data), { headers: { ...headers, "Content-Type": type } });
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${avatarColour(id)}"/>`
    + `<text x="32" y="33" dy=".35em" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="25" font-weight="600" fill="#fff">`
    + `${escape(avatarInitials(p.full_name))}</text></svg>`;
  return new Response(svg, { headers: { ...headers, "Content-Type": "image/svg+xml", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
}
