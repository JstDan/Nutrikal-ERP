// OpenNext copies the values of the .env files into the Worker bundle.
// Keep only the public NEXT_PUBLIC_* ones there; everything else (database
// password, Supabase secret key, cron secret) is set as a Cloudflare
// secret instead (npm run cf:secrets).
import { readFileSync, writeFileSync } from "node:fs";

const file = ".open-next/cloudflare/next-env.mjs";
const out = [];
for (const line of readFileSync(file, "utf8").split("\n")) {
  const m = /^export const (\w+) = (.*);$/.exec(line);
  if (!m) continue;
  const vars = Object.fromEntries(Object.entries(JSON.parse(m[2])).filter(([k]) => k.startsWith("NEXT_PUBLIC_")));
  out.push(`export const ${m[1]} = ${JSON.stringify(vars)};`);
}
writeFileSync(file, out.join("\n") + "\n");
console.log(`kept only NEXT_PUBLIC_* in ${file}`);
