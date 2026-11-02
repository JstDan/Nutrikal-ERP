// Runs the app for recording: a separate git worktree of the current commit
// (so web/.env.local, which points at the shared live Supabase, is never
// there), with every Supabase variable forced empty, so the app uses its
// embedded local database (PGlite) in onboarding/.data/pg.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ONBOARDING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = path.resolve(ONBOARDING, "..");
export const APP = path.join(ROOT, ".onboarding-app");
export const DB_DIR = path.join(ONBOARDING, ".data", "pg");
export const PORT = Number(process.env.NK_ONBOARDING_PORT ?? 3100);
export const BASE_URL = `http://localhost:${PORT}`;

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

/** Creates or refreshes the worktree at the current commit. */
export function prepareWorktree() {
  const head = git("rev-parse", "HEAD");
  if (!fs.existsSync(path.join(APP, ".git"))) {
    git("worktree", "add", "--detach", APP, head);
  } else {
    execFileSync("git", ["checkout", "-q", "--", "web/next.config.ts"], { cwd: APP });
    execFileSync("git", ["checkout", "-q", "--detach", head], { cwd: APP });
  }
  const web = path.join(APP, "web");
  // Shared node_modules (junction), as in the main checkout
  const nm = path.join(web, "node_modules");
  if (!fs.existsSync(nm)) fs.symlinkSync(path.join(ROOT, "web", "node_modules"), nm, "junction");
  // Turbopack must see the main repo root, where node_modules really lives
  const cfg = path.join(web, "next.config.ts");
  const src = fs.readFileSync(cfg, "utf8");
  if (!src.includes("root:")) {
    fs.writeFileSync(cfg, src.replace(/turbopack: \{\r?\n/, (m) => `${m}    root: ${JSON.stringify(ROOT.replaceAll("\\", "/"))},\n`));
  }
  assertLocalOnly();
  return head;
}

/** Refuses to go on if anything could point the app at a real database. */
export function assertLocalOnly() {
  const web = path.join(APP, "web");
  // The files Next.js loads in development (.env.example is never loaded)
  const envFiles = [".env", ".env.local", ".env.development", ".env.development.local"].filter((f) => fs.existsSync(path.join(web, f)));
  if (envFiles.length) throw new Error(`Refusing to record: ${envFiles.join(", ")} found in ${web}`);
}

/**
 * The migrations are copied next to the database, so the app does not find
 * supabase/import/opening_stock.sql (real ingredients, suppliers and stock).
 */
export const MIGRATIONS_DIR = path.join(ONBOARDING, ".data", "supabase", "migrations");
export function copyMigrations() {
  fs.rmSync(path.dirname(MIGRATIONS_DIR), { recursive: true, force: true });
  fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  for (const f of fs.readdirSync(path.join(APP, "supabase", "migrations"))) {
    fs.copyFileSync(path.join(APP, "supabase", "migrations", f), path.join(MIGRATIONS_DIR, f));
  }
}

const SAFE_ENV = {
  NK_MIGRATIONS_DIR: MIGRATIONS_DIR,
  DATABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  GOOGLE_SHEET_URL: "",
  GOOGLE_CATALOG_SHEET_URL: "",
  CRON_SECRET: "",
  NK_DB_DIR: DB_DIR,
  NEXT_TELEMETRY_DISABLED: "1",
};

/** Starts `next dev` on PORT and resolves when it answers; returns a stop() function. */
export async function startServer({ log = path.join(ONBOARDING, ".data", "server.log") } = {}) {
  assertLocalOnly();
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const out = fs.openSync(log, "w");
  const web = path.join(APP, "web");
  const child = spawn(process.execPath, [path.join(web, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(PORT)], {
    cwd: web, env: { ...process.env, ...SAFE_ENV }, stdio: ["ignore", out, out], windowsHide: true,
  });
  const stop = async () => {
    if (child.exitCode != null) return;
    try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { child.kill(); }
    await new Promise((r) => setTimeout(r, 1500));
  };
  for (let i = 0; i < 120; i++) {
    if (child.exitCode != null) throw new Error(`next dev exited, see ${log}`);
    try {
      const r = await fetch(`${BASE_URL}/login`, { redirect: "manual" });
      if (r.status > 0) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  // The first request creates (or opens) the local database: it must be ours
  const fresh = !fs.existsSync(path.join(DB_DIR, "PG_VERSION"));
  await fetch(`${BASE_URL}/`, { redirect: "manual" }).catch(() => {});
  for (let i = 0; i < 300; i++) {
    const created = fs.readFileSync(log, "utf8").includes(`database created in ${DB_DIR}`);
    if (fresh ? created : fs.existsSync(path.join(DB_DIR, "PG_VERSION"))) break;
    if (i % 10 === 9) await fetch(`${BASE_URL}/`, { redirect: "manual" }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!fs.existsSync(path.join(DB_DIR, "PG_VERSION")) || (fresh && !fs.readFileSync(log, "utf8").includes(`database created in ${DB_DIR}`))) {
    await stop();
    throw new Error(`Refusing to record: the app did not open the local database in ${DB_DIR}`);
  }
  return { stop, log };
}
