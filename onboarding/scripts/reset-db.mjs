// Resets the demo database: a fresh local PGlite database built by the app
// from the migrations and its demo data, then made fictional by
// lib/demo-data.mjs. Never touches web/.env.local or the live Supabase.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP, DB_DIR, ROOT, copyMigrations, prepareWorktree, startServer } from "../lib/app-server.mjs";
import { seedDemo } from "../lib/demo-data.mjs";

export async function resetDb() {
  const head = prepareWorktree();
  console.log(`[onboarding] app worktree ${APP} at ${head.slice(0, 7)}`);
  copyMigrations();
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  const server = await startServer();
  await server.stop();
  console.log("[onboarding] local database created");
  const { PGlite } = await import(pathToFileURL(path.join(ROOT, "web", "node_modules", "@electric-sql", "pglite", "dist", "index.js")).href);
  const { citext } = await import(pathToFileURL(path.join(ROOT, "web", "node_modules", "@electric-sql", "pglite", "dist", "contrib", "citext.js")).href);
  const { pgcrypto } = await import(pathToFileURL(path.join(ROOT, "web", "node_modules", "@electric-sql", "pglite", "dist", "contrib", "pgcrypto.js")).href);
  const db = await PGlite.create({ dataDir: DB_DIR, extensions: { citext, pgcrypto } });
  try {
    await seedDemo(db);
  } finally {
    await db.close();
  }
  console.log("[onboarding] demo data seeded");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  resetDb().catch((e) => { console.error(e); process.exit(1); });
}
