// Records one onboarding video: a Chrome window at 1920×1080 driven at a
// human pace, with the overlay (cursor, click rings, highlight box), cards
// and caption cues that become .srt files and burned-in subtitles.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { BASE_URL, ONBOARDING } from "./app-server.mjs";
import { loadStoryboard } from "./storyboard.mjs";

const W = 1920, H = 1080;
const OVERLAY = fs.readFileSync(path.join(ONBOARDING, "lib", "overlay.js"), "utf8");
const CARD = pathToFileURL(path.join(ONBOARDING, "lib", "card.html")).href;
const CARD_HTML = fs.readFileSync(path.join(ONBOARDING, "lib", "card.html"), "utf8");
export const RAW = path.join(ONBOARDING, "raw");
/** NK_FAST=1: a quick trial run (no human pace) to check the script works. */
export const FAST = !!process.env.NK_FAST;
const sleep = (ms) => new Promise((r) => setTimeout(r, FAST ? Math.min(ms, 150) : ms));

/** Starts a browser for the whole run (installed Google Chrome: no browser download). */
export const launch = () => chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars"] });

/**
 * Records `name` with `fn(v)`; returns the raw video path and the caption cues.
 * `as` is the user the session acts as before recording starts (see setUser).
 */
export async function record(browser, name, setup, fn) {
  const story = loadStoryboard()[name];
  if (!story) throw new Error(`storyboard.md has no "## ${name}" section`);
  fs.mkdirSync(path.join(RAW, name), { recursive: true });
  for (const f of fs.readdirSync(path.join(RAW, name))) fs.rmSync(path.join(RAW, name, f), { recursive: true, force: true });

  const context = await browser.newContext({
    viewport: { width: W, height: H }, locale: "bg-BG", timezoneId: "Europe/Sofia",
    recordVideo: { dir: path.join(RAW, name), size: { width: W, height: H } },
  });
  await context.addInitScript(OVERLAY);
  if (setup) await setup(context);
  const page = await context.newPage();
  const t0 = Date.now();
  const cues = [];
  const problems = [];
  const shots = [];
  let open = null;
  const now = () => Date.now() - t0;
  const closeCue = () => { if (open) { open.end = now(); cues.push(open); open = null; } };
  const text = (id) => {
    const s = story[id];
    if (!s) throw new Error(`storyboard.md "## ${name}" has no step "${id}"`);
    return s;
  };

  /** page.evaluate that survives a navigation still in progress. */
  const evaluate = async (fn, arg) => {
    for (let i = 0; ; i++) {
      try { return await page.evaluate(fn, arg); } catch (e) {
        if (i >= 5 || !/context was destroyed|navigation/i.test(e.message)) throw e;
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(300);
      }
    }
  };
  const centre = async (loc) => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    if (!b) throw new Error(`not visible: ${loc}`);
    return b;
  };
  const v = {
    page, story, url: (p) => BASE_URL + p, sleep,
    /** Full-frame title / chapter / recap card. */
    async card(kind, id, ms = 3500) {
      closeCue();
      const s = text(id);
      const [title, ...rest] = s.bg.split(" — ");
      const params = new URLSearchParams({ kind, title, text: kind === "recap" ? "" : rest.join(" — "),
        list: kind === "recap" ? rest.join(" — ").split(";").map((x) => x.trim()).join("|") : "",
        kicker: kind === "title" ? "Обучение" : kind === "chapter" ? "Глава" : "Обобщение" });
      if (page.url() === "about:blank") {
        await page.goto(`${CARD}?${params}`);
        await sleep(ms);
        return;
      }
      // Over the current app page, so the page keeps its state behind the card
      const html = CARD_HTML.replace("<script>", `<script>window.CARD = ${JSON.stringify(params.toString())};</script><script>`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(300);
      await evaluate((srcdoc) => {
        const f = document.createElement("iframe");
        f.id = "nk-card";
        f.srcdoc = srcdoc;
        f.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647;background:#222831";
        document.documentElement.appendChild(f);
      }, html);
      await sleep(ms);
      await evaluate(() => document.getElementById("nk-card")?.remove());
      await sleep(400);
    },
    /** Shows the caption of step `id` until the next one. */
    caption(id) {
      closeCue();
      const s = text(id);
      open = { id, start: now(), bg: s.bg, en: s.en };
      if (process.env.NK_SHOTS) {
        const dir = path.join(RAW, name, "shots");
        fs.mkdirSync(dir, { recursive: true });
        shots.push(page.screenshot({ path: path.join(dir, `${String(cues.length).padStart(2, "0")}-${id}.png`) }).catch(() => {}));
      }
    },
    async goto(p, { wait = 1500 } = {}) {
      await page.goto(BASE_URL + p, { waitUntil: "networkidle" }).catch(() => {});
      await v.check();
      await sleep(wait);
    },
    /** Notes problems seen on the page: sideways scroll, untranslated keys. */
    async check() {
      const r = await evaluate(() => ({ wide: document.documentElement.scrollWidth > window.innerWidth + 1,
        keys: (document.body.innerText.match(/[a-z]+(.[a-zA-Z]+){1,}/g) || []).filter((k) => !/.(com|pdf|xlsx|csv|bg|de|uk)$/.test(k)).slice(0, 5) }));
      const where = new URL(page.url()).pathname;
      if (r.wide) problems.push(`${where}: horizontal scroll at 1920 px`);
      if (r.keys.length) problems.push(`${where}: text that looks like an i18n key: ${r.keys.join(", ")}`);
    },
    /** Moves the cursor smoothly to an element. */
    async point(loc) {
      const b = await centre(loc);
      const x = b.x + b.width / 2, y = b.y + Math.min(b.height / 2, 22);
      await page.mouse.move(x, y, { steps: FAST ? 2 : 25 });
      await sleep(250);
      return b;
    },
    /** A green box around an element for `ms`. */
    async highlight(loc, ms = 2200) {
      const b = await centre(loc);
      await evaluate((r) => window.__nkHighlight?.(r), { x: b.x, y: b.y, width: b.width, height: b.height });
      await sleep(ms);
      await evaluate(() => window.__nkHighlight?.(null));
    },
    async click(loc, { wait = 1500 } = {}) {
      await v.point(loc);
      await loc.click();
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(wait);
    },
    async type(loc, value, { wait = 600 } = {}) {
      await v.point(loc);
      await loc.click();
      await loc.fill("");
      await loc.pressSequentially(String(value), { delay: FAST ? 0 : 70 });
      await sleep(wait);
    },
    async select(loc, option, { wait = 900 } = {}) {
      await v.point(loc);
      await loc.selectOption(option);
      await sleep(wait);
    },
    async scrollTo(loc, { wait = 1200 } = {}) {
      await loc.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
      await sleep(wait);
    },
    async scrollBy(dy, { wait = 1000 } = {}) {
      await evaluate((d) => window.scrollBy({ top: d, behavior: "smooth" }), dy);
      await sleep(wait);
    },
    async top() { await evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" })); await sleep(800); },
  };

  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  try {
    await fn(v);
  } catch (e) {
    await page.screenshot({ path: path.join(RAW, name, "failed.png") }).catch(() => {});
    throw e;
  } finally {
    closeCue();
    await Promise.all(shots);
    await page.close();
    await context.close();
  }
  const file = fs.readdirSync(path.join(RAW, name)).find((f) => f.endsWith(".webm"));
  return { name, video: path.join(RAW, name, file), cues, problems, duration: now() };
}
