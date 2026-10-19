// Local database engine: an embedded Postgres (PGlite) running the real
// Supabase migrations from ../supabase/migrations, with Supabase's auth
// pieces stubbed. Every query runs as the signed-in user, so row-level
// security and the role checks behave exactly as on Supabase.
//
// Moving to Supabase later = replace getDb()/withUser() with a pg Pool on
// the Supabase connection string; withUser keeps the same two settings
// (request.jwt.claim.sub + role authenticated), and all queries stay as they are.
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";
import { seedDemo } from "./demo-seed";

export type Tx = Transaction;

const SUPABASE_STUBS = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const g = globalThis as unknown as { __nkDb?: Promise<PGlite> };

export function getDb(): Promise<PGlite> {
  if (!g.__nkDb) g.__nkDb = init();
  return g.__nkDb;
}

function migrationsDir() {
  return process.env.NK_MIGRATIONS_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "..", "supabase", "migrations");
}

async function init(): Promise<PGlite> {
  const dataDir = process.env.NK_DB_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "pg");
  fs.mkdirSync(dataDir, { recursive: true });
  const db = await PGlite.create({ dataDir, extensions: { citext, pgcrypto } });

  const ready = await db.query<{ ok: boolean }>(
    "select to_regclass('public.profiles') is not null as ok",
  );
  if (!ready.rows[0]?.ok) {
    await db.exec(SUPABASE_STUBS);
    const dir = migrationsDir();
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && !f.includes("storage")) // storage needs Supabase itself
      .sort();
    for (const f of files) {
      await db.exec(fs.readFileSync(path.join(/*turbopackIgnore: true*/ dir, f), "utf8"));
    }
    await seedDemo(db);
    console.log(`[nutrikal] database created in ${dataDir} with ${files.length} migrations + demo data`);
  }
  return db;
}

/** Run fn inside a transaction as the given user (RLS applies). */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}

/** Convenience: rows of one query as the user. */
export async function q<T>(userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return withUser(userId, async (tx) => (await tx.query<T>(sql, params)).rows);
}
