// Development helper: screenshots of app pages as a role, against the
// demo database (server must be running: node scripts/serve.mjs).
// Usage: node scripts/probe.mjs <role> <path> [<path>…]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { BASE_URL, ONBOARDING } from "../lib/app-server.mjs";
import { USERS } from "../lib/users.mjs";

const [role, ...paths] = process.argv.slice(2);
const dir = path.join(ONBOARDING, ".data", "probe");
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addCookies([{ name: "nk_act_as", value: USERS[role], domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
for (const p of paths) {
  await page.goto(BASE_URL + p, { waitUntil: "networkidle" });
  const file = path.join(dir, `${role}${p.replace(/[^a-z0-9]+/gi, "_")}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(file, await page.evaluate(() => document.documentElement.scrollWidth > innerWidth ? "HSCROLL" : ""));
}
await browser.close();
