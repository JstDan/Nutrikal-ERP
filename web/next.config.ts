import type { NextConfig } from "next";

// Internal, fully per-user app: every page depends on the signed-in user,
// so the classic dynamic rendering model is used (cache components off).
const nextConfig: NextConfig = {
  cacheComponents: false,
  serverExternalPackages: ["@electric-sql/pglite"],
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
