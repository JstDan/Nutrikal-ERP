"""End-to-end UI check of the Nutrikal ERP web app (run against a fresh demo DB).
Usage: python3 ui_test.py [base_url] [screenshot_dir]
"""
import re
import sys
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100"
SHOTS = sys.argv[2] if len(sys.argv) > 2 else "."
USERS = {
    "admin": "00000000-0000-4000-8000-00000000000a",
    "sales": "00000000-0000-4000-8000-00000000000b",
    "production": "00000000-0000-4000-8000-00000000000d",
}
passed, failed = 0, 0


def step(name, fn):
    global passed, failed
    try:
        fn()
        passed += 1
        print(f"  pass  {name}")
    except Exception as e:  # noqa: BLE001
        failed += 1
        print(f"  FAIL  {name}\n        {str(e).splitlines()[0][:300]}")


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome")

    def page_as(role, locale="en", width=1440, height=1000):
        ctx = browser.new_context(viewport={"width": width, "height": height})
        ctx.add_cookies([
            {"name": "nk_demo_user", "value": USERS[role], "url": BASE},
            {"name": "nk_locale", "value": locale, "url": BASE},
        ])
        return ctx.new_page()

    # ------------------------------------------------------------------ CRM
    print("CRM")
    p = page_as("sales")
    state = {}

    def create_client():
        p.goto(f"{BASE}/clients/new")
        p.fill("input[name=legal_name]", "Test Labs Ltd")
        p.fill("input[name=country_code]", "ie")
        p.fill("input[name=vat_number]", "ie 6388047v")
        p.select_option("select[name=status]", "active")
        p.fill("input[name=deposit_pct]", "40")
        p.select_option("select[name=balance_terms]", "net_days")
        p.fill("input[name=balance_net_days]", "14")
        p.click("main button[type=submit]")
        p.wait_for_url(re.compile(r"/clients/[0-9a-f-]{36}$"))
        expect(p.locator("h1")).to_have_text("Test Labs Ltd")
        expect(p.get_by_text("NK-C-0005 · IE · VAT IE6388047V")).to_be_visible()
        expect(p.get_by_text("40% deposit · balance net 14 days")).to_be_visible()
        state["client_url"] = p.url
    step("sales creates a client (code, VAT clean-up, terms)", create_client)

    def add_contact():
        p.click("summary:has-text('Add contact')")
        form = p.locator("form:has(input[name=first_name])")
        form.locator("input[name=first_name]").fill("Mary")
        form.locator("input[name=last_name]").fill("Byrne")
        form.locator("input[name=email]").fill("mary@testlabs.ie")
        form.locator("button[type=submit]").click()
        expect(p.get_by_text("Mary Byrne")).to_be_visible()
        expect(p.get_by_text("Primary", exact=True)).to_be_visible()
    step("sales adds the first contact (becomes primary)", add_contact)

    def create_project():
        form = p.locator("form:has(input[name=expected_units])")
        form.locator("input[name=name]").fill("Iron + Vitamin C · 60 caps")
        form.locator("select[name=product_format]").select_option("capsule")
        form.locator("input[name=expected_units]").fill("10000")
        form.locator("button[type=submit]").click()
        expect(p.get_by_text("NK-P-0007 · Iron + Vitamin C · 60 caps")).to_be_visible()
    step("sales creates a project (NK-P-0007)", create_project)

    def log_task():
        form = p.locator("form:has(input[name=subject])")
        form.locator("select[name=type]").select_option("task")
        form.locator("input[name=subject]").fill("Send sample request form")
        form.locator("select[name=project_id]").select_option(label="NK-P-0007")
        form.locator("button[type=submit]").click()
        expect(p.get_by_text("Send sample request form")).to_be_visible()
        p.goto(f"{BASE}/")
        expect(p.get_by_text("Send sample request form")).to_be_visible()
    step("sales logs a task; it appears on the dashboard", log_task)

    def move_stage():
        p.goto(state["client_url"])
        form = p.locator("form:has(select[name=status])").first
        form.locator("select[name=status]").select_option("offer")
        form.locator("button[type=submit]").click()
        expect(p.locator("section:has-text('NK-P-0007')").get_by_text("Offer", exact=True).first).to_be_visible()
    step("sales moves the project to Offer", move_stage)
    p.context.close()

    # ------------------------------------------------------------ inventory
    print("Inventory and QC")
    adm = page_as("admin")

    def receive():
        adm.goto(f"{BASE}/inventory/receive")
        adm.select_option("select[name=item_id]", label="Vitamin C (L-ascorbic acid) · RM-VITC (kg)")
        adm.select_option("select[name=location_id]", label="Production facility – quarantine area")
        adm.fill("input[name=quantity]", "25")
        adm.fill("input[name=supplier_lot]", "VC-2001")
        adm.click("main button[type=submit]")
        expect(adm.get_by_text(re.compile(r"Received as lot LOT-\d{6} · in quarantine"))).to_be_visible()
        state["lot"] = re.search(r"LOT-\d{6}", adm.get_by_role("status").inner_text()).group(0)
    step("admin receives 25 kg Vitamin C into quarantine", receive)

    def release():
        adm.goto(f"{BASE}/qc")
        row = adm.locator(f"div:has(> div > span:has-text('{state['lot']}'))")
        row.locator("input[name=notes]").fill("COA matches spec")
        row.locator("button:has-text('Release')").click()
        expect(adm.get_by_text(state["lot"])).to_have_count(0)
        adm.goto(f"{BASE}/inventory?type=raw_material")
        adm.locator("summary:has-text('Vitamin C')").click()
        expect(adm.get_by_text(state["lot"])).to_be_visible()
    step("admin releases the lot; it shows as released stock", release)

    def low_flag_cleared():
        adm.goto(f"{BASE}/inventory?q=RM-VITC")
        expect(adm.locator("summary:has-text('Vitamin C')").get_by_text("OK", exact=True)).to_be_visible()
    step("Vitamin C is no longer below reorder level (33 kg vs 20)", low_flag_cleared)

    # ------------------------------------------------------------ production
    print("Production")
    par = page_as("production", "bg")

    def production_view():
        for path in ["/factory", "/factory/orders", "/factory/stock", "/factory/deliveries"]:
            par.goto(f"{BASE}{path}")
            body = par.content()
            for secret in ["Acme", "Nordic", "Vita Market"]:
                assert secret not in body, f"{path} leaks {secret}"
        par.goto(f"{BASE}/factory")
        expect(par.locator("h1")).to_have_text("Днес")
    step("production pages are in Bulgarian and show no client", production_view)

    def production_correction():
        par.goto(f"{BASE}/factory/stock")
        par.select_option("select[name=lot_location]", index=1)
        par.fill("input[name=counted]", "0.5")
        par.fill("input[name=reason]", "Преброяване в края на смяната")
        par.click("button:has-text('Запази корекцията')")
        expect(par.get_by_text(re.compile("Наличността е коригирана"))).to_be_visible()
        expect(par.get_by_text("Преброяване в края на смяната").first).to_be_visible()
    step("production corrects stock directly", production_correction)

    def production_blocked():
        par.goto(f"{BASE}/clients")
        assert par.url.endswith("/factory"), par.url
        par.goto(f"{BASE}/qc")
        assert par.url.endswith("/factory"), par.url
    step("production is sent back from staff pages (no QC release)", production_blocked)

    def admin_sees_correction():
        adm.goto(f"{BASE}/inventory/corrections")
        expect(adm.get_by_text("Преброяване в края на смяната").first).to_be_visible()
        assert "unread" in (adm.locator("a[href='/notifications']").first.get_attribute("aria-label") or "")
        adm.goto(f"{BASE}/notifications")
        expect(adm.get_by_text(re.compile("Stock corrected by production")).first).to_be_visible()
    step("admin sees the correction in the history and as a notification", admin_sees_correction)

    # --------------------------------------------------------------- language
    print("Language")

    def switch_language():
        lp = page_as("sales", "en")
        lp.context.clear_cookies(name="nk_locale")
        lp.goto(f"{BASE}/clients")
        lp.click("button[name=locale][value=en]")
        expect(lp.locator("h1")).to_have_text("Clients")
        lp.click("button[name=locale][value=bg]")
        expect(lp.locator("h1")).to_have_text("Клиенти")
        assert lp.locator("html").get_attribute("lang") == "bg"
        lp.reload()
        expect(lp.locator("h1")).to_have_text("Клиенти")
        lp.click("button[name=locale][value=en]")
        expect(lp.locator("h1")).to_have_text("Clients")
        lp.context.close()
    step("language switch EN → БГ → EN, kept after reload", switch_language)

    def locale_saved_per_user():
        lp = page_as("sales", "en")
        lp.context.clear_cookies(name="nk_locale")  # new device: no cookie
        lp.goto(f"{BASE}/clients")
        expect(lp.locator("h1")).to_have_text("Clients")  # profile default is BG; EN was saved by the previous step
        lp.context.close()
    step("language is remembered on the user's profile", locale_saved_per_user)

    # ----------------------------------------------- no horizontal scrolling
    print("Layout (no sideways scrolling)")
    pages = {"admin": ["/", "/clients", state.get("client_url", "/clients").replace(BASE, ""), "/projects", "/inventory", "/inventory/receive", "/qc", "/clients/new",
                       "/deliveries", "/inventory/corrections", "/notifications"],
             "production": ["/factory", "/factory/orders", "/factory/stock", "/factory/deliveries", "/notifications"]}
    for width in (375, 768, 1024, 1440):
        def no_overflow(width=width):
            bad = []
            for role, paths in pages.items():
                for loc in ("bg", "en"):
                    pg = page_as(role, loc, width=width, height=900)
                    for path in paths:
                        pg.goto(f"{BASE}{path}")
                        for d in pg.locator("details").all():
                            d.evaluate("el => el.open = true")
                        sw, cw = pg.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
                        if sw > cw:
                            bad.append(f"{role}/{loc}{path} {sw}>{cw}")
                    pg.context.close()
            assert not bad, "; ".join(bad)
        step(f"no horizontal overflow at {width}px (all pages, both languages)", no_overflow)

    # ------------------------------------------------------------ screenshots
    for name, role, loc, path, w in [
        ("dashboard-bg", "admin", "bg", "/", 1440),
        ("client-en", "sales", "en", state.get("client_url", "/clients").replace(BASE, ""), 1440),
        ("inventory-bg", "admin", "bg", "/inventory?type=raw_material", 1440),
        ("production-bg", "production", "bg", "/factory", 1440),
        ("inventory-phone-bg", "admin", "bg", "/inventory", 390),
    ]:
        pg = page_as(role, loc, width=w, height=900)
        pg.goto(f"{BASE}{path}")
        if "inventory" in name:
            pg.locator("summary").first.click()
        pg.wait_for_timeout(600)
        pg.screenshot(path=f"{SHOTS}/{name}.png", full_page=True)
        pg.context.close()

    browser.close()

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
