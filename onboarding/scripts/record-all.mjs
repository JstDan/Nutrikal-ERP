// npm run onboarding:record — resets the demo database, records every video
// and writes onboarding/out/<video>.mp4 + .srt.
//   node scripts/record-all.mjs                 everything
//   node scripts/record-all.mjs sales admin     only these (in this order)
//   --no-reset   keep the current demo database
//   --running    use the app already started with scripts/serve.mjs (no reset)
//   NK_FAST=1    trial run at full speed, no MP4 (checks the scripts)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prepareWorktree, startServer, BASE_URL, ONBOARDING } from "../lib/app-server.mjs";
import { FAST, launch, record } from "../lib/recorder.mjs";
import { stitch } from "../lib/stitch.mjs";
import { resetDb } from "./reset-db.mjs";
import { checkDemo } from "./check-demo.mjs";

// The order matters: later videos continue from what earlier ones created
// (the admin video confirms the payment of the order made in the sales video).
const ORDER = ["sales", "admin", "production", "developer", "overview"];

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith("--"));
const videos = only.length ? ORDER.filter((n) => only.includes(n)) : ORDER;

const running = args.includes("--running");
if (!running) {
  if (!args.includes("--no-reset")) await resetDb();
  else prepareWorktree();
  await checkDemo();
}
const server = running ? { stop: async () => {} } : await startServer();
const report = [];
let browser;
try {
  // Warm up: compile every page once so the recording never waits for the dev server
  browser = await launch();
  const warm = await browser.newContext();
  const page = await warm.newPage();
  for (const p of ["/", "/clients", "/clients/new", "/calculator", "/offers", "/orders", "/orders/new", "/formulas", "/production",
    "/deliveries", "/deliveries/orders", "/inventory", "/inventory/corrections", "/history", "/accounting", "/admin", "/invoices",
    "/factory", "/factory/orders", "/factory/stock", "/factory/deliveries", "/notifications"]) {
    await page.goto(BASE_URL + p, { waitUntil: "networkidle", timeout: 180000 }).catch(() => {});
  }
  await warm.close();

  for (const name of videos) {
    const spec = await import(pathToFileURL(path.join(ONBOARDING, "videos", `${name}.mjs`)).href);
    console.log(`[onboarding] recording ${name}…`);
    const result = await record(browser, name, spec.setup, spec.run);
    console.log(`[onboarding] ${name}: ${Math.round(result.duration / 1000)} s, ${result.cues.length} captions`);
    if (!FAST) console.log(`[onboarding] → ${stitch(result)}`);
    report.push({ name, seconds: Math.round(result.duration / 1000), problems: [...new Set(result.problems)] });
  }
} finally {
  await browser?.close();
  await server.stop();
}
fs.mkdirSync(path.join(ONBOARDING, "out"), { recursive: true });
fs.writeFileSync(path.join(ONBOARDING, "out", "report.json"), JSON.stringify(report, null, 2));
for (const r of report) {
  console.log(`${r.name}: ${r.seconds} s${r.problems.length ? `\n  ${r.problems.join("\n  ")}` : ""}`);
}
