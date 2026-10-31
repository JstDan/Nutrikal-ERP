// Database engine. Every query runs as the signed-in user inside a
// transaction (request.jwt.claim.sub + role authenticated, exactly as
// Supabase does it), so row-level security and the role checks in
// ../supabase/migrations decide what each user may read and change.
//
// * DATABASE_URL set  → the Supabase Postgres (pg Pool on the pooler URL).
// * DATABASE_URL empty → local development: an embedded Postgres (PGlite)
//   in web/.data built from the same migrations, with Supabase's auth
//   pieces stubbed and demo data.
import fs from "node:fs";
import { getDict } from "@/lib/i18n";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import type { ClientBase, Pool } from "pg";

/** The part of a transaction the app uses (same shape for PGlite and pg). */
export type Tx = { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };

export const usesSupabaseDb = () => !!process.env.DATABASE_URL;

/** Cloudflare Workers: connections cannot be shared between requests there. */
export const onWorkers = () => typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

// ------------------------------------------------------------- Supabase
const g = globalThis as unknown as { __nkDb?: Promise<PGlite>; __nkPool?: Pool };

async function pgModule() {
  const pg = (await import("pg")).default;
  // Same JS values as the local engine: bigint as number, dates as Date
  pg.types.setTypeParser(20, (v: string) => Number(v));
  for (const oid of [1082, 1114, 1184]) pg.types.setTypeParser(oid, (v: string) => new Date(v));
  return pg;
}

const connection = () => ({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "") ? undefined : { rejectUnauthorized: false },
});

/**
 * On Workers the database is reached through Cloudflare Hyperdrive (binding
 * HYPERDRIVE in wrangler.jsonc): it pools the connections to Supabase and
 * handles Supabase's TLS certificate, which Workers sockets do not accept.
 */
function hyperdriveUrl(): string | undefined {
  const ctx = (globalThis as Record<symbol, { env?: { HYPERDRIVE?: { connectionString: string } } } | undefined>)[
    Symbol.for("__cloudflare-context__")
  ];
  return ctx?.env?.HYPERDRIVE?.connectionString;
}

/** A connection for one transaction: from the pool on a Node server, a fresh one on Workers. */
async function connect(): Promise<{ client: ClientBase; done: () => void }> {
  const pg = await pgModule();
  if (onWorkers()) {
    const url = hyperdriveUrl();
    const client = new pg.Client(url ? { connectionString: url } : connection());
    await client.connect();
    return { client, done: () => void client.end().catch(() => {}) };
  }
  g.__nkPool ??= new pg.Pool({ ...connection(), max: Number(process.env.DATABASE_POOL_SIZE ?? 5) });
  const client = await g.__nkPool.connect();
  return { client, done: () => client.release() };
}

/**
 * One transaction. `setup` (statements without parameters) is sent with
 * "begin" in a single round trip: the database is far away (≈100 ms each).
 */
async function pgTransaction<T>(fn: (c: ClientBase) => Promise<T>, setup = ""): Promise<T> {
  const { client, done } = await connect();
  try {
    await client.query(`begin;${setup}`);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    done();
  }
}

// ---------------------------------------------------------------- local
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

export function getDb(): Promise<PGlite> {
  if (!g.__nkDb) g.__nkDb = init();
  return g.__nkDb;
}

function migrationsDir() {
  return process.env.NK_MIGRATIONS_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "..", "supabase", "migrations");
}

async function init(): Promise<PGlite> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { citext } = await import("@electric-sql/pglite/contrib/citext");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { seedDemo } = await import("./demo-seed");
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
    // Real ingredients and opening stock from the old Nutrikal Inventory app
    const opening = path.join(/*turbopackIgnore: true*/ dir, "..", "import", "opening_stock.sql");
    if (fs.existsSync(opening)) await db.exec(fs.readFileSync(opening, "utf8"));
    console.log(`[nutrikal] database created in ${dataDir} with ${files.length} migrations + demo data + opening stock`);
  }
  return db;
}

// ------------------------------------------------------------------ API
/** A write from a read-only account: said plainly, in both languages (no session here). */
function readOnlyError(e: unknown): never {
  if ((e as { code?: string }).code === "25006") throw new Error(`${getDict("bg").common.readOnly} / ${getDict("en").common.readOnly}`);
  throw e;
}

/** Run fn inside a transaction as the given user (RLS applies). */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>, writable = false): Promise<T> {
  if (usesSupabaseDb()) {
    // The user and the role in the same round trip as "begin" (values inlined: the id is checked to be a uuid)
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user");
    const claims = JSON.stringify({ sub: userId, role: "authenticated" }).replaceAll("'", "''");
    return pgTransaction((c) => fn(c as unknown as Tx),
      `select set_config('request.jwt.claim.sub', '${userId}', true), set_config('request.jwt.claims', '${claims}', true);` +
      `set local role authenticated;${writable ? "" : " select public.app_session_start();"}`).catch(readOnlyError);
  }
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await tx.exec("set local role authenticated");
    if (!writable) await tx.query("select public.app_session_start()");
    return fn(tx);
  }).catch(readOnlyError) as T;
}

/** Convenience: rows of one query as the user. */
export async function q<T>(userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return withUser(userId, async (tx) => (await tx.query<T>(sql, params)).rows);
}

/**
 * The chat: never read only, so the accountant can write in it. Outside a read-only transaction
 * has_role() gives the accountant nothing, so only the rules of the chat tables let this through.
 */
export async function qChat<T>(userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return withUser(userId, async (tx) => (await tx.query<T>(sql, params)).rows, true);
}

/**
 * Jobs without a signed-in user (the scheduled price-list sync): runs as
 * the database owner. Only for SQL functions that check this themselves.
 */
export async function asSystem<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (usesSupabaseDb()) return pgTransaction(async (c) => (await c.query(sql, params)).rows as T[]);
  return (await (await getDb()).query<T>(sql, params)).rows;
}
