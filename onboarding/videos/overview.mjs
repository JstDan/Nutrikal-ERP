// Video 0 — Обзор (≤ 90 s): how the roles hand work to each other.
// Recorded last, so every step already has data from the other videos.
import { actAs, USERS } from "../lib/users.mjs";

export const name = "overview";
export const setup = actAs("sales");

export async function run(v) {
  const { page } = v;
  const as = (role) => page.context().addCookies([{ name: "nk_act_as", value: USERS[role], domain: "localhost", path: "/" }]);

  await v.card("title", "title", 3500);

  v.caption("sales");
  await v.goto("/offers", { wait: 3500 });
  await v.goto("/orders", { wait: 3500 });

  await as("admin");
  v.caption("admin");
  await v.goto("/formulas", { wait: 3000 });
  await v.goto("/production", { wait: 3500 });
  v.caption("admin-buy");
  await v.goto("/deliveries/orders", { wait: 3500 });

  await as("production");
  v.caption("production");
  await v.goto("/factory", { wait: 3500 });
  await v.goto("/factory/orders", { wait: 3500 });

  await as("admin");
  v.caption("back");
  await v.goto("/production", { wait: 1200 });
  const ready = page.getByRole("link", { name: /^Готово за изпращане$/ }).or(page.getByRole("button", { name: /^Готово за изпращане$/ })).first();
  await v.click(ready, { wait: 1200 });
  await v.highlight(page.locator(".row", { hasText: "Magnesium + L-Theanine" }).first(), 3000);

  await v.card("recap", "recap", 7000);
}
