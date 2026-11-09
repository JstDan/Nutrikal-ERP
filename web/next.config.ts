import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// Cloudflare Workers build (npm run cf:build): the app always runs on
// Supabase there, so the embedded local database (PGlite) is left out.
const cloudflare = process.env.NK_TARGET === "cloudflare";
const noLocalDb = "./src/lib/db/no-local-db.ts";
// Browser-only libraries: the real one in the browser, a stub in the Worker
const browserOnly = (browser: string) => ({ browser, default: "./src/lib/browser-only-stub.ts" });

// Internal, fully per-user app: every page depends on the signed-in user,
// so the classic dynamic rendering model is used (cache components off).
// The version of this build: an open page compares it with the server's and reloads itself after a release
// (owner, Nov 2026: a tab left open called the actions of the release before and failed)
// The git commit: the same in every part of one build (the config is loaded more than once while building)
const buildId = process.env.NK_BUILD_ID?.trim() || (() => {
  try { return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "dev"; }
})();

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  cacheComponents: false,
  serverExternalPackages: cloudflare ? [] : ["@electric-sql/pglite"],
  // pg loads its Workers socket (pg-cloudflare) only under the "workerd"
  // condition, which Next's file tracing does not follow
  ...(cloudflare && { outputFileTracingIncludes: { "/*": ["./node_modules/pg-cloudflare/**/*"] } }),
  // Waybill photos are uploaded through Server Actions (compressed in the
  // browser to a few hundred KB each; up to 10 MB per file is accepted)
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
    ...(cloudflare && {
      resolveAlias: {
        "@electric-sql/pglite": noLocalDb,
        "@electric-sql/pglite/contrib/citext": noLocalDb,
        "@electric-sql/pglite/contrib/pgcrypto": noLocalDb,
        jspdf: browserOnly("./node_modules/jspdf/dist/jspdf.es.min.js"),
        "jspdf-autotable": browserOnly("./node_modules/jspdf-autotable/dist/jspdf.plugin.autotable.mjs"),
        heic2any: browserOnly("./node_modules/heic2any/dist/heic2any.js"),
      },
    }),
  },
};

export default nextConfig;
