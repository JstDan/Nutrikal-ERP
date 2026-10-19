// Runs the Phase 1 migrations on an embedded Postgres (PGlite) with
// Supabase auth stubs, then checks the business and access rules per role.
// Usage: node run-tests.mjs
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migDir = join(here, '..', 'supabase', 'migrations');

const db = await PGlite.create({ extensions: { citext, pgcrypto } });

// --- Supabase stubs: auth schema, auth.uid(), roles, default grants ---
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);

const files = readdirSync(migDir).filter(f => f.endsWith('.sql') && !f.includes('storage')).sort();
for (const f of files) {
  try {
    await db.exec(readFileSync(join(migDir, f), 'utf8'));
    console.log(`migrated  ${f}`);
  } catch (e) {
    console.error(`FAILED    ${f}\n${e.message}`);
    process.exit(1);
  }
}

// --- helpers ---
const U = {
  admin:     '00000000-0000-0000-0000-00000000000a',
  sales:     '00000000-0000-0000-0000-00000000000b',
  inventory: '00000000-0000-0000-0000-00000000000c',
  partner:   '00000000-0000-0000-0000-00000000000d',
};
for (const [role, id] of Object.entries(U)) {
  await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query(
    'insert into public.profiles (id, full_name, email, role) values ($1, $2, $3, $4)',
    [id, `Test ${role}`, `${role}@nutrikal.test`, role]);
}

async function as(user, sql, params = []) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [U[user]]);
  await db.exec('set role authenticated');
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}
const one = async (user, sql, params) => (await as(user, sql, params))[0];

