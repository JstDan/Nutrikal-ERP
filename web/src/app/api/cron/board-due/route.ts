import { timingSafeEqual } from "node:crypto";
import { asSystem } from "@/lib/db/engine";

// Hourly: the people of board cards due today or tomorrow get a notification (once per due date).
// Authorization: Bearer <CRON_SECRET>.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401 });
  const [row] = await asSystem<{ n: number }>("select board_due_notify() as n");
  return Response.json({ notified: row?.n ?? 0 });
}
