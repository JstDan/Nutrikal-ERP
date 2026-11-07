// The same as db-migrate.mjs, without the database password: through the Supabase Management API
// with a personal access token (SUPABASE_ACCESS_TOKEN in web/.env.local, made under
// supabase.com/dashboard/account/tokens) and the project (SUPABASE_PROJECT_REF, default the live one).
// Applied versions go to supabase_migrations.schema_migrations, as with db-migrate.mjs.
//
//   npm run db:migrate:api              apply new migrations
//   npm run db:migrate:api -- --list    only show what would be applied
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migDir = join(here, "..", "..", "supabase", "migrations");
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const ref = process.env.SUPABASE_PROJECT_REF?.trim() || "dopxoijjhotjyalchuex";
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN is empty: make one under supabase.com/dashboard/account/tokens and put it in web/.env.local");
  process.exit(1);
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text.slice(0, 1500)}`);
  return text ? JSON.parse(text) : [];
}

/** A text as an SQL literal that no migration can end early. */
const lit = (s) => {
  let tag = "nkmig";
  while (s.includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${s}$${tag}$`;
};

await sql(`create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
const done = new Set((await sql("select version from supabase_migrations.schema_migrations")).map((r) => r.version));
const todo = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort().filter((f) => !done.has(f.split("_")[0]));

if (process.argv.includes("--list")) {
  console.log(todo.length ? `to apply (${todo.length}):\n  ${todo.join("\n  ")}` : "database is up to date");
  process.exit(0);
}

let applied = 0;
for (const file of todo) {
  const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
  const body = readFileSync(join(migDir, file), "utf8");
  try {
    // One request, one transaction: all of the migration and its record, or nothing
    await sql(`begin;\n${body}\n;insert into supabase_migrations.schema_migrations (version, statements, name) values (${lit(version)}, array[${lit(body)}], ${lit(rest.join("_"))});\ncommit;`);
    console.log(`applied  ${file}`);
    applied++;
  } catch (e) {
    console.error(`FAILED   ${file}\n${e.message}`);
    process.exit(1);
  }
}
console.log(applied ? `${applied} migration(s) applied` : "database is up to date");
