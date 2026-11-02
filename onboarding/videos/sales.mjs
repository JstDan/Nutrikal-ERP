// Video 1 — Търговец (sales). Captions: storyboard.md, "## sales".
import path from "node:path";
import fs from "node:fs";
import { actAs } from "../lib/users.mjs";
import { RAW } from "../lib/recorder.mjs";

export const name = "sales";
export const setup = actAs("sales");

export async function run(v) {
  const { page } = v;
  const btn = (re) => page.getByRole("button", { name: re }).first();
  const link = (re) => page.getByRole("link", { name: re }).first();

  await v.card("title", "title");

  // ------------------------------------------------ 1. Start
  await v.card("chapter", "ch-start", 2500);
  await v.goto("/");
  v.caption("home");
  await v.highlight(page.locator("aside nav").first(), 3000);
  v.caption("menu");
  await v.point(link(/^Клиенти$/));
  await v.point(link(/^Калкулатор$/));
  await v.point(link(/^Оферти$/));
  await v.point(link(/^Поръчки$/));
  v.caption("lang");
  await v.click(page.getByRole("button", { name: "EN", exact: true }), { wait: 2000 });
  await v.click(page.getByRole("button", { name: "БГ", exact: true }), { wait: 1500 });
  v.caption("search");
  await v.type(page.locator("#global-search"), "Demo");
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle");
  await v.sleep(2200);

  // ------------------------------------------------ 2. Clients
  await v.card("chapter", "ch-clients", 2500);
  await v.goto("/clients");
  v.caption("clients");
  await v.sleep(1500);
  await v.click(link(/Нов клиент/));
  v.caption("client-new");
  await v.type(page.getByLabel(/^Юридическо наименование/), "Example Health Ltd");
  await v.type(page.getByLabel(/^Имена/), "Мария Примерна");
  await v.type(page.getByLabel(/^Имейл \*?$/).first(), "maria@example.com");
  await v.type(page.getByLabel(/^Град/), "Пловдив");
  v.caption("client-save");
  await v.click(btn(/Създай клиент/), { wait: 2500 });
  v.caption("client-card");
  await v.highlight(page.getByRole("heading", { name: /Фирма и условия/ }).locator("xpath=ancestor::section[1]"), 2500);
  await v.highlight(page.getByRole("heading", { name: /^Поръчки/ }).locator("xpath=ancestor::section[1]"), 2000);

  // ------------------------------------------------ 3. Calculator: custom formula
  await v.card("chapter", "ch-calc", 2500);
  await v.goto("/calculator");
  v.caption("calc-mode");
  await v.highlight(page.locator('input[name="formula-mode"][value="custom"]').locator("xpath=ancestor::label[1]"), 2000);
  v.caption("calc-client");
  await v.type(page.locator("#crm-client"), "Demo Cl");
  await v.click(page.getByRole("option").first(), { wait: 900 });
  await v.type(page.locator("#offer-product"), "Magnesium + L-Theanine 60 caps");
  v.caption("calc-type");
  await v.click(page.locator('input[name="product-type"][value="capsules_glass"]').locator("xpath=ancestor::label[1]"), { wait: 900 });
  await v.click(page.locator('input[name="product-type"][value="capsules_plastic"]').locator("xpath=ancestor::label[1]"), { wait: 900 });
  v.caption("calc-lid");
  await v.click(page.locator('input[name="custom-lid"][value="aluminium"]').locator("xpath=ancestor::label[1]"), { wait: 900 });
  await v.click(page.locator('input[name="custom-lid"][value="plastic"]').locator("xpath=ancestor::label[1]"), { wait: 900 });

  v.caption("calc-materials");
  await v.type(page.locator("#material-search"), "magn bis");
  await v.click(page.getByRole("option", { name: /Magnesium Bisglycinate 20%/ }), { wait: 900 });
  await v.type(page.locator('[id^="amount-"]').last(), "300");
  await v.type(page.locator("#material-search"), "thean");
  await v.click(page.getByRole("option", { name: /Theanine/ }).first(), { wait: 900 });
  await v.type(page.locator('[id^="amount-"]').last(), "100");
  v.caption("calc-caps");
  await v.type(page.locator("#field-capsulesPerDose"), "2");
  await v.highlight(page.locator("#max-fill"), 1800);

  v.caption("calc-qty");
  await v.type(page.locator("#field-quantityPerUnit"), "60");
  await v.type(page.locator("#field-numberOfUnits"), "3000");
  v.caption("calc-markup");
  await v.highlight(page.locator("#markup"), 1800);
  v.caption("calc-tiers");
  await v.click(btn(/Добави ценово ниво/), { wait: 800 });
  await v.type(page.locator('[id^="tier-qty-"]').last(), "5000");
  await v.type(page.locator('[id^="tier-markup-"]').last(), "25");

  v.caption("calc-results");
  await v.scrollTo(page.getByRole("heading", { name: /Вътрешна разбивка/ }));
  await v.highlight(page.getByRole("heading", { name: /Вътрешна разбивка/ }).locator("xpath=ancestor::div[2]"), 3000);
  v.caption("calc-summary");
  await v.highlight(page.getByRole("heading", { name: /Обобщение на офертата за клиента/ }).locator("xpath=ancestor::div[1]"), 3000);
  v.caption("calc-save");
  await v.click(btn(/Създай оферта/), { wait: 3000 });

  // ------------------------------------------------ 4. The offer
  await v.card("chapter", "ch-offer", 2500);
  v.caption("offer-page");
  await v.sleep(2000);
  v.caption("offer-pdf");
  const dl = page.waitForEvent("download", { timeout: 30000 }).catch(() => null);
  await v.click(btn(/Изтегли PDF/), { wait: 2500 });
  const file = await dl;
  if (file) await file.saveAs(path.join(RAW, "sales", "offer.pdf")).catch(() => {});
  v.caption("offer-recipe");
  await v.highlight(link(/Отвори рецептата/), 2500);
  v.caption("offer-list");
  await v.goto("/offers");
  await v.highlight(page.locator("#calc-offers-title").locator("xpath=ancestor::section[1]"), 3000);

  // ------------------------------------------------ 5. Calculator: catalog formula
  await v.card("chapter", "ch-catalog", 2500);
  await v.goto("/calculator");
  const fresh = page.getByRole("button", { name: /Нова оферта/ }).first();
  if (await fresh.isVisible()) await v.click(fresh, { wait: 800 });
  const go = page.getByRole("button", { name: /^Продължи$/ });
  if (await go.isVisible().catch(() => false)) await v.click(go, { wait: 800 });
  v.caption("cat-mode");
  await v.click(page.locator('input[name="formula-mode"][value="catalog"]').locator("xpath=ancestor::label[1]"), { wait: 1000 });
  await v.type(page.locator("#crm-client"), "Sample");
  await v.click(page.getByRole("option").first(), { wait: 900 });
  v.caption("cat-product");
  await v.type(page.locator("#catalog-search"), "Magnesium Night");
  await v.click(page.getByRole("option").first(), { wait: 1500 });
  v.caption("cat-caps");
  await v.type(page.locator("#field-catalogCapsules"), "90");
  await v.highlight(page.getByRole("table", { name: /Цени по количество|стъпки|нива/i }).first(), 2500).catch(() => {});
  v.caption("cat-edit");
  const composition = page.getByText(/Състав на доза/).first();
  if (await composition.isVisible().catch(() => false)) await v.click(composition, { wait: 1200 });
  await v.highlight(btn(/Промени съставките/), 2500);

  // ------------------------------------------------ 6. Offer → order
  await v.card("chapter", "ch-order", 2500);
  await v.goto("/orders/new");
  v.caption("order-client");
  await v.type(page.locator("#order-client"), "Demo");
  await v.click(page.getByRole("option").first(), { wait: 1500 });
  v.caption("order-offer");
  await v.click(page.getByRole("checkbox").first(), { wait: 1200 });
  v.caption("order-services");
  await v.click(page.getByLabel(/Free Sale Certificate/), { wait: 1200 });
  v.caption("order-create");
  await v.click(btn(/Създай поръчка/), { wait: 3000 });
  v.caption("order-page");
  await v.highlight(page.getByRole("heading", { name: /Следваща стъпка/ }).locator("xpath=ancestor::section[1]"), 3000);
  v.caption("order-tasks");
  await v.sleep(2500);
  v.caption("order-proforma");
  await v.click(link(/Експорт проформа/), { wait: 3500 });

  // ------------------------------------------------ 7. What sales does not see
  await v.card("chapter", "ch-limits", 2500);
  await v.goto("/deliveries");
  v.caption("limits-deliveries");
  await v.sleep(3500);
  await v.goto("/inventory");
  v.caption("limits-stock");
  await v.sleep(3500);

  await v.card("recap", "recap", 6000);
  fs.mkdirSync(path.join(RAW, "sales"), { recursive: true });
}
