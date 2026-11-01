import { timingSafeEqual } from "node:crypto";
import { DEFAULT_LOCALE, getDict } from "@/lib/i18n";
import { catalogSyncDue, runCatalogSync, runSync, syncDue } from "@/lib/calculator/sync";
import { asSystem } from "@/lib/db/engine";

// Daily price-list and catalog sync (each on its own). Call it at least
// hourly (Cloudflare cron trigger, Supabase pg_cron, any scheduler) with
// "Authorization: Bearer <CRON_SECRET>"; each syncs only once a day, on
// the first call after 17:00 Sofia time. Add ?force=1 to sync now.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401 });

  // Catalog conversations without an enquiry go after 12 months
  await asSystem("select catalog_chat_purge()");

  const force = new URL(req.url).searchParams.get("force") === "1";
  const s = getDict(DEFAULT_LOCALE).calc.sync;
  const prices = force || (await syncDue(null)) ? await runSync(null, "scheduled", s) : null;
  const catalog = force || (await catalogSyncDue(null)) ? await runCatalogSync(null, "scheduled", s) : null;
  const failed = prices?.status === "error" || catalog?.status === "error";
  return Response.json(
    { synced: !!(prices || catalog) && !failed, prices: prices ?? "not due", catalog: catalog ?? "not due" },
    { status: failed ? 502 : 200 },
  );
}
