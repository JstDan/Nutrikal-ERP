import { getSession } from "@/lib/session";

/**
 * A meme template's picture, passed through the app so the browser may draw words on it (a picture from another
 * site cannot be read back from a canvas). Only Imgflip's template pictures, only for the team.
 */
export async function GET(req: Request) {
  const { user } = await getSession();
  if (user.role === "client") return new Response(null, { status: 403 });
  const url = new URL(req.url).searchParams.get("u") ?? "";
  if (!/^https:\/\/i\.imgflip\.com\/[\w.]+\.(?:jpg|png)$/.test(url)) return new Response(null, { status: 400 });
  const res = await fetch(url);
  if (!res.ok || !res.body) return new Response(null, { status: 502 });
  return new Response(res.body, {
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "image/jpeg", "Cache-Control": "private, max-age=86400" },
  });
}
