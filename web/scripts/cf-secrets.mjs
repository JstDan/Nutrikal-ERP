// Copies the server-only settings from .env.local into Cloudflare secrets
// of the Worker (values go straight to wrangler, never printed).
import { spawnSync } from "node:child_process";

const KEYS = ["DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "GOOGLE_SHEET_URL", "RESEND_API_KEY", "MAIL_FROM", "AI_BASE_URL", "AI_API_KEY", "AI_MODELS", "AI_CATALOG_MODEL", "AI_READ_MAIL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GMAIL_TOKEN_KEY"];
const secrets = Object.fromEntries(KEYS.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
const missing = KEYS.filter((k) => !secrets[k]);
if (missing.length) console.warn(`not set in .env.local (skipped): ${missing.join(", ")}`);
const r = spawnSync("npx", ["wrangler", "secret", "bulk"], { input: JSON.stringify(secrets), stdio: ["pipe", "inherit", "inherit"], shell: true });
process.exit(r.status ?? 1);
