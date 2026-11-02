// Video 3 — Производство (production). Captions: storyboard.md, "## production".
// Continues from the admin video: its production order, sent to production.
import path from "node:path";
import { actAs } from "../lib/users.mjs";
import { ONBOARDING } from "../lib/app-server.mjs";

export const name = "production";
export const setup = actAs("production");

const PRODUCT = "Magnesium + L-Theanine 60 caps";

export async function run(v) {
  const { page } = v;
  const btn = (re) => page.getByRole("button", { name: re }).first();
  const link = (re) => page.getByRole("link", { name: re }).first();
  const card = (re) => page.getByRole("heading", { name: re }).first()
    .locator("xpath=ancestor::*[self::section or contains(concat(' ', @class, ' '), ' card ') or contains(@class, 'rounded border')][1]");

  await v.card("title", "title");

  // ------------------------------------------------ 1. Today
  await v.card("chapter", "ch-today", 2500);
  await v.goto("/factory");
  v.caption("today");
  await v.highlight(page.locator("aside nav").first(), 2500);
  v.caption("today-orders");
  await v.highlight(card(/Изчакване и в производство/), 3000);
  v.caption("today-deliveries");
  await v.highlight(card(/Доставки на път/), 3000);

  // ------------------------------------------------ 2. Deliveries (the order's L-theanine is still on its way)
  await v.card("chapter", "ch-deliveries", 2500);
  await v.goto("/factory/deliveries");
  v.caption("deliveries");
  await v.sleep(2000);
  const open = page.locator(".row", { hasText: "Поръчани" }).filter({ hasText: /L-теанин|Theanine/ }).first();
  await v.click(open.getByRole("link").first(), { wait: 2000 });
  await page.waitForURL(/\/factory\/deliveries\/[0-9a-f-]{36}/);
  v.caption("delivery-form");
  const form = page.locator("form", { has: page.getByRole("button", { name: /^Получено$/ }) }).first();
  await v.highlight(form, 2500);
  v.caption("delivery-photo");
  await form.locator('input[type="file"]').first().setInputFiles(path.join(ONBOARDING, "lib", "waybill-demo.png"));
  await v.sleep(2000);
  v.caption("delivery-details");
  await v.type(form.getByLabel(/Партида на доставчика/), "DEMO-TH-2611");
  await form.getByLabel(/Срок на годност/).fill("2028-10-31");
  await v.sleep(800);
  v.caption("delivery-submit");
  await v.click(form.getByRole("button", { name: /^Получено$/ }), { wait: 3500 });

  // ------------------------------------------------ 3. The production order
  await v.card("chapter", "ch-order", 2500);
  await v.goto("/factory/orders");
  v.caption("orders");
  const row = page.locator(".row", { hasText: PRODUCT }).filter({ hasText: "Изчакване" }).first();
  await v.highlight(row, 3000);
  await v.click(row.getByRole("link").first(), { wait: 2000 });
  await page.waitForURL(/\/factory\/orders\/[0-9a-f-]{36}/);
  const moUrl = page.url();
  v.caption("order-materials");
  await v.highlight(card(/Материали за поръчката/), 3500);
  v.caption("order-sources");
  await v.highlight(card(/Доставчик, количество и цена/), 3500);
  v.caption("order-picklist");
  await v.click(link(/Лист за изписване/), { wait: 3000 });
  await page.goto(moUrl, { waitUntil: "networkidle" });
  await v.sleep(1000);
  v.caption("order-start");
  await v.click(btn(/Започни производството/), { wait: 3000 });

  // ------------------------------------------------ 4. Report
  await v.card("chapter", "ch-report", 2500);
  const report = page.locator("form", { has: page.getByRole("button", { name: /Готово за изпращане/ }) }).first();
  v.caption("report-intro");
  await v.scrollTo(report);
  await v.highlight(report.locator("fieldset").first(), 3000);
  v.caption("report-diff");
  // A little more magnesium than reserved: over the limit, so a reason is needed
  const first = report.locator("fieldset", { hasText: /бисглицинат/ }).first();
  const used = first.getByLabel(/Използвано от партидата/).first();
  const reserved = Number(await used.inputValue()) || 1;
  await v.type(used, String(Math.round(reserved * 1.08 * 1000) / 1000));
  await v.type(first.getByLabel(/Причина за разликата/), "Загуба при пълнене на капсулите");
  v.caption("report-batch");
  await v.scrollTo(report.getByLabel(/Ваш номер на партида/));
  await v.type(report.getByLabel(/Ваш номер на партида/), "B-2611-01");
  await v.highlight(report.getByLabel(/Произведено количество/), 1800);
  await report.getByLabel(/Дата на производство/).fill(new Date().toISOString().slice(0, 10));
  await v.sleep(800);
  v.caption("report-submit");
  await v.click(report.getByRole("button", { name: /Готово за изпращане/ }), { wait: 3500 });
  v.caption("report-usage");
  await v.scrollTo(card(/Резервирано vs използвано/));
  await v.highlight(card(/Резервирано vs използвано/), 3500);
  v.caption("invoice");
  await v.scrollTo(card(/Фактура за партидата/));
  await v.highlight(card(/Фактура за партидата/), 3000);

  // ------------------------------------------------ 5. Stock
  await v.card("chapter", "ch-stock", 2500);
  await v.goto("/factory/stock");
  v.caption("stock");
  await v.sleep(2500);
  v.caption("stock-search");
  await v.type(page.getByPlaceholder(/Търси партида/), "целулоза");
  await v.click(btn(/^Търси$/), { wait: 2000 });
  v.caption("stock-correct");
  const fix = page.locator("form", { has: page.getByRole("button", { name: /Запази корекцията/ }) }).first();
  await v.type(fix.getByRole("combobox").first(), "целулоза");
  await v.click(page.getByRole("option").first(), { wait: 800 });
  await v.type(fix.getByLabel(/Количество сега/), "24.5");
  await v.type(fix.getByLabel(/^Причина/), "Преброено на рафта");
  v.caption("stock-save");
  await v.click(fix.getByRole("button", { name: /Запази корекцията/ }), { wait: 3000 });
  await v.highlight(card(/Моите последни корекции/), 2500);

  // ------------------------------------------------ 6. Notifications
  await v.goto("/notifications");
  v.caption("notifications");
  await v.sleep(3000);

  await v.card("recap", "recap", 6000);
}
