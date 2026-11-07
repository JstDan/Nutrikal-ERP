import { timingSafeEqual } from "node:crypto";
import { asSystem } from "@/lib/db/engine";
import { removeTrashFiles } from "@/lib/trash";

// Hourly: what has been in the trash 30 days is deleted for good, with its files. Authorization: Bearer <CRON_SECRET>.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401 });
  const [row] = await asSystem<{ f: { bucket: string; path: string }[] }>("select trash_purge() as f");
  await removeTrashFiles(row?.f ?? []);
  return Response.json({ files: row?.f?.length ?? 0 });
}
