// Sample data for the local demo. Everything is written through the same
// tables and functions the app uses, as the user who would do it, so the
// data obeys every rule (codes, lot numbers, QC, stock checks).
import type { PGlite } from "@electric-sql/pglite";
import { DEMO_USERS } from "./demo-users";

const byRole = (role: string) => DEMO_USERS.find((u) => u.role === role)!.id;
const [ADMIN, SALES, PRODUCTION] = [byRole("admin"), byRole("sales"), byRole("production")];

export async function seedDemo(db: PGlite) {
  // Users (as database owner, like Supabase Auth + an admin creating profiles)
  for (const u of DEMO_USERS) {
    await db.query("insert into auth.users (id) values ($1)", [u.id]);
    await db.query(
      "insert into public.profiles (id, full_name, email, role, locale) values ($1, $2, $3, $4, 'bg')",
      [u.id, u.name, `${u.role}@nutrikal.demo`, u.role],
    );
  }

  async function as<T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) {
    return db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
      await tx.exec("set local role authenticated");
      return (await tx.query<T>(sql, params)).rows;
    });
  }
  const one = async (user: string, sql: string, params: unknown[] = []) =>
    (await as<{ id: string }>(user, sql, params))[0].id;
  const loc = async (code: string) =>
    (await db.query<{ id: string }>("select id from public.locations where code = $1", [code])).rows[0].id;

  await as(ADMIN, `update company_settings set legal_name = 'Nutrikal', email = 'sales@nutrikal.com',
                   default_deposit_pct = 50 where id`);

  // ---------------------------------------------------------------- CRM
  const acme = await one(SALES, `insert into clients (legal_name, status, country_code, vat_number, company_id, city, address_line1, postal_code,
                                   billing_email, deposit_pct, balance_terms, credit_limit, owner_id, preferred_locale)
                                 values ('Acme Wellness GmbH', 'active', 'DE', 'DE123456789', 'HRB 204511', 'Berlin', 'Hauptstraße 12', '10115',
                                   'accounts@acme-wellness.de', 50, 'before_dispatch', 20000, $1, 'en') returning id`, [SALES]);
  const nordic = await one(SALES, `insert into clients (legal_name, status, country_code, vat_number, city, owner_id, preferred_locale)
                                   values ('Nordic Labs AB', 'active', 'SE', 'SE556677889901', 'Malmö', $1, 'en') returning id`, [SALES]);
  const vita = await one(SALES, `insert into clients (legal_name, status, country_code, vat_number, city, owner_id, preferred_locale, deposit_pct)
                                 values ('Vita Market SRL', 'active', 'RO', 'RO40123456', 'Cluj-Napoca', $1, 'en', 30) returning id`, [SALES]);
  const balkan = await one(SALES, `insert into clients (legal_name, status, country_code, vat_number, company_id, city, owner_id, preferred_locale)
                                   values ('Балкан Фарма ООД', 'lead', 'BG', 'BG204567891', '204567891', 'Пловдив', $1, 'bg') returning id`, [SALES]);

  const anna = await one(SALES, `insert into contacts (client_id, first_name, last_name, position, email, is_primary)
                                 values ($1, 'Anna', 'Keller', 'Head of Product', 'anna@acme-wellness.de', true) returning id`, [acme]);
  await as(SALES, `insert into contacts (client_id, first_name, last_name, position, phone)
                   values ($1, 'Jonas', 'Braun', 'Purchasing', '+49 30 555 0142')`, [acme]);
  await as(SALES, `insert into contacts (client_id, first_name, last_name, position, email, is_primary)
                   values ($1, 'Erik', 'Lindqvist', 'CEO', 'erik@nordiclabs.se', true)`, [nordic]);
  await as(SALES, `insert into contacts (client_id, first_name, last_name, position, email, is_primary)
                   values ($1, 'Ioana', 'Pop', 'Category manager', 'ioana@vitamarket.ro', true)`, [vita]);
  await as(SALES, `insert into contacts (client_id, first_name, last_name, position, phone, is_primary, locale)
                   values ($1, 'Георги', 'Иванов', 'Управител', '+359 88 812 3456', true, 'bg')`, [balkan]);

  const pMag = await one(SALES, `insert into projects (client_id, name, product_format, status, owner_id, expected_units, target_date, nda_signed)
                                 values ($1, 'Magnesium Sleep · 60 caps', 'capsule', 'order', $2, 12000, current_date + 21, true) returning id`, [acme, SALES]);
  await as(SALES, `insert into projects (client_id, name, product_format, status, owner_id, expected_units)
                   values ($1, 'Vitamin D3 + K2 · 30 ml drops', 'liquid', 'offer', $2, 5000)`, [acme, SALES]);
  const pCol = await one(SALES, `insert into projects (client_id, name, product_format, status, owner_id, expected_units, target_date)
                                 values ($1, 'Collagen + Vitamin C · 300 g', 'powder', 'production', $2, 1500, current_date + 4) returning id`, [nordic, SALES]);
  const pAsh = await one(SALES, `insert into projects (client_id, name, product_format, status, owner_id, expected_units, target_date)
                                 values ($1, 'Ashwagandha · 90 caps', 'capsule', 'order', $2, 8000, current_date + 30) returning id`, [vita, SALES]);
  await as(SALES, `insert into projects (client_id, name, product_format, status, owner_id, expected_units)
                   values ($1, 'Цинк + Селен · 60 таблетки', 'tablet', 'inquiry', $2, 20000)`, [balkan, SALES]);
  await as(SALES, `insert into projects (client_id, name, product_format, status, owner_id)
                   values ($1, 'Omega-3 + Vitamin E · softgels', 'softgel', 'formulation', $2)`, [nordic, SALES]);

  await as(SALES, `insert into activities (client_id, project_id, contact_id, type, subject, body, created_at)
                   values ($1, $2, $3, 'call', 'Call with Anna Keller', 'Confirmed label text; artwork due Wednesday', now() - interval '3 days')`, [acme, pMag, anna]);
  await as(SALES, `insert into activities (client_id, project_id, type, subject, body, created_at)
                   values ($1, $2, 'email', 'Deposit received', '50% deposit paid for the first batch', now() - interval '10 days')`, [acme, pMag]);
  await as(SALES, `insert into activities (client_id, type, subject, due_at, assigned_to)
                   values ($1, 'task', 'Send label proofs for approval', now() + interval '1 day', $2)`, [acme, SALES]);
  await as(SALES, `insert into activities (client_id, type, subject, due_at, assigned_to)
                   values ($1, 'task', 'Follow up on softgel formula', now(), $2)`, [nordic, SALES]);
  await as(SALES, `insert into activities (client_id, type, subject, body, due_at, assigned_to)
                   values ($1, 'task', 'Изпрати оферта за цинк + селен', 'Три количества: 10 000 / 20 000 / 50 000', now() + interval '2 days', $2)`, [balkan, SALES]);

  // ------------------------------------------------------- items, suppliers
  const item = (sku: string, type: string, name: string, nameBg: string, unit: string, extra = "") =>
    one(ADMIN, `insert into items (sku, type, name, name_bg, base_unit ${extra ? ", " + extra.split("=")[0] : ""})
                    values ($1, $2, $3, $4, $5 ${extra ? ", " + extra.split("=")[1] : ""}) returning id`, [sku, type, name, nameBg, unit]);

  const raw = (sku: string, name: string, nameBg: string, shelf: number, reorder: number) =>
    one(ADMIN, `insert into items (sku, type, name, name_bg, base_unit, novel_food_status, shelf_life_months, reorder_level, storage_conditions)
                    values ($1, 'raw_material', $2, $3, 'kg', 'not_novel', $4, $5, 'Dry, below 25 °C') returning id`, [sku, name, nameBg, shelf, reorder]);

  const mg = await raw("RM-MGBG", "Magnesium bisglycinate", "Магнезиев бисглицинат", 24, 20);
  const the = await raw("RM-LTHE", "L-theanine", "L-теанин", 36, 2);
  const vitc = await raw("RM-VITC", "Vitamin C (L-ascorbic acid)", "Витамин C (L-аскорбинова киселина)", 36, 20);
  const zn = await raw("RM-ZNBG", "Zinc bisglycinate", "Цинков бисглицинат", 24, 5);
  const ash = await raw("RM-ASHW", "Ashwagandha root extract", "Ашваганда, екстракт от корен", 36, 10);
  const col = await raw("RM-COLB", "Collagen peptides (bovine)", "Колагенови пептиди (говежди)", 36, 100);
  const mcc = await one(ADMIN, `insert into items (sku, type, name, name_bg, base_unit, novel_food_status, excipient_function, shelf_life_months)
                                    values ('EX-MCC', 'excipient', 'Microcrystalline cellulose', 'Микрокристална целулоза', 'kg', 'not_novel', 'Filler', 60) returning id`);
  await one(ADMIN, `insert into items (sku, type, name, name_bg, base_unit, novel_food_status, excipient_function, shelf_life_months)
                        values ('EX-MGST', 'excipient', 'Magnesium stearate (vegetable)', 'Магнезиев стеарат (растителен)', 'kg', 'not_novel', 'Flow agent', 36) returning id`);
  const caps = await item("PK-HPMC0", "packaging", "HPMC capsules size 0", "HPMC капсули размер 0", "pcs", "reorder_level, material, capacity, capacity_unit=100000, 'HPMC', 500, 'mg'");
  const jar = await item("PK-JAR300", "packaging", "PET jar 300 ml + cap", "PET бурканче 300 ml + капачка", "pcs", "capacity, capacity_unit, material=300, 'ml', 'PET'");

  const sup = await one(ADMIN, `insert into suppliers (name, country_code, email, is_approved) values ('EuroIngredients GmbH', 'DE', 'orders@euroingredients.example', true) returning id`);
  const sup2 = await one(ADMIN, `insert into suppliers (name, country_code, is_approved) values ('CapsPack SRL', 'IT', true) returning id`);
  for (const [it, price, s] of [[mg, 18.5, sup], [the, 64, sup], [vitc, 9.8, sup], [zn, 21.4, sup], [ash, 38, sup], [col, 11.2, sup], [mcc, 3.1, sup], [caps, 0.0062, sup2], [jar, 0.21, sup2]] as const) {
    const si = await one(ADMIN, `insert into supplier_items (supplier_id, item_id, is_preferred, lead_time_days) values ($1, $2, true, 14) returning id`, [s, it]);
    await as(ADMIN, `insert into supplier_prices (supplier_item_id, price) values ($1, $2)`, [si, price]);
  }

  // ------------------------------------------------------------ stock
  const PF_QUAR = await loc("PF-QUAR"), PF_RM = await loc("PF-RM"), PF_PACK = await loc("PF-PACK");

  async function receiveRelease(user: string, itemId: string, qty: number, toLoc: string, supplierLot: string, mfgDaysAgo: number, expires?: string) {
    const lot = (await as<{ id: string }>(user, `select receive_lot($1, $2, $3, $4, $5, current_date - $6::int, $7::date) as id`,
      [itemId, PF_QUAR, qty, sup, supplierLot, mfgDaysAgo, expires ?? null]))[0].id;
    await as(ADMIN, `select set_lot_qc_status($1, 'released', 'COA checked against specification')`, [lot]);
    await as(PRODUCTION, `select transfer_stock($1, $2, $3, $4)`, [lot, PF_QUAR, toLoc, qty]);
    return lot;
  }

  const lotMg = await receiveRelease(PRODUCTION, mg, 68, PF_RM, "SUP-778", 30);
  await receiveRelease(PRODUCTION, the, 4.8, PF_RM, "TH-2291", 60);
  await receiveRelease(ADMIN, vitc, 8, PF_RM, "VC-1180", 200);
  await receiveRelease(ADMIN, zn, 6.2, PF_RM, "ZN-0442", 690, new Date(Date.now() + 41 * 864e5).toISOString().slice(0, 10));
  await receiveRelease(ADMIN, ash, 42, PF_RM, "ASH-907", 45);
  const lotCol = await receiveRelease(ADMIN, col, 520, PF_RM, "COL-5531", 20);
  await receiveRelease(ADMIN, mcc, 25, PF_RM, "MCC-310", 100);
  await receiveRelease(ADMIN, caps, 60000, PF_PACK, "CP-88120", 40);
  await receiveRelease(ADMIN, jar, 1600, PF_PACK, "JR-3001", 25);

  // A new delivery waiting for QC
  await as(PRODUCTION, `select receive_lot($1, $2, 100, $3, 'SUP-802', current_date - 5)`, [mg, PF_QUAR, sup]);

  // Production running for Nordic Labs: collagen consumed
  await as(PRODUCTION, `select post_stock_movement('consumption', $1, $2, 70, null, $3, 'MO-00031')`, [lotCol, PF_RM, pCol]);

  // Reservations for upcoming batches
  await as(SALES, `select reserve_stock($1, $2, 60, null, null, 'First batch')`, [mg, pMag]);
  await as(ADMIN, `select reserve_stock($1, $2, 36)`, [ash, pAsh]);
  await as(ADMIN, `select reserve_stock($1, $2, 450, null, null, 'Rest of the running batch')`, [col, pCol]);

  // ------------------------------------------------------- formulation
  for (const [it, code, pct] of [[mg, "magnesium", 14], [vitc, "vit_c", 100], [zn, "zinc", 20]] as const) {
    await as(ADMIN, `insert into item_nutrients (item_id, nutrient_id, content_pct)
                         select $1, id, $3 from nutrients where code = $2`, [it, code, pct]);
  }
  // Demo claims. Check the wording against the EU Register before real use.
  const claim = (nutrient: string, en: string, bgText: string) =>
    one(ADMIN, `insert into health_claims (nutrient_id, claim_en, claim_bg, register_ref)
                select id, $2, $3, 'Reg. (EU) 432/2012' from nutrients where code = $1 returning id`, [nutrient, en, bgText]);
  const clMg = await claim("magnesium", "Magnesium contributes to a reduction of tiredness and fatigue", "Магнезият допринася за намаляване на умората и отпадналостта");
  const clC = await claim("vit_c", "Vitamin C contributes to the normal function of the immune system", "Витамин C допринася за нормалното функциониране на имунната система");
  await claim("zinc", "Zinc contributes to the normal function of the immune system", "Цинкът допринася за нормалното функциониране на имунната система");

  const formula = async (sql: string, params: unknown[], lines: [string, number, string, number][], shelf: number | null, claims: string[], packaging: string[] = []) => {
    const f = await one(SALES, sql, params);
    const v = await one(SALES, "select id from formula_versions where formula_id = $1 and version = 1", [f]);
    for (const [it, amount, unit, overage] of lines) {
      await as(SALES, `insert into formula_lines (version_id, item_id, amount, unit, overage_pct, sort_order)
                       values ($1, $2, $3, $4::dose_unit, $5, (select count(*) from formula_lines where version_id = $1))`, [v, it, amount, unit, overage]);
    }
    for (const c of claims) await as(SALES, "insert into formula_version_claims (version_id, claim_id) values ($1, $2)", [v, c]);
    for (const pk of packaging) await as(SALES, "insert into formula_packaging (version_id, item_id) values ($1, $2)", [v, pk]);
    if (shelf) await as(SALES, "update formula_versions set shelf_life_months = $2 where id = $1", [v, shelf]);
    return { f, v };
  };

  const label = await item("PK-LBL", "packaging", "Self-adhesive label", "Самозалепващ етикет", "pcs");
  const fMag = await formula(
    `insert into formulas (name, name_bg, product_format, project_id, serving_size, servings_per_pack, shell_item_id)
     values ('Magnesium Sleep', 'Магнезий за сън', 'capsule', $1, 2, 30, $2) returning id`, [pMag, caps],
    [[mg, 750, "mg", 0], [the, 100, "mg", 5], [mcc, 40, "mg", 0]], 24, [clMg], [jar, label]);
  await as(ADMIN, "select approve_formula_version($1)", [fMag.v]);
  const v2 = await one(SALES, "select new_formula_version($1, 'More L-theanine after client feedback') as id", [fMag.f]);
  await as(SALES, "update formula_lines set amount = 150 where version_id = $1 and item_id = $2", [v2, the]);

  const fCol = await formula(
    `insert into formulas (name, name_bg, product_format, project_id, serving_size, serving_unit, servings_per_pack)
     values ('Collagen + Vitamin C', 'Колаген + витамин C', 'powder', $1, 10, 'g', 30) returning id`, [pCol],
    [[col, 9.5, "g", 0], [vitc, 80, "mg", 10]], 24, [clC], [jar]);
  await as(ADMIN, "select approve_formula_version($1)", [fCol.v]);

  await formula(
    `insert into formulas (name, name_bg, product_format, serving_size, servings_per_pack, shell_item_id)
     values ('Immune Support', 'Имунна подкрепа', 'capsule', 2, 30, $1) returning id`, [caps],
    [[vitc, 200, "mg", 5], [zn, 50, "mg", 0], [mcc, 150, "mg", 0]], null, []);

  // ----------------------------------------------------------- offers
  await as(ADMIN, `update format_costing set fee_per_pack = 0.18, fee_per_1000_units = 2.4, setup_fee = 350, loss_pct = 3,
                     default_margin_pct = 35, min_order_packs = 1000 where product_format = 'capsule'`);
  await as(ADMIN, `update format_costing set fee_per_pack = 0.35, fee_per_kg = 1.6, setup_fee = 250, loss_pct = 2,
                     default_margin_pct = 32, min_order_packs = 500 where product_format = 'powder'`);
  const siLabel = await one(ADMIN, `insert into supplier_items (supplier_id, item_id, is_preferred, lead_time_days) values ($1, $2, true, 10) returning id`, [sup2, label]);
  await as(ADMIN, `insert into supplier_prices (supplier_item_id, price) values ($1, 0.035)`, [siLabel]);

  const ofMag = await one(SALES, `insert into offers (client_id, project_id, formula_version_id, notes)
                                  values ($1, $2, $3, 'Artwork and label text supplied by the client.') returning id`, [acme, pMag, fMag.v]);
  await as(SALES, `insert into offer_tiers (offer_id, quantity) values ($1, 5000), ($1, 10000), ($1, 20000)`, [ofMag]);
  await as(SALES, `update offers set status = 'sent' where id = $1`, [ofMag]);

  const ofCol = await one(SALES, `insert into offers (client_id, project_id, formula_version_id) values ($1, $2, $3) returning id`, [nordic, pCol, fCol.v]);
  await as(SALES, `insert into offer_packaging (offer_id, item_id) values ($1, $2)`, [ofCol, label]);
  await as(SALES, `insert into offer_tiers (offer_id, quantity) values ($1, 1500), ($1, 3000)`, [ofCol]);
  await as(SALES, `insert into offer_tiers (offer_id, quantity, unit_price, price_is_manual) values ($1, 5000, 6.90, true)`, [ofCol]);

  // ------------------------------------------------------- sales orders
  const soMag = await one(SALES, `select create_order_from_offer($1, 10000, 'ACME-PO-2291', current_date + 21) as id`, [ofMag]);
  await as(SALES, `update sales_orders set status = 'confirmed', deposit_received_on = current_date - 2 where id = $1`, [soMag]);
  const soMagLine = (await as<{ id: string }>(SALES, "select id from sales_order_lines where order_id = $1", [soMag]))[0].id;

  // ------------------------------------------------------- production
  // Acme: materials partly missing, purchase requests raised (scheduled below)
  const moMag = await one(ADMIN, `insert into manufacturing_orders (sales_order_line_id, quantity) values ($1, 10000) returning id`, [soMagLine]);

  // Nordic Labs: next collagen batch, all materials reserved and sent to production
  for (const r of await as<{ id: string }>(ADMIN, `select id from stock_reservations where project_id = $1 and status = 'active'`, [pCol])) {
    await as(ADMIN, `select close_reservation($1, 'released')`, [r.id]);
  }
  const moCol = await one(ADMIN, `insert into manufacturing_orders (formula_version_id, project_id, quantity, notes)
                                      values ($1, $2, 1000, 'Second batch') returning id`, [fCol.v, pCol]);
  await as(ADMIN, `select schedule_mo($1, current_date + 3)`, [moCol]);
  await as(ADMIN, `select release_mo($1)`, [moCol]);

  // Acme is scheduled after the collagen batch took its jars
  await as(ADMIN, `select schedule_mo($1, current_date + 10)`, [moMag]);
  await as(ADMIN, `select create_purchase_requests($1)`, [moMag]);

  // Production reports a spill and corrects the stock directly
  await as(PRODUCTION, `select count_stock($1, $2, (select sum(quantity) from stock_movements where lot_id = $1 and location_id = $2) - 2, 'Spillage during weighing')`, [lotMg, PF_RM]);

  // Expected deliveries: one overdue, one partly received, one ordered from a purchase request
  await as(ADMIN, `select create_expected_delivery($1, 50, $2, current_date - 3, 9.8, 'EU-55120', $3)`, [vitc, sup, PF_QUAR]);
  const edCaps = await one(ADMIN, `select create_expected_delivery($1, 100000, $2, current_date + 5, 0.0058, 'CP-2291', $3) as id`, [caps, sup2, PF_QUAR]);
  // The demo has no photo files, so this one receipt skips the waybill-photo rule
  await db.query("update company_settings set require_waybill_photo = false");
  await as(ADMIN, `select receive_expected_delivery($1, $2, 40000, 'CP-90211', current_date - 30)`, [edCaps, PF_QUAR]);
  await db.query("update company_settings set require_waybill_photo = true");
  const [pr] = await as<{ id: string }>(ADMIN, `select id from purchase_requests where manufacturing_order_id = $1 and status = 'open' order by code limit 1`, [moMag]);
  if (pr) await as(ADMIN, `select create_expected_delivery(null, null, $2, current_date + 12, null, 'EU-55187', $3, $1)`, [pr.id, sup, PF_QUAR]);
}
