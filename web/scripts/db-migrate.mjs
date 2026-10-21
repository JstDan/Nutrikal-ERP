// Applies the migrations in ../supabase/migrations to the Supabase
// database in DATABASE_URL (web/.env.local), each once and in order.
// Applied versions are recorded in supabase_migrations.schema_migrations,
// the same table the Supabase CLI uses, so both tools can be mixed.
//
//   npm run db:migrate                          apply new migrations
//   npm run db:migrate -- --with-opening-stock  also run supabase/import/opening_stock.sql (once)
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migDir = join(here, "..", "..", "supabase", "migrations");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is empty: fill it in web/.env.local (Supabase → Connect → Session pooler)");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
await client.connect();
await client.query(`create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
const done = new Set((await client.query("select version from supabase_migrations.schema_migrations")).rows.map((r) => r.version));

let applied = 0;
for (const file of readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
  const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
  if (done.has(version)) continue;
  const sql = readFileSync(join(migDir, file), "utf8");
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)",
      [version, [sql], rest.join("_")]);
    await client.query("commit");
    console.log(`applied  ${file}`);
    applied++;
  } catch (e) {
    await client.query("rollback");
    console.error(`FAILED   ${file}\n${e.message}`);
    await client.end();
    process.exit(1);
  }
}
console.log(applied ? `${applied} migration(s) applied` : "database is up to date");

if (process.argv.includes("--with-opening-stock")) {
  const marker = "import_opening_stock";
  if ((await client.query("select 1 from supabase_migrations.schema_migrations where version = $1", [marker])).rowCount) {
    console.log("opening stock was imported before; skipped");
  } else {
    const sql = readFileSync(join(migDir, "..", "import", "opening_stock.sql"), "utf8");
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into supabase_migrations.schema_migrations (version, name) values ($1, $1)", [marker]);
    await client.query("commit");
    console.log("opening stock imported");
  }
}
await client.end();
