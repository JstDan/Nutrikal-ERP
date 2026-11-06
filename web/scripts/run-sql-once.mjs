// Runs a one-off SQL file on the database of .env.local in ONE transaction.
//
//   cd web && node --env-file=.env.local scripts/run-sql-once.mjs <file.sql>            dry run: runs, shows counts, rolls back
//   cd web && node --env-file=.env.local scripts/run-sql-once.mjs <file.sql> --commit   runs and commits
//
// Before and after it prints row counts of the main tables. After a commit it removes the Storage
// files whose database rows are gone (buckets order-task-files, delivery-docs, client-files only).
import pg from "pg";
import { readFileSync } from "node:fs";

const [file, flag] = process.argv.slice(2);
if (!file) throw new Error("Give the SQL file");
const commit = flag === "--commit";
const sql = readFileSync(file, "utf8");
const TABLES = ["clients", "contacts", "client_emails", "calc_offers", "formulas", "formula_versions", "projects", "sales_orders",
  "manufacturing_orders", "purchase_requests", "purchase_orders", "expected_deliveries", "lots", "stock_movements",
  "stock_reservations", "dispatches", "order_task_boards", "order_tasks", "invoices", "items", "notifications", "catalog_enquiries"];
const BUCKETS = ["order-task-files", "delivery-docs", "client-files"];

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const counts = async () => {
  const out = {};
  for (const t of TABLES) out[t] = Number((await c.query(`select count(*) from public.${t}`)).rows[0].count);
  return out;
};
// Storage files still pointed to by a row: the path is kept in these columns
const referenced = async () => new Set((await c.query(`
  select storage_path as p from public.order_task_files union all
  select storage_path from public.delivery_attachments union all
  select storage_path from public.client_files`)).rows.map((r) => r.p));

await c.query("begin");
let removed = [];
try {
  const before = await counts();
  const filesBefore = (await c.query("select bucket_id, name from storage.objects where bucket_id = any($1)", [BUCKETS])).rows;
  await c.query(sql);
  const after = await counts();
  const still = await referenced();
  removed = still ? filesBefore.filter((o) => !still.has(o.name)) : [];
  console.log("table                 before   after");
  for (const t of TABLES) console.log(`${t.padEnd(22)}${String(before[t]).padStart(6)}  ${String(after[t]).padStart(6)}`);
  console.log(`storage files to remove: ${removed.length}`);
  await c.query(commit ? "commit" : "rollback");
  console.log(commit ? "COMMITTED" : "DRY RUN: rolled back, nothing changed");
} catch (e) {
  await c.query("rollback");
  console.error("FAILED, rolled back:", e.message);
  process.exit(1);
} finally {
  await c.end();
}

if (commit && removed.length) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const b of BUCKETS) {
    const names = removed.filter((o) => o.bucket_id === b).map((o) => o.name);
    if (!names.length) continue;
    const res = await fetch(`${base}/storage/v1/object/${b}`, {
      method: "DELETE", headers: { authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: names }),
    });
    console.log(`storage ${b}: ${names.length} file(s) removed (${res.status})`);
  }
}
