import { timingSafeEqual } from "node:crypto";
import { asSystem } from "@/lib/db/engine";

// Hourly (Cloudflare cron trigger, worker.ts), with "Authorization: Bearer <CRON_SECRET>":
// catalog conversations without an enquiry go after 12 months. (Until Nov 2026 this route also
// synced the calculator's price list from the Google Sheet; it lives in the database now.)
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401 });

  await asSystem("select catalog_chat_purge()");
  return Response.json({ purged: true });
}
