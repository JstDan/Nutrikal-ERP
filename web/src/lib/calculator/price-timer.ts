// On a long-running server (next start, next dev): every 10 minutes, check
// whether the daily 17:00 catalog sync is due and run it. On serverless
// hosting the cron route does this instead (/api/cron/price-sync, called
// hourly by the Cloudflare cron trigger in worker.ts); both use the same
// "due" check, so the sheet is synced once a day either way. The price list
// of raw materials is kept by hand in the app (owner, Nov 2026).
import { DEFAULT_LOCALE, getDict } from "@/lib/i18n";
import { onWorkers } from "@/lib/db/engine";
import { catalogSyncDue, runCatalogSync } from "./sync";

export function startPriceTimer() {
  // On Cloudflare the Worker's hourly cron trigger calls the cron route instead (worker.ts)
  if (process.env.PRICE_SYNC_TIMER === "off" || process.env.NEXT_PHASE === "phase-production-build" || onWorkers()) return;
  const g = globalThis as unknown as { __nkPriceTimer?: NodeJS.Timeout };
  if (g.__nkPriceTimer) return;
  const tick = async () => {
    try {
      const s = getDict(DEFAULT_LOCALE).calc.sync;
      if (await catalogSyncDue(null)) {
        const run = await runCatalogSync(null, "scheduled", s);
        console.log(`[nutrikal] daily catalog sync: ${run.status}${run.error ? ` (${run.error})` : ""}`);
      }
    } catch (e) {
      console.error("[nutrikal] daily catalog sync failed", e);
    }
  };
  g.__nkPriceTimer = setInterval(tick, 10 * 60 * 1000).unref();
  setTimeout(tick, 30 * 1000).unref();
}
