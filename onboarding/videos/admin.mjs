// Video 2 — Администратор (admin). Captions: storyboard.md, "## admin".
// Continues from the sales video: its unpaid order for Demo Client Ltd.
import path from "node:path";
import { actAs } from "../lib/users.mjs";
import { ONBOARDING } from "../lib/app-server.mjs";

export const name = "admin";
export const setup = actAs("admin");

export async function run(v) {
  const { page } = v;
  const btn = (re) => page.getByRole("button", { name: re }).first();
  const link = (re) => page.getByRole("link", { name: re }).first();
  const section = (re) => page.getByRole("heading", { name: re }).first()
    .locator("xpath=ancestor::*[self::section or self::form or contains(concat(' ', @class, ' '), ' card ') or contains(@class, 'rounded border')][1]");

  await v.card("title", "title");

  // ------------------------------------------------ 1. Payment
  await v.card("chapter", "ch-payment", 2500);
  await v.goto("/orders");
  v.caption("orders");
  const unpaid = page.locator(".row", { hasText: "Неплатена" }).filter({ hasText: "Demo Client Ltd" }).first();
  await v.highlight(unpaid, 1800);
  await v.click(unpaid.getByRole("link").first(), { wait: 2000 });
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}/);
  const orderUrl = page.url();
  v.caption("pay-confirm");
  await v.click(btn(/Потвърди първо плащане/), { wait: 1200 });
  const dialog = page.locator("form", { hasText: "Какво е получено" }).first();
  v.caption("pay-dialog");
  await v.highlight(dialog, 2500);
  await v.click(dialog.getByRole("button", { name: /^Потвърди$/ }), { wait: 3000 });
  v.caption("pay-unlocked");
  await v.top();
  await v.sleep(2500);
  v.caption("tasks");
  await v.scrollTo(page.getByRole("heading", { name: /^Задачи/ }).first());
  await v.sleep(3500);

  // ------------------------------------------------ 2. Recipe
  await v.card("chapter", "ch-recipe", 2500);
  await v.goto("/formulas");
  v.caption("recipes");
  await v.click(page.locator(".row a[href^='/formulas/']").first(), { wait: 2000 });
  await page.waitForURL(/\/formulas\/[0-9a-f-]{36}/);
  const recipeUrl = page.url();
  v.caption("recipe-draft");
  await v.highlight(section(/Съставки на порция/), 3000);
  v.caption("recipe-link");
  // Only on a fresh database: once linked with "remember", later offers are linked by themselves
  for (const query of ["бисгли", "теанин"]) {
    const card = page.locator("form", { has: page.getByRole("button", { name: /^Свържи$/ }) }).first();
    if (!(await card.count())) break;
    await v.type(card.getByRole("combobox").first(), query);
    await v.click(page.getByRole("option").first(), { wait: 600 });
    await v.click(card.getByRole("button", { name: /^Свържи$/ }), { wait: 2000 });
  }
  v.caption("recipe-overage");
  await v.highlight(section(/Съставки на порция/), 3000);
  v.caption("recipe-capsule");
  await v.highlight(page.getByText(/Капсула \(обвивка\)/).first().locator("xpath=.."), 2500);
  v.caption("recipe-packaging");
  await v.scrollTo(section(/Опаковка на брой продукт/));
  await v.highlight(section(/Опаковка на брой продукт/), 3000);
  v.caption("recipe-stock");
  await v.scrollTo(section(/Наличност за/));
  await v.click(section(/Наличност за/).getByRole("button", { name: /Покажи/ }), { wait: 1500 });
  await v.highlight(section(/Наличност за/), 3000);
  v.caption("recipe-checks");
  await v.top();
  await v.highlight(section(/^Проверки/), 3000);
  v.caption("recipe-approve");
  await v.click(btn(/Одобри версията/), { wait: 3000 });

  // ------------------------------------------------ 3. Production planning
  await v.card("chapter", "ch-plan", 2500);
  await page.goto(orderUrl, { waitUntil: "networkidle" });
  await v.sleep(1200);
  v.caption("plan-link");
  const rec = page.locator("form", { has: page.getByRole("button", { name: /Свържи рецептата/ }) }).first();
  await v.scrollTo(rec);
  await v.highlight(rec.locator("select").first(), 2000);
  await v.click(rec.getByRole("button", { name: /Свържи рецептата/ }), { wait: 2000 });
  v.caption("plan-mo");
  await v.click(page.getByRole("button", { name: /Планирай производство/ }).first(), { wait: 3000 });
  await page.waitForURL(/\/production\/[0-9a-f-]{36}/);
  v.caption("mo-materials");
  await v.highlight(section(/^Материали/), 3500);
  v.caption("mo-reserve");
  await v.click(btn(/Резервирай свободното/), { wait: 2500 });
  v.caption("mo-request");
  await v.click(btn(/Заяви покупка на липсващото/), { wait: 2500 });
  const moUrl = page.url();

  // ------------------------------------------------ 4. Purchasing
  await v.card("chapter", "ch-buy", 2500);
  await v.goto("/deliveries");
  v.caption("buy-shortages");
  const short = section(/Липсващи суровини/);
  await v.scrollTo(short);
  await v.sleep(1500);
  v.caption("buy-tick");
  // The two raw materials of this order (its purchase requests are the newest rows); supplier and price come pre-filled
  for (const item of [/теанин/, /бисглицинат/]) {
    await v.click(short.getByRole("checkbox", { name: item }).first(), { wait: 900 });
  }
  // A little more magnesium than the shortage: the demo stock is already over-reserved by another order
  const mgRow = short.getByRole("checkbox", { name: /бисглицинат/ }).first().locator("xpath=ancestor::*[.//select][1]");
  await v.type(mgRow.getByLabel(/Количество/).first(), "35");
  await v.highlight(short.getByRole("checkbox", { name: /теанин/ }).first().locator("xpath=ancestor::*[.//select][1]"), 2000);
  v.caption("buy-generate");
  await v.click(short.getByRole("button", { name: /Генерирай заявки/ }).first(), { wait: 3000 });
  await page.waitForURL(/\/deliveries\/orders\/[0-9a-f-]{36}/);
  const poCode = ((await page.locator("h1").first().innerText()).match(/[A-Z]+-\d+/) ?? [""])[0];
  v.caption("po-draft");
  await v.sleep(2500);
  v.caption("po-pdf");
  await v.highlight(btn(/PDF на български/), 2500);
  v.caption("po-send");
  await v.click(btn(/Изпрати и създай очакваните доставки/), { wait: 3000 });
  v.caption("po-new");
  await v.goto("/deliveries/orders");
  await v.highlight(link(/Нова заявка за доставка/).or(btn(/Нова заявка за доставка/)), 2500);

  // ------------------------------------------------ 5. Receiving
  await v.card("chapter", "ch-receive", 2500);
  // Both deliveries of the purchase order just sent (the first one with captions)
  for (let i = 0; i < 2; i++) {
    await v.goto("/deliveries");
    if (i === 0) v.caption("receive-list");
    const delivery = page.locator("details", { hasText: poCode }).first();
    await v.scrollTo(delivery);
    await v.click(delivery.locator("summary"), { wait: 1500 });
    if (i === 0) v.caption("receive-form");
    const form = delivery.locator("form", { has: page.getByRole("button", { name: /^Получи$/ }) }).first();
    await v.scrollTo(form);
    await v.type(form.getByLabel(/Партида на доставчик/).first(), `DEMO-LOT-00${i + 1}`);
    await form.getByLabel(/Годно до/).first().fill("2028-10-31");
    if (i === 0) v.caption("receive-photo");
    await form.locator('input[type="file"]').first().setInputFiles(path.join(ONBOARDING, "lib", "waybill-demo.png"));
    await v.sleep(2500);
    await v.click(form.getByRole("button", { name: /^Получи$/ }), { wait: 3000 });
  }

  // ------------------------------------------------ 6. Send to production
  await v.card("chapter", "ch-release", 2500);
  await page.goto(moUrl, { waitUntil: "networkidle" });
  await v.sleep(1200);
  v.caption("release-reserve");
  await v.click(btn(/Резервирай свободното/), { wait: 2500 });
  v.caption("release-schedule");
  const plan = section(/Планиране/);
  await v.scrollTo(plan);
  const date = plan.locator('input[type="date"]').first();
  await date.fill(new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
  await v.click(plan.getByRole("button", { name: /Включи в графика/ }), { wait: 2500 });
  v.caption("release-send");
  await v.click(btn(/Изпрати към производството/), { wait: 3000 });
  // The production video needs this order: stop here if it was not sent
  await page.getByText("Изчакване", { exact: true }).first().waitFor({ timeout: 15000 });

  // ------------------------------------------------ 7. Reports
  await v.card("chapter", "ch-reports", 2500);
  await v.goto("/inventory");
  v.caption("stock");
  await v.sleep(1500);
  for (const tab of [/^Опаковки$/, /^Готова продукция$/, /^Суровини$/]) await v.click(link(tab).or(btn(tab)), { wait: 1200 });
  v.caption("stock-count");
  const count = section(/Инвентаризация/);
  if (await count.count()) { await v.scrollTo(count); await v.highlight(count, 2500); }
  await v.goto("/inventory/corrections");
  v.caption("corrections");
  await v.sleep(2500);
  await v.goto("/history");
  v.caption("history");
  await v.sleep(2500);
  await v.goto("/accounting");
  v.caption("accounting");
  await v.sleep(2500);
  await v.goto("/invoices");
  v.caption("invoices");
  await v.sleep(2500);
  await v.goto("/admin");
  v.caption("dashboard");
  await v.sleep(2000);
  await v.scrollBy(700, { wait: 1500 });
  await v.scrollBy(700, { wait: 1500 });

  await v.card("recap", "recap", 6000);
  void recipeUrl;
}
