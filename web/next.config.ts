import type { NextConfig } from "next";

// Internal, fully per-user app: every page depends on the signed-in user,
// so the classic dynamic rendering model is used (cache components off).
const nextConfig: NextConfig = {
  cacheComponents: false,
  serverExternalPackages: ["@electric-sql/pglite"],
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
  },
};

export default nextConfig;
