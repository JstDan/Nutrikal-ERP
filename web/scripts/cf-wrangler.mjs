// Runs wrangler (deploy / dev) with the Supabase database from .env.local
// as the local stand-in for Hyperdrive: OpenNext's deploy and wrangler dev
// emulate the bindings locally and refuse to start without it.
import { spawnSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}
const env = { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: process.env.DATABASE_URL };
const r = spawnSync("npx", ["wrangler", ...process.argv.slice(2)], { env, stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
