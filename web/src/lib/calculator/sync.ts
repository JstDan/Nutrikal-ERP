// Catalog sync from the catalog sheet into calc_catalog_products. The price list of
// raw materials is no longer synced: it is kept by hand in the app (owner, Nov 2026).
// Runs as a signed-in admin/sales user (button, catch-up when the
// calculator opens) or, for the daily 17:00 job, as the server itself.
import { asSystem, q } from "@/lib/db/engine";
import { fmt } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { catalogStats, parseCatalogSheet, type CatalogRow } from "./catalogImport";
import { extractSheetId, sheetExportPath } from "./materialImport";
import { isSyncDue } from "./schedule";
import type { CatalogProduct, CatalogSyncRun } from "./types";

export type SyncSource = "manual" | "auto" | "scheduled";
type Messages = Dict["calc"]["sync"];

export const CATALOG_RUN_COLUMNS = "id, created_at::text, source, status, added, changed, unchanged, removed, error";
const errorText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));

/** The sheet link: GOOGLE_SHEET_URL from the server configuration, else the one in calculator settings. */
export const envSheetUrl = () => process.env.GOOGLE_SHEET_URL?.trim() || null;
/** The catalog sheet link: GOOGLE_CATALOG_SHEET_URL from the server configuration, else the one in calculator settings. */
export const envCatalogSheetUrl = () => process.env.GOOGLE_CATALOG_SHEET_URL?.trim() || null;

/** userId null = the server job (owner rights; only reads and the scheduled-sync functions). */
const rows = <T>(userId: string | null, sql: string, params: unknown[] = []) =>
  userId ? q<T>(userId, sql, params) : asSystem<T>(sql, params);

async function catalogSheetUrl(userId: string | null): Promise<string> {
  const env = envCatalogSheetUrl();
  if (env) return env;
  const [s] = await rows<{ catalog_sheet_url: string }>(userId, "select catalog_sheet_url from calc_settings");
  return s?.catalog_sheet_url ?? "";
}

/** Due after 17:00 when nothing succeeded since; `runs` is the log table. */
async function dueIn(runs: "calc_catalog_sync_runs", userId: string | null, now: Date): Promise<boolean> {
  const [r] = await rows<{ last_success: Date | null; last_at: Date | null; last_failed: boolean | null }>(
    userId,
    `select (select max(created_at) from ${runs} where status = 'success') as last_success,
            l.created_at as last_at, l.status = 'error' as last_failed
       from (select 1) one
       left join lateral (select created_at, status from ${runs} order by created_at desc limit 1) l on true`,
  );
  return isSyncDue(r?.last_success ?? null, r?.last_at ? { at: r.last_at, failed: !!r.last_failed } : null, now);
}

export const catalogSyncDue = (userId: string | null, now = new Date()) => dueIn("calc_catalog_sync_runs", userId, now);

/** Download the first sheet of a Google Sheet as rows of cells (objects by header, or arrays). */
async function downloadSheet(url: string, s: Messages, asArrays: boolean) {
  const fileId = extractSheetId(url);
  if (!fileId) throw new Error(s.noSheet);
  const res = await fetch(`https://docs.google.com${sheetExportPath(fileId)}`, { redirect: "follow", cache: "no-store" });
  if (!res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) {
    throw new Error(fmt(s.downloadFailed, { status: res.status }));
  }
  const XLSX = await import("xlsx");
  const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return asArrays
    ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
    : XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
}

/** Download the catalog sheet and apply it to the catalog products (or log the failure). */
export async function runCatalogSync(userId: string | null, source: SyncSource, s: Messages): Promise<CatalogSyncRun> {
  let products: CatalogRow[] = [];
  let stats: Record<string, number> = {};
  let error: string | null = null;
  try {
    products = parseCatalogSheet((await downloadSheet(await catalogSheetUrl(userId), s, true)) as unknown[][]);
    const current = await rows<CatalogProduct>(userId, "select id, code, name, category, tiers, active from calc_catalog_products");
    stats = catalogStats(products, current);
  } catch (e) {
    products = [];
    error = errorText(e);
  }
  const args = [JSON.stringify(products), JSON.stringify(stats), error];
  const [run] = source === "scheduled"
    ? await rows<CatalogSyncRun>(null, `select ${CATALOG_RUN_COLUMNS} from calc_record_scheduled_catalog_sync($1::jsonb, $2::jsonb, $3)`, args)
    : await rows<CatalogSyncRun>(userId, `select ${CATALOG_RUN_COLUMNS} from calc_record_catalog_sync($1, $2::jsonb, $3::jsonb, $4)`, [source, ...args]);
  return run;
}
