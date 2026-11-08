import { timingSafeEqual } from "node:crypto";
import { pushConfigured } from "@/lib/webpush";
import { pushPending } from "@/lib/push-send";

// Every minute: new notifications go to the devices where their users switched notifications on (Web Push).
// Authorization: Bearer <CRON_SECRET>.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401 });
  if (!pushConfigured()) return Response.json({ sent: 0, skipped: "push not configured" });
  return Response.json(await pushPending(5));
}
