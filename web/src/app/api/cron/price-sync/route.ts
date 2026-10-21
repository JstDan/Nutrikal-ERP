import { timingSafeEqual } from "node:crypto";
import { DEFAULT_LOCALE, getDict } from "@/lib/i18n";
import { runSync, syncDue } from "@/lib/calculator/sync";

// Daily price-list sync. Call it at least hourly (Vercel Cron, Supabase
// pg_cron, any scheduler) with "Authorization: Bearer <CRON_SECRET>";
// it syncs only once a day, on the first call after 17:00 Sofia time.
// Add ?force=1 to sync now regardless of the time.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401 });

  const force = new URL(req.url).searchParams.get("force") === "1";
  if (!force && !(await syncDue(null))) return Response.json({ synced: false, reason: "not due" });
  const run = await runSync(null, "scheduled", getDict(DEFAULT_LOCALE).calc.sync);
  return Response.json({ synced: run.status === "success", run }, { status: run.status === "success" ? 200 : 502 });
}
