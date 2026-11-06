// Full backup of the Supabase database and Storage files, without pg_dump.
//
//   cd web && node --env-file=.env.local scripts/backup-db.mjs ["D:\Nutrikal Backups"]
//
// Writes <dir>/<YYYY-MM-DD_HHMM>/:
//   data/<schema>.<table>.json   every row of every table (public, auth, storage, supabase_migrations, vault),
//                                read in ONE read-only repeatable-read transaction, so all tables are from the same moment
//   schema/columns.json          columns, types, defaults of every table
//   schema/functions.sql         source of every function in public
//   schema/policies.json         row-level security policies
//   storage/<bucket>/<path>      every file in Storage (downloaded with the service role key)
//   manifest.json                row counts per table, file list, time, database size
// The schema itself is rebuilt from supabase/migrations (git); the files above are the data.
// Restore is not automatic on purpose: rebuild the schema from the migrations, then load the rows back table by table.
import pg from "pg";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.argv[2] ?? "D:\\Nutrikal Backups";
const now = new Date();
const stamp = `${now.toISOString().slice(0, 10)}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
const out = join(root, stamp);
const SCHEMAS = ["public", "auth", "storage", "supabase_migrations", "vault"];
const write = (rel, data) => {
  const p = join(out, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 1));
};

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const manifest = { taken_at: now.toISOString(), database: null, tables: {}, files: [] };
try {
  await c.query("begin isolation level repeatable read read only");
  manifest.database = (await c.query("select current_database() as db, pg_size_pretty(pg_database_size(current_database())) as size")).rows[0];

  const tables = (await c.query(
    `select table_schema as s, table_name as t from information_schema.tables
      where table_type = 'BASE TABLE' and table_schema = any($1) order by 1, 2`, [SCHEMAS])).rows;
  for (const { s, t } of tables) {
    const rows = (await c.query(`select * from ${c.escapeIdentifier(s)}.${c.escapeIdentifier(t)}`)).rows;
    write(`data/${s}.${t}.json`, rows);
    manifest.tables[`${s}.${t}`] = rows.length;
  }

  write("schema/columns.json", (await c.query(
    `select table_schema, table_name, column_name, data_type, udt_name, is_nullable, column_default, ordinal_position
       from information_schema.columns where table_schema = any($1) order by 1, 2, ordinal_position`, [SCHEMAS])).rows);
  write("schema/functions.sql", (await c.query(
    `select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind in ('f', 'p') order by p.proname`)).rows.map((r) => r.def + ";\n").join("\n"));
  write("schema/policies.json", (await c.query("select * from pg_policies where schemaname = any($1) order by tablename, policyname", [SCHEMAS])).rows);

  const objects = (await c.query("select bucket_id, name from storage.objects order by bucket_id, name")).rows;
  await c.query("commit");

  // Storage files
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const o of objects) {
    const path = o.name.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${base}/storage/v1/object/${o.bucket_id}/${path}`, { headers: { authorization: `Bearer ${key}`, apikey: key } });
    const ok = res.ok;
    if (ok) write(`storage/${o.bucket_id}/${o.name}`, Buffer.from(await res.arrayBuffer()));
    manifest.files.push({ bucket: o.bucket_id, name: o.name, saved: ok, status: res.status });
  }
} finally {
  await c.end();
}
write("manifest.json", manifest);
const rows = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
console.log(`Backup: ${out}`);
console.log(`${Object.keys(manifest.tables).length} tables, ${rows} rows; ${manifest.files.filter((f) => f.saved).length}/${manifest.files.length} files`);
