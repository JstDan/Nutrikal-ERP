// Video 4 — Developer (short). Captions: storyboard.md, "## developer".
// Uses the real "act as" switch (logged in impersonation_log), not the cookie.
import { actAs } from "../lib/users.mjs";

export const name = "developer";
export const setup = actAs("developer");

export async function run(v) {
  const { page } = v;
  const sw = page.locator("#act-as");
  const switchTo = async (label) => {
    await v.point(sw);
    // The select submits a server action, which logs the switch and redirects to that role's home page
    const posted = page.waitForResponse((r) => r.request().method() === "POST", { timeout: 30000 });
    await sw.selectOption({ label });
    await posted;
    await page.waitForLoadState("networkidle");
    await page.reload({ waitUntil: "networkidle" });
    const now = await sw.evaluate((s) => s.selectedOptions[0]?.label);
    if (now !== label) throw new Error(`act as "${label}" did not take effect (shows "${now}")`);
    await v.sleep(1200);
  };
  const option = async (role) => (await sw.locator("option").allInnerTexts()).find((o) => o.endsWith(role));

  await v.card("title", "title");
  await v.goto("/");
  v.caption("switch");
  await v.highlight(page.locator("form:has(#act-as)"), 3500);

  v.caption("as-admin");
  await switchTo(await option("Администратор"));
  await v.highlight(page.locator("aside nav").first(), 3500);

  v.caption("as-sales");
  await switchTo(await option("Продажби"));
  await v.highlight(page.locator("aside nav").first(), 3500);

  v.caption("as-production");
  await switchTo(await option("Производство"));
  await v.goto("/factory");
  await v.highlight(page.locator("aside nav").first(), 3500);

  v.caption("logged");
  await switchTo(await option("Администратор"));
  await v.highlight(page.locator("form:has(#act-as)"), 3500);

  await v.card("recap", "recap", 5000);
}
