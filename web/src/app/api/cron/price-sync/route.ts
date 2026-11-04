import { timingSafeEqual } from "node:crypto";
import { DEFAULT_LOCALE, getDict } from "@/lib/i18n";
import { catalogSyncDue, runCatalogSync } from "@/lib/calculator/sync";
import { asSystem } from "@/lib/db/engine";

// Daily catalog sync. Call it at least hourly (Cloudflare cron trigger,
// Supabase pg_cron, any scheduler) with "Authorization: Bearer <CRON_SECRET>";
// it syncs only once a day, on the first call after 17:00 Sofia time. Add
// ?force=1 to sync now. The price list of raw materials is no longer synced:
// it is kept by hand under Offers > Raw materials (owner, Nov 2026).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401 });

  // Catalog conversations without an enquiry go after 12 months
  await asSystem("select catalog_chat_purge()");

  const force = new URL(req.url).searchParams.get("force") === "1";
  const s = getDict(DEFAULT_LOCALE).calc.sync;
  const catalog = force || (await catalogSyncDue(null)) ? await runCatalogSync(null, "scheduled", s) : null;
  const failed = catalog?.status === "error";
  return Response.json(
    { synced: !!catalog && !failed, catalog: catalog ?? "not due" },
    { status: failed ? 502 : 200 },
  );
}
