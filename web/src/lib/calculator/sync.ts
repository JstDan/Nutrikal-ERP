// Price-list sync from the Google Sheet into calc_raw_materials, and the catalog
// sheet into calc_catalog_products.
// Runs as a signed-in admin/sales user (button, catch-up when the
// calculator opens) or, for the daily 17:00 job, as the server itself.
import { asSystem, q } from "@/lib/db/engine";
import { fmt } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { parseCatalogSheet, type CatalogRow } from "./catalogImport";
import { buildImportPreview, buildSyncPlan, extractSheetId, sheetExportPath } from "./materialImport";
import { isSyncDue } from "./schedule";
import type { RawMaterial, SyncRun } from "./types";

export type SyncSource = "manual" | "auto" | "scheduled";
type Messages = Dict["calc"]["sync"];

const RUN_COLUMNS = "id, created_at::text, source, status, added, changed, unchanged, invalid, missing, removed, restored, catalog, catalog_error, error";
const errorText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));

/** The sheet link: GOOGLE_SHEET_URL from the server configuration, else the one in calculator settings. */
export const envSheetUrl = () => process.env.GOOGLE_SHEET_URL?.trim() || null;

/** userId null = the server job (owner rights; only reads and the scheduled-sync function). */
const rows = <T>(userId: string | null, sql: string, params: unknown[] = []) =>
  userId ? q<T>(userId, sql, params) : asSystem<T>(sql, params);

export async function sheetUrl(userId: string | null): Promise<string> {
  const env = envSheetUrl();
  if (env) return env;
  const [s] = await rows<{ google_sheet_url: string }>(userId, "select google_sheet_url from calc_settings");
  return s?.google_sheet_url ?? "";
}

export async function syncDue(userId: string | null, now = new Date()): Promise<boolean> {
  const [r] = await rows<{ last_success: Date | null; last_at: Date | null; last_failed: boolean | null }>(
    userId,
    `select (select max(created_at) from calc_sync_runs where status = 'success') as last_success,
            l.created_at as last_at, l.status = 'error' as last_failed
       from (select 1) one
       left join lateral (select created_at, status from calc_sync_runs order by created_at desc limit 1) l on true`,
  );
  return isSyncDue(r?.last_success ?? null, r?.last_at ? { at: r.last_at, failed: !!r.last_failed } : null, now);
}

function record(userId: string | null, source: SyncSource, plan: unknown, stats: Record<string, number | string>, error: string | null) {
  const args = [JSON.stringify(plan), JSON.stringify(stats), error];
  return (source === "scheduled"
    ? rows<SyncRun>(null, `select ${RUN_COLUMNS} from calc_record_scheduled_sync($1::jsonb, $2::jsonb, $3)`, args)
    : rows<SyncRun>(userId, `select ${RUN_COLUMNS} from calc_record_sync($1, $2::jsonb, $3::jsonb, $4)`, [source, ...args])
  ).then((r) => r[0]);
}

/** The catalog sheet link: GOOGLE_CATALOG_SHEET_URL from the server configuration, else the one in calculator settings. */
export const envCatalogSheetUrl = () => process.env.GOOGLE_CATALOG_SHEET_URL?.trim() || null;

async function catalogSheetUrl(userId: string | null): Promise<string> {
  const env = envCatalogSheetUrl();
  if (env) return env;
  const [s] = await rows<{ catalog_sheet_url: string }>(userId, "select catalog_sheet_url from calc_settings");
  return s?.catalog_sheet_url ?? "";
}

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

/**
 * Download both sheets, compare with the stored lists and apply the changes (or log the failure).
 * The price list and the catalog are independent: a failure in one still applies the other, and the
 * run is logged as failed (retried) with the reason.
 */
export async function runSync(userId: string | null, source: SyncSource, s: Messages): Promise<SyncRun> {
  let plan: Partial<ReturnType<typeof buildSyncPlan>> = {};
  let stats: Record<string, number | string> = {};
  let error: string | null = null;
  try {
    const sheet = (await downloadSheet(await sheetUrl(userId), s, false)) as Record<string, unknown>[];
    const current = (await rows<RawMaterial>(userId, "select id, name, price_eur_per_kg, regulatory_note, active, updated_at::text from calc_raw_materials"))
      .map((m) => ({ ...m, price_eur_per_kg: Number(m.price_eur_per_kg) }));
    const preview = buildImportPreview(sheet, current);
    if (!preview) throw new Error(s.noColumns);
    if (!preview.added.length && !preview.changed.length && !preview.unchanged.length) throw new Error(s.noRows);
    plan = buildSyncPlan(preview, current);
    stats = {
      added: preview.added.length,
      changed: preview.changed.length,
      unchanged: preview.unchanged.length,
      invalid: preview.invalid.length,
      missing: preview.missing.length,
      removed: plan.deactivate!.length,
      restored: plan.reactivate!.length,
    };
  } catch (e) {
    plan = {};
    stats = {};
    error = errorText(e);
  }

  let catalog: CatalogRow[] | undefined;
  try {
    const url = await catalogSheetUrl(userId);
    if (url.trim()) catalog = parseCatalogSheet((await downloadSheet(url, s, true)) as unknown[][]);
  } catch (e) {
    stats.catalog_error = `${s.catalogLabel}: ${errorText(e)}`;
  }
  return record(userId, source, { ...plan, ...(catalog && { catalog }) }, stats, error);
}