let passed = 0, failed = 0;
async function ok(name, fn) {
  try { await fn(); passed++; console.log(`  pass  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}
async function fails(name, fn, pattern) {
  try { await fn(); failed++; console.log(`  FAIL  ${name} (expected an error)`); }
  catch (e) {
    if (pattern && !new RegExp(pattern, 'i').test(e.message)) {
      failed++; console.log(`  FAIL  ${name}: wrong error: ${e.message}`);
    } else { passed++; console.log(`  pass  ${name}  [${e.message.split('\n')[0]}]`); }
  }
}
function eq(actual, expected, what) {
  if (String(actual) !== String(expected)) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}
const L = Object.fromEntries((await db.query('select code, id from public.locations')).rows.map(r => [r.code, r.id]));

console.log('\nCRM');
let client, project;
await ok('sales creates a client with an auto code', async () => {
  client = await one('sales', `insert into clients (legal_name, country_code, vat_number, owner_id)
                               values ('Acme Wellness GmbH', 'DE', 'de 123.456.789', $1) returning id, code, vat_number`, [U.sales]);
  eq(client.code, 'NK-C-0001', 'client code');
  eq(client.vat_number, 'DE123456789', 'normalised VAT');
});
await ok('sales creates a project with an auto code', async () => {
  project = await one('sales', `insert into projects (client_id, name, product_format)
                                values ($1, 'Magnesium Sleep 60 caps', 'capsule') returning id, code`, [client.id]);
  eq(project.code, 'NK-P-0001', 'project code');
});
await ok('sales adds a contact and a call note', async () => {
  const c = await one('sales', `insert into contacts (client_id, first_name, email, is_primary)
                                values ($1, 'Anna', 'anna@acme.test', true) returning id`, [client.id]);
  await as('sales', `insert into activities (client_id, project_id, contact_id, type, subject)
                     values ($1, $2, $3, 'call', 'Intro call')`, [client.id, project.id, c.id]);
});
await fails('inventory cannot create clients', () =>
  as('inventory', `insert into clients (legal_name) values ('X Ltd')`), 'row-level security');
await ok('inventory can read clients (which client a batch is for)', async () => {
  eq((await as('inventory', 'select id from clients')).length, 1, 'clients visible');
});
await ok('partner sees no clients and no projects table rows', async () => {
  eq((await as('partner', 'select id from clients')).length, 0, 'clients');
  eq((await as('partner', 'select id from projects')).length, 0, 'projects');
});
await ok('partner sees the project by code only', async () => {
  const rows = await as('partner', 'select * from partner_projects');
  eq(rows.length, 1, 'partner projects');
  eq(rows[0].code, 'NK-P-0001', 'code');
  eq(Object.keys(rows[0]).includes('client_id'), false, 'no client column');
});

console.log('\nItems, suppliers, prices');
let item, supplierItem;
await ok('inventory creates a raw material', async () => {
  item = await one('inventory', `insert into items (sku, type, name, name_bg, base_unit, novel_food_status, shelf_life_months, reorder_level)
                                 values ('RM-MGBG', 'raw_material', 'Magnesium bisglycinate', 'Магнезиев бисглицинат', 'kg', 'not_novel', 24, 20)
                                 returning id`);
});
await fails('raw material without Novel Food status is refused', () =>
  as('inventory', `insert into items (sku, type, name, base_unit) values ('RM-X', 'raw_material', 'X', 'kg')`), 'novel_food');
await ok('inventory adds a supplier, supplier item and price', async () => {
  const s = await one('inventory', `insert into suppliers (name, country_code) values ('Ingredient Co', 'DE') returning id`);
  supplierItem = await one('inventory', `insert into supplier_items (supplier_id, item_id, moq, is_preferred)
                                         values ($1, $2, 25, true) returning id`, [s.id, item.id]);
  await as('inventory', `insert into supplier_prices (supplier_item_id, price) values ($1, 18.50)`, [supplierItem.id]);
});
await ok('sales cannot see purchase prices by default', async () => {
  eq((await as('sales', 'select * from current_supplier_prices')).length, 0, 'prices for sales');
});
await ok('inventory sees the current price', async () => {
  eq((await one('inventory', 'select price from current_supplier_prices')).price, '18.5000', 'price');
});
await ok('a sales user with the price flag can see prices', async () => {
  await db.query('update profiles set can_see_purchase_prices = true where id = $1', [U.sales]);
  eq((await as('sales', 'select * from current_supplier_prices')).length, 1, 'prices');
  await db.query('update profiles set can_see_purchase_prices = false where id = $1', [U.sales]);
});
await ok('partner sees items but no prices or suppliers', async () => {
  eq((await as('partner', 'select id from items')).length, 1, 'items');
  eq((await as('partner', 'select * from supplier_prices')).length, 0, 'prices');
  eq((await as('partner', 'select * from suppliers')).length, 0, 'suppliers');
});

console.log('\nReceiving, QC and stock');
let lot;
await ok('partner receives a lot into quarantine at the partner facility', async () => {
  const r = await one('partner', `select receive_lot($1, $2, 100, null, 'SUP-778', current_date - 30) as id`,
                      [item.id, L['PF-QUAR']]);
  lot = (await db.query('select * from lots where id = $1', [r.id])).rows[0];
  eq(lot.lot_number, 'LOT-000001', 'lot number');
  eq(lot.qc_status, 'quarantine', 'status');
});
await ok('expiry is calculated from the 24-month shelf life', async () => {
  const r = await one('admin', `select expires_on = (manufactured_on + interval '24 months')::date as ok from lots where id = $1`, [lot.id]);
  eq(r.ok, true, 'expiry');
});
await fails('partner cannot receive into the Nutrikal warehouse', () =>
  as('partner', 'select receive_lot($1, $2, 5)', [item.id, L['NK-WH']]), 'partner locations');
await ok('transfer quarantine → raw materials store', async () => {
  await as('partner', 'select transfer_stock($1, $2, $3, 100)', [lot.id, L['PF-QUAR'], L['PF-RM']]);
});
await fails('consumption of an unreleased lot is blocked', () =>
  as('partner', `select post_stock_movement('consumption', $1, $2, 10)`, [lot.id, L['PF-RM']]), 'not released');
await fails('inventory cannot release a lot (Admin only)', () =>
  as('inventory', `select set_lot_qc_status($1, 'released')`, [lot.id]), 'not allowed');
await ok('admin releases the lot; decision is recorded', async () => {
  await as('admin', `select set_lot_qc_status($1, 'released', 'COA checked')`, [lot.id]);
  const l = (await db.query('select qc_status, qc_decided_by from lots where id = $1', [lot.id])).rows[0];
  eq(l.qc_status, 'released', 'status'); eq(l.qc_decided_by, U.admin, 'decided by');
});
await ok('partner consumes 30 kg in production', async () => {
  await as('partner', `select post_stock_movement('consumption', $1, $2, 30, null, $3, 'MO-TEST')`,
           [lot.id, L['PF-RM'], project.id]);
});
await fails('negative stock is refused', () =>
  as('partner', `select post_stock_movement('consumption', $1, $2, 80)`, [lot.id, L['PF-RM']]), 'insufficient');
await fails('partner cannot post adjustments directly', () =>
  as('partner', `select post_stock_movement('adjustment', $1, $2, -2, 'spill')`, [lot.id, L['PF-RM']]), 'request_stock_adjustment');
await ok('partner requests an adjustment; inventory approves it', async () => {
  const r = await one('partner', `select request_stock_adjustment($1, $2, -2, 'Spillage during weighing') as id`,
                      [lot.id, L['PF-RM']]);
  const m = await one('inventory', 'select decide_stock_adjustment($1, true) as movement', [r.id]);
  if (!m.movement) throw new Error('no movement posted');
});
await fails('direct writes to the ledger are refused', () =>
  as('inventory', `insert into stock_movements (type, lot_id, location_id, quantity) values ('receipt', $1, $2, 5)`,
     [lot.id, L['PF-RM']]), 'row-level security');
await fails('ledger rows cannot be edited, even by the database owner', () =>
  db.query('update stock_movements set quantity = 1000'), 'cannot be changed');
await fails('sales cannot post stock movements', () =>
  as('sales', `select post_stock_movement('waste', $1, $2, 1)`, [lot.id, L['PF-RM']]), 'not allowed');

console.log('\nReservations and availability');
await ok('sales reserves 60 kg for the project', async () => {
  await as('sales', 'select reserve_stock($1, $2, 60)', [item.id, project.id]);
});
await fails('over-reservation is refused (68 usable, 60 reserved)', () =>
  as('sales', 'select reserve_stock($1, $2, 20)', [item.id, project.id]), 'only 8');
await ok('stock summary: 68 on hand, 60 reserved, 8 available, below reorder level 20', async () => {
  const s = await one('inventory', 'select * from item_stock_summary where item_id = $1', [item.id]);
  eq(Number(s.on_hand), 68, 'on hand'); eq(Number(s.reserved), 60, 'reserved');
  eq(Number(s.available), 8, 'available'); eq(s.below_reorder_level, true, 'reorder flag');
});

console.log('\nExpiry and partner visibility');
let oldLot;
await ok('inventory receives an already-expired lot into the Nutrikal warehouse', async () => {
  const r = await one('inventory', `select receive_lot($1, $2, 10, null, 'OLD-1', current_date - 800, current_date - 1) as id`,
                      [item.id, L['NK-WH']]);
  oldLot = r.id;
  await as('admin', `select set_lot_qc_status($1, 'released')`, [oldLot]);
});
await fails('consumption of an expired lot is blocked', () =>
  as('inventory', `select post_stock_movement('consumption', $1, $2, 1)`, [oldLot, L['NK-WH']]), 'expired');
await ok('expired lot shows in expiring_lots; not counted as usable', async () => {
  eq((await as('inventory', 'select * from expiring_lots where lot_id = $1', [oldLot])).length, 1, 'expiring');
  const s = await one('inventory', 'select usable from item_stock_summary where item_id = $1', [item.id]);
  eq(Number(s.usable), 68, 'usable unchanged');
});
await ok('partner sees only partner lots and locations', async () => {
  eq((await as('partner', 'select id from lots')).length, 1, 'lots');
  eq((await as('partner', 'select code from locations')).length, 5, 'locations');
  eq((await as('partner', 'select * from stock_movements where location_id = $1', [L['NK-WH']])).length, 0, 'warehouse moves');
});

console.log('\nFormulation');
let formula, v1, v2, mcc, novelPending, novelBlocked, caps, magnesium, claim;
await ok('inventory sets up an excipient, two Novel Food cases and a capsule shell', async () => {
  mcc = await one('inventory', `insert into items (sku, type, name, base_unit, novel_food_status, shelf_life_months, is_vegan)
                                values ('EX-MCC', 'excipient', 'Microcrystalline cellulose', 'kg', 'not_novel', 60, true) returning id`);
  novelPending = await one('inventory', `insert into items (sku, type, name, base_unit, novel_food_status, shelf_life_months)
                                         values ('RM-NEW', 'raw_material', 'New extract', 'kg', 'pending', 12) returning id`);
  novelBlocked = await one('inventory', `insert into items (sku, type, name, base_unit, novel_food_status, allergens)
                                         values ('RM-BAN', 'raw_material', 'Unauthorised extract', 'kg', 'not_authorised', '{soybeans}') returning id`);
  caps = await one('inventory', `insert into items (sku, type, name, base_unit, capacity, capacity_unit)
                                 values ('PK-CAP0', 'packaging', 'HPMC capsule size 0', 'pcs', 500, 'mg') returning id`);
});
await ok('sales creates a formula for the project: code, client and version 1 draft are set', async () => {
  formula = await one('sales', `insert into formulas (name, product_format, project_id, serving_size, servings_per_pack, shell_item_id)
                                values ('Magnesium Sleep', 'capsule', $1, 2, 30, $2) returning id, code, client_id`, [project.id, caps.id]);
  eq(formula.code, 'NK-F-0001', 'formula code');
  eq(formula.client_id, client.id, 'client from project');
  v1 = await one('sales', `select id, version, status from formula_versions where formula_id = $1`, [formula.id]);
  eq(v1.version, 1, 'version'); eq(v1.status, 'draft', 'status');
});
await fails('inventory cannot create formulas', () =>
  as('inventory', `insert into formulas (name, product_format, serving_size) values ('X', 'capsule', 1)`), 'row-level security');
await ok('sales adds ingredients per serving', async () => {
  await as('sales', `insert into formula_lines (version_id, item_id, amount, overage_pct, sort_order) values
                       ($1, $2, 750, 0, 1), ($1, $3, 140, 5, 2)`, [v1.id, item.id, mcc.id]);
});
await fails('packaging cannot be an ingredient', () =>
  as('sales', `insert into formula_lines (version_id, item_id, amount) values ($1, $2, 1)`, [v1.id, caps.id]), 'only raw materials');
await ok('admin records the magnesium content; label shows 105 mg = 28 % NRV', async () => {
  magnesium = await one('admin', `select id from nutrients where code = 'magnesium'`);
  await as('inventory', `insert into item_nutrients (item_id, nutrient_id, content_pct) values ($1, $2, 14)`, [item.id, magnesium.id]);
  const n = await one('sales', `select amount, pct_nrv from formula_version_nutrients where version_id = $1`, [v1.id]);
  eq(Number(n.amount), 105, 'magnesium mg'); eq(Number(n.pct_nrv), 28, '% NRV');
});
await ok('checks: fill per capsule includes overage; shell capacity is known', async () => {
  const c = await one('sales', `select line_count, fill_mg_per_unit, shell_capacity_mg, novel_to_review from formula_version_checks where version_id = $1`, [v1.id]);
  eq(c.line_count, 2, 'lines'); eq(Number(c.fill_mg_per_unit), 448.5, 'mg per capsule');
  eq(Number(c.shell_capacity_mg), 500, 'capacity'); eq(c.novel_to_review, 0, 'novel to review');
});
await ok('a met and an unmet health claim', async () => {
  claim = await one('admin', `insert into health_claims (nutrient_id, claim_en) values ($1, 'Magnesium contributes to a reduction of tiredness and fatigue') returning id`, [magnesium.id]);
  const vitC = await one('admin', `select id from nutrients where code = 'vit_c'`);
  const claimC = await one('admin', `insert into health_claims (nutrient_id, claim_en) values ($1, 'Vitamin C contributes to the normal function of the immune system') returning id`, [vitC.id]);
  await as('sales', `insert into formula_version_claims (version_id, claim_id) values ($1, $2), ($1, $3)`, [v1.id, claim.id, claimC.id]);
  const rows = await as('sales', `select claim_id, is_met from formula_version_claim_checks where version_id = $1`, [v1.id]);
  eq(rows.find(r => r.claim_id === claim.id).is_met, true, 'magnesium claim met');
  eq(rows.find(r => r.claim_id === claimC.id).is_met, false, 'vitamin C claim not met');
  await as('sales', `delete from formula_version_claims where version_id = $1 and claim_id = $2`, [v1.id, claimC.id]);
});
await fails('sales cannot approve', () => as('sales', 'select approve_formula_version($1)', [v1.id]), 'not allowed');
await fails('sales cannot approve by changing the status directly', () =>
  as('sales', `update formula_versions set status = 'approved' where id = $1`, [v1.id]), 'only admin');
await fails('approval without a shelf life is refused', () =>
  as('admin', 'select approve_formula_version($1)', [v1.id]), 'shelf life');
await ok('shelf life longer than an ingredient allows is flagged', async () => {
  await as('sales', `update formula_versions set shelf_life_months = 36 where id = $1`, [v1.id]);
  const c = await one('sales', `select shelf_life_exceeds_items, min_item_shelf_life from formula_version_checks where version_id = $1`, [v1.id]);
  eq(c.shelf_life_exceeds_items, true, 'flag'); eq(c.min_item_shelf_life, 24, 'shortest ingredient');
  await as('sales', `update formula_versions set shelf_life_months = 24 where id = $1`, [v1.id]);
});
await fails('approval with a not authorised Novel Food ingredient is refused', async () => {
  const l = await one('sales', `insert into formula_lines (version_id, item_id, amount) values ($1, $2, 10) returning id`, [v1.id, novelBlocked.id]);
  try { await as('admin', 'select approve_formula_version($1)', [v1.id]); }
  finally { await as('sales', 'delete from formula_lines where id = $1', [l.id]); }
}, 'not authorised novel food');
await ok('admin approves version 1; approver is recorded', async () => {
  await as('admin', 'select approve_formula_version($1)', [v1.id]);
  const v = await one('admin', 'select status, approved_by from formula_versions where id = $1', [v1.id]);
  eq(v.status, 'approved', 'status'); eq(v.approved_by, U.admin, 'approved by');
});
await fails('approved version: lines are locked', () =>
  as('admin', `insert into formula_lines (version_id, item_id, amount) values ($1, $2, 5)`, [v1.id, mcc.id]), 'only drafts');
await fails('approved version: locked even for the database owner', () =>
  db.query(`update formula_lines set amount = 1 where version_id = $1`, [v1.id]), 'only drafts');
await fails('approved version: shelf life cannot be changed', () =>
  as('admin', `update formula_versions set shelf_life_months = 12 where id = $1`, [v1.id]), 'locked');
await ok('new version copies lines and claims into a draft', async () => {
  v2 = await one('sales', `select new_formula_version($1, 'Add theanine') as id`, [formula.id]);
  v2 = { id: v2.id };
  const v = await one('sales', 'select version, status, shelf_life_months from formula_versions where id = $1', [v2.id]);
  eq(v.version, 2, 'version'); eq(v.status, 'draft', 'status'); eq(v.shelf_life_months, 24, 'shelf life copied');
  eq((await as('sales', 'select id from formula_lines where version_id = $1', [v2.id])).length, 2, 'lines copied');
  eq((await as('sales', 'select claim_id from formula_version_claims where version_id = $1', [v2.id])).length, 1, 'claims copied');
});
await fails('only one draft per formula', () => as('sales', 'select new_formula_version($1)', [formula.id]), 'already has a draft');
await ok('a pending Novel Food ingredient is flagged for review but does not block', async () => {
  await as('sales', `insert into formula_lines (version_id, item_id, amount) values ($1, $2, 50)`, [v2.id, novelPending.id]);
  eq((await one('sales', 'select novel_to_review from formula_version_checks where version_id = $1', [v2.id])).novel_to_review, 1, 'to review');
});
await ok('approving version 2 archives version 1', async () => {
  await as('sales', `update formula_versions set shelf_life_months = 12 where id = $1`, [v2.id]);
  await as('admin', 'select approve_formula_version($1)', [v2.id]);
  eq((await one('admin', 'select status from formula_versions where id = $1', [v1.id])).status, 'archived', 'v1');
  eq((await one('admin', 'select status from formula_versions where id = $1', [v2.id])).status, 'approved', 'v2');
});
await ok('inventory can read formulas and lines', async () => {
  eq((await as('inventory', 'select id from formulas')).length, 1, 'formulas');
  eq((await as('inventory', 'select id from formula_line_details where version_id = $1', [v2.id])).length, 3, 'lines');
});
await ok('partner sees no formulas, versions, lines, nutrients or claims', async () => {
  for (const t of ['formulas', 'formula_versions', 'formula_lines', 'formula_line_details', 'formula_version_checks',
                   'formula_version_nutrients', 'formula_version_claim_checks', 'item_nutrients', 'nutrients', 'health_claims']) {
    eq((await as('partner', `select * from ${t}`)).length, 0, t);
  }
});
await fails('partner cannot create a formula version', () => as('partner', 'select new_formula_version($1)', [formula.id]), 'not allowed');

console.log('\nCosting and offers');
let offer, client2, jar;
const tier = async (qty) => one('sales', 'select * from offer_tiers where offer_id = $1 and quantity = $2', [offer.id, qty]);
await ok('admin sets capsule production costs; sales cannot change them', async () => {
  await as('admin', `update format_costing set fee_per_pack = 0.10, fee_per_1000_units = 2, setup_fee = 300, loss_pct = 0,
                       default_margin_pct = 30 where product_format = 'capsule'`);
  await as('sales', `update format_costing set setup_fee = 1 where product_format = 'capsule'`);
  eq(Number((await one('admin', `select setup_fee from format_costing where product_format = 'capsule'`)).setup_fee), 300, 'setup fee');
});
await ok('inventory prices the ingredients, shells and a jar (with a price break for 100 kg magnesium)', async () => {
  const s = await one('inventory', `insert into suppliers (name) values ('Second supplier') returning id`);
  jar = await one('inventory', `insert into items (sku, type, name, base_unit) values ('PK-JAR', 'packaging', 'Jar 150 ml', 'pcs') returning id`);
  for (const [it, price] of [[mcc.id, 4], [novelPending.id, 100], [caps.id, 0.01], [jar.id, 0.25]]) {
    const si = await one('inventory', `insert into supplier_items (supplier_id, item_id, is_preferred) values ($1, $2, true) returning id`, [s.id, it]);
    await as('inventory', 'insert into supplier_prices (supplier_item_id, price) values ($1, $2)', [si.id, price]);
  }
  await as('inventory', 'insert into supplier_prices (supplier_item_id, price, min_quantity) values ($1, 16, 100)', [supplierItem.id]);
});
await fails('an offer needs an approved formula version', () =>
  as('sales', 'insert into offers (client_id, formula_version_id) values ($1, $2)', [client.id, v1.id]), 'approved formula version');
await fails("an offer cannot use another client's formula", async () => {
  client2 = await one('sales', `insert into clients (legal_name) values ('Other Client Ltd') returning id`);
  await as('sales', 'insert into offers (client_id, formula_version_id) values ($1, $2)', [client2.id, v2.id]);
}, 'another client');
await ok('sales creates an offer: code, language and validity are filled in', async () => {
  offer = await one('sales', `insert into offers (client_id, project_id, formula_version_id) values ($1, $2, $3)
                              returning id, code, locale, valid_until = current_date + 30 as valid30`, [client.id, project.id, v2.id]);
  eq(offer.code, 'OF-00001', 'code'); eq(offer.locale, 'en', 'locale'); eq(offer.valid30, true, 'valid 30 days');
});
await ok('tiers are costed per pack: 1000 packs 1.7039, 5000 packs 1.4076 (price break, set-up spread)', async () => {
  await as('sales', 'insert into offer_tiers (offer_id, quantity) values ($1, 1000), ($1, 5000)', [offer.id]);
  const a = await tier(1000), b = await tier(5000);
  eq(a.unit_cost, '1.7039', 'cost 1000'); eq(b.unit_cost, '1.4076', 'cost 5000');
  eq(a.cost_complete, true, 'all prices known');
  eq(a.margin_pct, '30.00', 'default margin'); eq(a.unit_price, '2.4300', 'price from 30 % margin');
});
await ok('adding a jar recalculates the tiers', async () => {
  await as('sales', 'insert into offer_packaging (offer_id, item_id) values ($1, $2)', [offer.id, jar.id]);
  eq((await tier(1000)).unit_cost, '1.9539', 'cost 1000 with jar');
});
await fails('only packaging items can be packaging', () =>
  as('sales', 'insert into offer_packaging (offer_id, item_id) values ($1, $2)', [offer.id, mcc.id]), 'only packaging');
await ok('a manual price shows the resulting margin', async () => {
  await as('sales', 'update offer_tiers set unit_price = 2, price_is_manual = true where offer_id = $1 and quantity = 5000', [offer.id]);
  const b = await tier(5000);
  eq(b.unit_cost, '1.6576', 'cost'); eq(b.margin_pct, '17.12', 'margin');
});
await fails('sales without the price flag cannot see the cost breakdown', () =>
  as('sales', 'select * from offer_cost_breakdown($1, 1000)', [offer.id]), 'not allowed');
await ok('admin sees the cost breakdown', async () => {
  const rows = await as('admin', 'select kind, cost_per_pack from offer_cost_breakdown($1, 1000)', [offer.id]);
  eq([...new Set(rows.map(r => r.kind))].sort().join(','), 'ingredient,packaging,production,setup,shell', 'kinds');
  eq(Number(rows.find(r => r.kind === 'production').cost_per_pack).toFixed(2), '0.22', 'production');
});
await ok('sending freezes the offer', async () => {
  await as('sales', `update offers set status = 'sent' where id = $1`, [offer.id]);
  if (!(await one('sales', 'select sent_at from offers where id = $1', [offer.id])).sent_at) throw new Error('no sent_at');
  await as('inventory', 'insert into supplier_prices (supplier_item_id, price) values ($1, 30)', [supplierItem.id]);
  eq((await tier(1000)).unit_cost, '1.9539', 'cost unchanged');
});
await fails('a sent offer: tiers are locked', () =>
  as('sales', 'insert into offer_tiers (offer_id, quantity) values ($1, 2000)', [offer.id]), 'only draft');
await fails('a sent offer: details are locked', () =>
  as('sales', `update offers set notes = 'x' where id = $1`, [offer.id]), 'only draft');
await ok('back to draft: recalculation picks up the new price', async () => {
  await as('sales', `update offers set status = 'draft' where id = $1`, [offer.id]);
  await as('sales', 'select recalc_offer($1)', [offer.id]);
  eq((await tier(1000)).unit_cost, '2.2126', 'cost with 30 €/kg magnesium');
});
await ok('inventory and partner see no offers, tiers or production costs', async () => {
  for (const r of ['inventory', 'partner']) {
    for (const t of ['offers', 'offer_tiers', 'offer_packaging', 'format_costing']) {
      eq((await as(r, `select * from ${t}`)).length, 0, `${r} ${t}`);
    }
  }
});
await fails('partner cannot call the cost breakdown', () =>
  as('partner', 'select * from offer_cost_breakdown($1, 1000)', [offer.id]), 'not allowed');
await fails('users cannot call the internal costing function', () =>
  as('sales', 'select * from offer_cost_lines($1, 1000)', [offer.id]), 'permission denied');

console.log('\nSales orders');
let order, offer2, line1, line2;
await fails('orders cannot be inserted directly', () =>
  as('sales', `insert into sales_orders (client_id) values ($1)`, [client.id]), 'row-level security');
await fails('a draft offer cannot become an order', () =>
  as('sales', 'select create_order_from_offer($1, 1000)', [offer.id]), 'sent or accepted');
await fails('the quantity must be one of the offer prices', async () => {
  await as('sales', `update offers set status = 'sent' where id = $1`, [offer.id]);
  await as('sales', 'select create_order_from_offer($1, 1234)', [offer.id]);
}, 'no price for 1234');
await ok('sales turns the offer into an order: code, line price and accepted offer', async () => {
  const r = await one('sales', `select create_order_from_offer($1, 1000, 'PO-778') as id`, [offer.id]);
  order = await one('sales', 'select * from sales_orders where id = $1', [r.id]);
  line1 = await one('sales', 'select * from sales_order_lines where order_id = $1', [order.id]);
  eq(order.code, 'SO-00001', 'code'); eq(line1.unit_price, (await tier(1000)).unit_price, 'price from the tier');
  eq(line1.project_id, project.id, 'project'); eq(order.status, 'draft', 'status');
  eq((await one('sales', 'select status from offers where id = $1', [offer.id])).status, 'accepted', 'offer');
});
await ok('a second product from another offer of the same client goes on the same order', async () => {
  offer2 = await one('sales', `insert into offers (client_id, project_id, formula_version_id) values ($1, $2, $3) returning id`,
                     [client.id, project.id, v2.id]);
  await as('sales', 'insert into offer_tiers (offer_id, quantity) values ($1, 2000)', [offer2.id]);
  await as('sales', `update offers set status = 'sent' where id = $1`, [offer2.id]);
  line2 = { id: (await one('sales', 'select add_order_line_from_offer($1, $2, 2000) as id', [order.id, offer2.id])).id };
  eq((await as('sales', 'select id from sales_order_lines where order_id = $1', [order.id])).length, 2, 'lines');
});
await fails('an offer of another client cannot be added', async () => {
  const p2 = await one('sales', `insert into projects (client_id, name) values ($1, 'Other product') returning id`, [client2.id]);
  const f2 = await one('sales', `insert into formulas (name, product_format, serving_size, servings_per_pack) values ('Stock C', 'capsule', 1, 30) returning id`);
  const fv = await one('sales', 'select id from formula_versions where formula_id = $1', [f2.id]);
  await as('sales', `insert into formula_lines (version_id, item_id, amount) values ($1, $2, 100)`, [fv.id, mcc.id]);
  await as('sales', 'update formula_versions set shelf_life_months = 12 where id = $1', [fv.id]);
  await as('admin', 'select approve_formula_version($1)', [fv.id]);
  const o2 = await one('sales', `insert into offers (client_id, project_id, formula_version_id) values ($1, $2, $3) returning id`, [client2.id, p2.id, fv.id]);
  await as('sales', 'insert into offer_tiers (offer_id, quantity) values ($1, 500)', [o2.id]);
  await as('sales', `update offers set status = 'sent' where id = $1`, [o2.id]);
  await as('sales', 'select add_order_line_from_offer($1, $2, 500)', [order.id, o2.id]);
}, 'another client');
await ok('confirming moves the project to the order stage', async () => {
  await as('sales', `update sales_orders set status = 'confirmed', deposit_pct = 30 where id = $1`, [order.id]);
  eq((await one('sales', 'select status from projects where id = $1', [project.id])).status, 'order', 'project stage');
});
await fails('products are locked after confirmation', () =>
  as('sales', 'delete from sales_order_lines where id = $1', [line2.id]), 'only change on a draft');
await fails('an order cannot skip steps', () =>
  as('sales', `update sales_orders set status = 'dispatched' where id = $1`, [order.id]), 'cannot go from confirmed to dispatched');
await fails('production does not start before the deposit', () =>
  as('sales', `update sales_orders set status = 'in_production' where id = $1`, [order.id]), 'deposit');
await ok('with the deposit received, production starts; project follows', async () => {
  await as('sales', `update sales_orders set deposit_received_on = current_date, status = 'in_production' where id = $1`, [order.id]);
  eq((await one('sales', 'select status from projects where id = $1', [project.id])).status, 'production', 'project stage');
});
await ok('inventory sees the orders and lines without prices, not the tables', async () => {
  const h = await as('inventory', 'select * from sales_order_overview');
  const l = await as('inventory', 'select * from sales_order_line_overview');
  eq(h.length, 1, 'orders'); eq(l.length, 2, 'lines'); eq('unit_price' in l[0], false, 'no price column');
  eq((await as('inventory', 'select * from sales_orders')).length, 0, 'orders table');
  eq((await as('inventory', 'select * from sales_order_lines')).length, 0, 'lines table');
});
await ok('partner sees no orders', async () => {
  eq((await as('partner', 'select * from sales_order_overview')).length, 0, 'overview');
  eq((await as('partner', 'select * from sales_order_line_overview')).length, 0, 'lines');
});

console.log('\nManufacturing');
let mo, mo2, mccWh;
const mreq = async (user = 'inventory', id = mo.id) => Object.fromEntries(
  (await as(user, 'select * from mo_material_requirements($1)', [id])).map(r => [r.sku, r]));
const recv = async (itemId, qty, loc) => {
  const l = await one('inventory', 'select receive_lot($1, $2, $3) as id', [itemId, L[loc], qty]);
  await as('admin', `select set_lot_qc_status($1, 'released')`, [l.id]);
  return l.id;
};
await ok('sales simulates production of the first line: project, formula and packaging come along', async () => {
  mo = await one('sales', 'insert into manufacturing_orders (sales_order_line_id, quantity) values ($1, 1000) returning *', [line1.id]);
  eq(mo.code, 'MO-00001', 'code'); eq(mo.status, 'simulation', 'status');
  eq(mo.project_id, project.id, 'project'); eq(mo.formula_version_id, v2.id, 'formula');
  eq((await as('sales', 'select * from mo_packaging where mo_id = $1', [mo.id])).length, 1, 'jar copied from the offer');
});
await ok('materials: 22.5 kg magnesium (8 kg free), 60 000 capsules, 1000 jars', async () => {
  const r = await mreq();
  eq(Number(r['RM-MGBG'].required), 22.5, 'magnesium'); eq(Number(r['RM-MGBG'].available), 8, 'free magnesium');
  eq(Number(r['PK-CAP0'].required), 60000, 'capsules'); eq(Number(r['PK-JAR'].required), 1000, 'jars');
});
await ok('reserving in simulation takes what is free', async () => {
  mccWh = await recv(mcc.id, 3, 'NK-WH');
  eq((await one('sales', 'select reserve_mo_materials($1) as n', [mo.id])).n, 2, 'items reserved');
  const r = await mreq();
  eq(Number(r['RM-MGBG'].reserved), 8, 'magnesium'); eq(Number(r['EX-MCC'].reserved), 3, 'cellulose');
});
await ok('purchase requests for what is missing, once', async () => {
  eq((await one('sales', 'select create_purchase_requests($1) as n', [mo.id])).n, 5, 'requests');
  eq(Number((await mreq())['RM-MGBG'].requested), 14.5, 'magnesium requested');
  eq((await one('sales', 'select create_purchase_requests($1) as n', [mo.id])).n, 0, 'no duplicates');
});
await fails('sales cannot schedule production', () =>
  as('sales', 'select schedule_mo($1, current_date + 7)', [mo.id]), 'not allowed');
await fails('the status changes only through the production actions', () =>
  as('inventory', `update manufacturing_orders set status = 'released' where id = $1`, [mo.id]), 'production actions');
await ok('inventory schedules the order', async () => {
  await as('inventory', 'select schedule_mo($1, current_date + 7)', [mo.id]);
  eq((await one('inventory', 'select status from manufacturing_orders where id = $1', [mo.id])).status, 'scheduled', 'status');
});
await fails('quantity is fixed once scheduled', () =>
  as('inventory', 'update manufacturing_orders set quantity = 2000 where id = $1', [mo.id]), 'only in simulation');
await fails('it cannot go to the partner with materials missing', () =>
  as('inventory', 'select release_mo($1)', [mo.id]), 'not all materials are reserved');
const lots = {};
await ok('stock arrives at the partner; everything gets reserved; sent to the partner', async () => {
  const old = await one('inventory', `select id from stock_reservations where project_id = $1 and manufacturing_order_id is null and status = 'active'`, [project.id]);
  await as('sales', `select close_reservation($1, 'released')`, [old.id]);
  lots.mcc = await recv(mcc.id, 2, 'PF-RM');
  lots.novel = await recv(novelPending.id, 2, 'PF-RM');
  lots.caps = await recv(caps.id, 70000, 'PF-PACK');
  lots.jar = await recv(jar.id, 1100, 'PF-PACK');
  await as('inventory', 'select reserve_mo_materials($1)', [mo.id]);
  await as('inventory', 'select release_mo($1)', [mo.id]);
  eq((await one('inventory', 'select status from manufacturing_orders where id = $1', [mo.id])).status, 'released', 'status');
});
await ok('partner sees the order by project code only and the materials without free stock', async () => {
  const rows = await as('partner', 'select * from partner_manufacturing_orders');
  eq(rows.length, 1, 'orders'); eq(rows[0].project_code, 'NK-P-0001', 'project code');
  eq(Object.keys(rows[0]).some(k => k.includes('client')), false, 'no client column');
  eq((await as('partner', 'select * from manufacturing_orders')).length, 0, 'table hidden');
  const r = await mreq('partner');
  eq(r['RM-MGBG'].available, null, 'no free stock'); eq(Number(r['PK-JAR'].at_partner) >= 1000, true, 'jars at the facility');
});
await ok('partner starts production', async () => {
  await as('partner', 'select start_production($1)', [mo.id]);
});
const consumption = () => JSON.stringify([
  { lot_id: lot.id, location_id: L['PF-RM'], quantity: 22.5 },
  { lot_id: lots.mcc, location_id: L['PF-RM'], quantity: 2 },
  { lot_id: lots.novel, location_id: L['PF-RM'], quantity: 1.5 },
  { lot_id: lots.caps, location_id: L['PF-PACK'], quantity: 60000 },
  { lot_id: lots.jar, location_id: L['PF-PACK'], quantity: 1000 },
]);
await fails('partner cannot consume stock in the Nutrikal warehouse', () =>
  as('partner', `select complete_production($1, 'B-24001', 990, current_date, $2::jsonb)`,
     [mo.id, JSON.stringify([{ lot_id: mccWh, location_id: L['NK-WH'], quantity: 1 }])]), 'partner locations');
await fails('a lot that is not a material of the order is refused', async () => {
  const other = await one('inventory', 'select receive_lot($1, $2, 5) as id', [novelBlocked.id, L['PF-QUAR']]);
  await as('partner', `select complete_production($1, 'B-24001', 990, current_date, $2::jsonb)`,
           [mo.id, JSON.stringify([{ lot_id: other.id, location_id: L['PF-QUAR'], quantity: 1 }])]);
}, 'not one of the materials');
await ok('partner reports the batch: lots consumed, finished lot in quarantine at the facility', async () => {
  const before = Number((await one('admin', 'select sum(quantity) as q from stock_movements where lot_id = $1', [lot.id])).q);
  const r = await one('partner', `select complete_production($1, 'B-24001', 990, current_date, $2::jsonb) as lot`, [mo.id, consumption()]);
  const fg = await one('admin', 'select l.lot_number, l.qc_status, i.type, i.sku from lots l join items i on i.id = l.item_id where l.id = $1', [r.lot]);
  eq(fg.lot_number, 'B-24001', 'batch number'); eq(fg.qc_status, 'quarantine', 'QC'); eq(fg.type, 'finished_good', 'item type');
  eq(fg.sku, 'FG-NK-P-0001', 'finished goods item');
  eq(Number((await one('admin', 'select sum(quantity) as q from stock_movements where lot_id = $1 and location_id = $2', [r.lot, L['PF-FG']])).q), 990, 'made');
  eq(Number((await one('admin', 'select sum(quantity) as q from stock_movements where lot_id = $1', [lot.id])).q), before - 22.5, 'magnesium used');
  const m = await one('admin', 'select status, batch_number, produced_quantity from manufacturing_orders where id = $1', [mo.id]);
  eq(m.status, 'completed', 'status'); eq(m.produced_quantity, 990, 'quantity');
  eq((await as('admin', `select id from stock_reservations where manufacturing_order_id = $1 and status = 'active'`, [mo.id])).length, 0, 'reservations closed');
});
await ok('partner enters its invoice for the batch; sales cannot see it', async () => {
  await as('partner', `insert into production_invoices (mo_id, invoice_number, invoice_date, amount) values ($1, 'PF-2026-118', current_date, 1450)`, [mo.id]);
  eq((await as('partner', 'select * from production_invoices')).length, 1, 'partner sees own');
  eq((await as('inventory', 'select * from production_invoices')).length, 1, 'inventory');
  eq((await as('sales', 'select * from production_invoices')).length, 0, 'sales');
});
await fails('partner cannot invoice an order that was not sent to it', async () => {
  mo2 = await one('sales', 'insert into manufacturing_orders (sales_order_line_id, quantity) values ($1, 2000) returning id', [line2.id]);
  await as('partner', `insert into production_invoices (mo_id, invoice_number, invoice_date, amount) values ($1, 'X', current_date, 1)`, [mo2.id]);
}, 'row-level security');
await ok('cancelling releases reservations and open requests', async () => {
  await as('sales', 'select create_purchase_requests($1)', [mo2.id]);
  await as('inventory', 'select cancel_mo($1)', [mo2.id]);
  eq((await one('inventory', 'select status from manufacturing_orders where id = $1', [mo2.id])).status, 'cancelled', 'status');
  eq((await as('inventory', `select id from purchase_requests where manufacturing_order_id = $1 and status = 'open'`, [mo2.id])).length, 0, 'requests');
});
await ok('partner sees no purchase requests and no simulations', async () => {
  eq((await as('partner', 'select * from purchase_requests')).length, 0, 'requests');
  eq((await as('partner', 'select id from partner_manufacturing_orders')).length, 1, 'only the released one');
});

console.log('\nNumbering and audit');
await fails('partner cannot draw invoice numbers', () => as('partner', `select next_number('invoice')`), 'not allowed');
await ok('invoice series is a 10-digit sequence', async () => {
  eq((await one('sales', `select next_number('invoice') as n`)).n, '0000000001', 'invoice number');
});
await ok('admin can reset the next invoice number', async () => {
  await as('admin', `update number_series set next_number = 1245 where key = 'invoice'`);
  eq((await one('sales', `select next_number('invoice') as n`)).n, '0000001245', 'invoice number');
});
await ok('audit log records changes; only admin can read it', async () => {
  eq(Number((await one('admin', 'select count(*) from audit_log')).count) > 10, true, 'admin rows');
  eq((await as('sales', 'select * from audit_log')).length, 0, 'sales rows');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
