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

// Users created before the role restructure: an Inventory user (becomes
// Admin) and the Partner user (becomes Production)
const LEGACY = { inventory: '00000000-0000-0000-0000-00000000000c', partner: '00000000-0000-0000-0000-00000000000d' };
const files = readdirSync(migDir).filter(f => f.endsWith('.sql') && !f.includes('storage')).sort();
for (const f of files) {
  if (f.startsWith('20261023000100')) {
    for (const [role, id] of Object.entries(LEGACY)) {
      await db.query('insert into auth.users (id) values ($1)', [id]);
      await db.query('insert into public.profiles (id, full_name, email, role) values ($1, $2, $3, $4)',
        [id, `Test ${role}`, `${role}@nutrikal.test`, role]);
    }
  }
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
  production: LEGACY.partner,
  legacy:    LEGACY.inventory,
  developer: '00000000-0000-0000-0000-00000000000e',
};
for (const [role, id] of Object.entries(U)) {
  if (Object.values(LEGACY).includes(id)) continue;
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

console.log('\nRoles');
await ok('the Inventory user became Admin and the Partner user became Production', async () => {
  eq((await db.query('select role from profiles where id = $1', [U.legacy])).rows[0].role, 'admin', 'inventory');
  eq((await db.query('select role from profiles where id = $1', [U.production])).rows[0].role, 'production', 'partner');
});
await fails('the Inventory role can no longer be given', () =>
  db.query(`update profiles set role = 'inventory' where id = $1`, [U.sales]), 'not_inventory');
await fails('the Partner role no longer exists', () =>
  db.query(`update profiles set role = 'partner' where id = $1`, [U.sales]), 'invalid input value');
await ok('no function or policy names the old roles', async () => {
  const f = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname = 'public' and (p.prosrc ~ $1)`, ["'(inventory|partner)'"])).rows;
  eq(f.map(r => r.proname).join(','), '', 'functions');
  const v = (await db.query(`select viewname from pg_views where schemaname = 'public' and definition ~ 'inventory'`)).rows;
  eq(v.map(r => r.viewname).join(','), '', 'views');
});

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
await fails('production cannot create clients', () =>
  as('production', `insert into clients (legal_name) values ('X Ltd')`), 'row-level security|not allowed');
await ok('production sees no clients and no projects table rows', async () => {
  eq((await as('production', 'select id from clients')).length, 0, 'clients');
  eq((await as('production', 'select id from projects')).length, 0, 'projects');
});
await ok('production sees the project by code only', async () => {
  const rows = await as('production', 'select * from production_projects');
  eq(rows.length, 1, 'partner projects');
  eq(rows[0].code, 'NK-P-0001', 'code');
  eq(Object.keys(rows[0]).includes('client_id'), false, 'no client column');
});

console.log('\nItems, suppliers, prices');
let item, supplierItem;
await ok('admin creates a raw material', async () => {
  item = await one('admin', `insert into items (sku, type, name, name_bg, base_unit, novel_food_status, shelf_life_months, reorder_level)
                                 values ('RM-MGBG', 'raw_material', 'Magnesium bisglycinate', 'Магнезиев бисглицинат', 'kg', 'not_novel', 24, 20)
                                 returning id`);
});
await fails('raw material without Novel Food status is refused', () =>
  as('admin', `insert into items (sku, type, name, base_unit) values ('RM-X', 'raw_material', 'X', 'kg')`), 'novel_food');
await ok('admin adds a supplier, supplier item and price', async () => {
  const s = await one('admin', `insert into suppliers (name, country_code) values ('Ingredient Co', 'DE') returning id`);
  supplierItem = await one('admin', `insert into supplier_items (supplier_id, item_id, moq, is_preferred)
                                         values ($1, $2, 25, true) returning id`, [s.id, item.id]);
  await as('admin', `insert into supplier_prices (supplier_item_id, price) values ($1, 18.50)`, [supplierItem.id]);
});
await ok('sales cannot see purchase prices by default', async () => {
  eq((await as('sales', 'select * from current_supplier_prices')).length, 0, 'prices for sales');
});
await ok('admin sees the current price', async () => {
  eq((await one('admin', 'select price from current_supplier_prices')).price, '18.5000', 'price');
});
await ok('a sales user with the price flag can see prices', async () => {
  await db.query('update profiles set can_see_purchase_prices = true where id = $1', [U.sales]);
  eq((await as('sales', 'select * from current_supplier_prices')).length, 1, 'prices');
  await db.query('update profiles set can_see_purchase_prices = false where id = $1', [U.sales]);
});
await ok('production sees items but no prices or suppliers', async () => {
  // the test item + the basic packaging items of the migrations
  eq((await as('production', 'select id from items')).length, (await as('admin', 'select id from items')).length, 'items');
  eq((await as('production', 'select * from supplier_prices')).length, 0, 'prices');
  eq((await as('production', 'select * from suppliers')).length, 0, 'suppliers');
});

console.log('\nReceiving, QC and stock');
let lot;
await ok('production receives a lot at the production facility, released on receipt', async () => {
  const r = await one('production', `select receive_lot($1, $2, 100, null, 'SUP-778', current_date - 30) as id`,
                      [item.id, L['G-PRO']]);
  lot = (await db.query('select * from lots where id = $1', [r.id])).rows[0];
  eq(lot.lot_number, 'LOT-000001', 'lot number');
  eq(lot.qc_status, 'released', 'status');
});
await ok('expiry is calculated from the 24-month shelf life', async () => {
  const r = await one('admin', `select expires_on = (manufactured_on + interval '24 months')::date as ok from lots where id = $1`, [lot.id]);
  eq(r.ok, true, 'expiry');
});
await fails('production cannot receive into the Nutrikal warehouse', () =>
  as('production', 'select receive_lot($1, $2, 5)', [item.id, L['NK-WH']]), 'production locations');
await ok('four stores: Nutrikal, Production (G-PRO), Finished goods, Fulfilment; the old production sub-stores are closed', async () => {
  const r = (await db.query(`select code, name, is_partner_visible as p from locations where is_active order by code`)).rows;
  eq(r.map((x) => `${x.code}:${x.name}:${x.p}`).join('|'),
     'FG:Готова продукция:true|FULFIL:Фулфилмънт:false|G-PRO:Производство (G-PRO):true|NK-WH:Nutrikal:false', 'stores');
});
await ok('production moves stock between its stores (G-PRO ↔ finished goods)', async () => {
  await as('production', 'select transfer_stock($1, $2, $3, 100)', [lot.id, L['G-PRO'], L['FG']]);
  await as('production', 'select transfer_stock($1, $2, $3, 100)', [lot.id, L['FG'], L['G-PRO']]);
});
await fails('production cannot move stock to the fulfilment centre', () =>
  as('production', 'select transfer_stock($1, $2, $3, 1)', [lot.id, L['G-PRO'], L['FULFIL']]), 'production locations');
await fails('consumption of a lot admin put in quarantine is blocked', async () => {
  await as('admin', `select set_lot_qc_status($1, 'quarantine', 'Under review')`, [lot.id]);
  await as('production', `select post_stock_movement('consumption', $1, $2, 10)`, [lot.id, L['G-PRO']]);
}, 'not released');
await fails('production cannot release a lot (Admin only)', () =>
  as('production', `select set_lot_qc_status($1, 'released')`, [lot.id]), 'not allowed');
await fails('production cannot release a lot by updating it either', () =>
  as('production', `update lots set qc_status = 'released' where id = $1 returning id`, [lot.id]).then(r => { if (!r.length) throw new Error('row-level security'); }), 'row-level security|only admin');
await ok('admin releases the lot; decision is recorded', async () => {
  await as('admin', `select set_lot_qc_status($1, 'released', 'COA checked')`, [lot.id]);
  const l = (await db.query('select qc_status, qc_decided_by from lots where id = $1', [lot.id])).rows[0];
  eq(l.qc_status, 'released', 'status'); eq(l.qc_decided_by, U.admin, 'decided by');
});
await ok('production consumes 30 kg in production', async () => {
  await as('production', `select post_stock_movement('consumption', $1, $2, 30, null, $3, 'MO-TEST')`,
           [lot.id, L['G-PRO'], project.id]);
});
await fails('negative stock is refused', () =>
  as('production', `select post_stock_movement('consumption', $1, $2, 80)`, [lot.id, L['G-PRO']]), 'insufficient');
await fails('production cannot post adjustments as movements', () =>
  as('production', `select post_stock_movement('adjustment', $1, $2, -2, 'spill')`, [lot.id, L['G-PRO']]), 'count_stock');
await fails('production corrects stock only with a reason', () =>
  as('production', 'select count_stock($1, $2, 68)', [lot.id, L['G-PRO']]), 'reason');
await ok('production corrects stock directly: a ledger adjustment, every admin notified', async () => {
  const d = await one('production', `select count_stock($1, $2, 68, 'Spillage during weighing') as d`, [lot.id, L['G-PRO']]);
  eq(Number(d.d), -2, 'difference');
  const m = await one('admin', `select quantity, reason from stock_movements where lot_id = $1 and type = 'adjustment'`, [lot.id]);
  eq(Number(m.quantity), -2, 'movement'); eq(m.reason, 'Spillage during weighing', 'reason');
  const n = await as('admin', `select params from notifications where kind = 'stock_corrected'`);
  eq(n.length, 1, 'admin notified'); eq(Number(n[0].params.diff), -2, 'difference in the notification');
  eq((await as('legacy', `select id from notifications where kind = 'stock_corrected'`)).length, 1, 'every admin');
  eq((await as('sales', 'select id from notifications')).length, 0, 'sales');
  eq((await as('production', 'select id from notifications')).length, 0, 'production');
  eq((await as('admin', 'select id from production_corrections')).length, 1, 'correction history');
  eq((await as('production', 'select id from production_corrections')).length, 0, 'history is for Admin');
});
await fails('production no longer files correction requests', () =>
  as('production', `select request_stock_adjustment($1, $2, -1, 'x')`, [lot.id, L['G-PRO']]), 'count_stock');
await ok('a user marks only their own notifications read', async () => {
  eq((await one('production', 'select mark_notifications_read() as n')).n, 0, 'none for production');
  eq((await one('admin', 'select mark_notifications_read() as n')).n, 1, 'admin');
  eq((await as('legacy', 'select id from notifications where read_at is null')).length, 1, 'other admin unchanged');
});
await fails('nobody writes notifications directly', () =>
  as('admin', `insert into notifications (user_id, kind) values ($1, 'mo_sent')`, [U.admin]), 'row-level security');
await fails('direct writes to the ledger are refused', () =>
  as('admin', `insert into stock_movements (type, lot_id, location_id, quantity) values ('receipt', $1, $2, 5)`,
     [lot.id, L['G-PRO']]), 'row-level security');
await fails('ledger rows cannot be edited, even by the database owner', () =>
  db.query('update stock_movements set quantity = 1000'), 'cannot be changed');
await fails('sales cannot post stock movements', () =>
  as('sales', `select post_stock_movement('waste', $1, $2, 1)`, [lot.id, L['G-PRO']]), 'not allowed');

console.log('\nReservations and availability');
await ok('sales reserves 60 kg for the project', async () => {
  await as('sales', 'select reserve_stock($1, $2, 60)', [item.id, project.id]);
});
await fails('over-reservation is refused (68 usable, 60 reserved)', () =>
  as('sales', 'select reserve_stock($1, $2, 20)', [item.id, project.id]), 'only 8');
await ok('stock summary: 68 on hand, 60 reserved, 8 available, below reorder level 20', async () => {
  const s = await one('admin', 'select * from item_stock_summary where item_id = $1', [item.id]);
  eq(Number(s.on_hand), 68, 'on hand'); eq(Number(s.reserved), 60, 'reserved');
  eq(Number(s.available), 8, 'available'); eq(s.below_reorder_level, true, 'reorder flag');
});

console.log('\nExpiry and production visibility');
let oldLot;
await ok('admin receives an already-expired lot into the Nutrikal warehouse', async () => {
  const r = await one('admin', `select receive_lot($1, $2, 10, null, 'OLD-1', current_date - 800, current_date - 1) as id`,
                      [item.id, L['NK-WH']]);
  oldLot = r.id;
  await as('admin', `select set_lot_qc_status($1, 'released')`, [oldLot]);
});
await fails('consumption of an expired lot is blocked', () =>
  as('admin', `select post_stock_movement('consumption', $1, $2, 1)`, [oldLot, L['NK-WH']]), 'expired');
await ok('expired lot shows in expiring_lots; not counted as usable', async () => {
  eq((await as('admin', 'select * from expiring_lots where lot_id = $1', [oldLot])).length, 1, 'expiring');
  const s = await one('admin', 'select usable from item_stock_summary where item_id = $1', [item.id]);
  eq(Number(s.usable), 68, 'usable unchanged');
});
await ok('production sees only production lots and locations', async () => {
  eq((await as('production', 'select id from lots')).length, 1, 'lots');
  eq((await as('production', 'select code from locations')).length, 2, 'locations');
  eq((await as('production', 'select * from stock_movements where location_id = $1', [L['NK-WH']])).length, 0, 'warehouse moves');
});

console.log('\nFormulation');
let formula, v1, v2, mcc, novelPending, novelBlocked, caps, magnesium, claim;
await ok('admin sets up an excipient, two Novel Food cases and a capsule shell', async () => {
  mcc = await one('admin', `insert into items (sku, type, name, base_unit, novel_food_status, shelf_life_months, is_vegan)
                                values ('EX-MCC', 'excipient', 'Microcrystalline cellulose', 'kg', 'not_novel', 60, true) returning id`);
  novelPending = await one('admin', `insert into items (sku, type, name, base_unit, novel_food_status, shelf_life_months)
                                         values ('RM-NEW', 'raw_material', 'New extract', 'kg', 'pending', 12) returning id`);
  novelBlocked = await one('admin', `insert into items (sku, type, name, base_unit, novel_food_status, allergens)
                                         values ('RM-BAN', 'raw_material', 'Unauthorised extract', 'kg', 'not_authorised', '{soybeans}') returning id`);
  caps = await one('admin', `insert into items (sku, type, name, base_unit, capacity, capacity_unit)
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
await fails('production cannot create formulas', () =>
  as('production', `insert into formulas (name, product_format, serving_size) values ('X', 'capsule', 1)`), 'row-level security|not allowed');
await ok('sales adds ingredients per serving', async () => {
  await as('sales', `insert into formula_lines (version_id, item_id, amount, overage_pct, sort_order) values
                       ($1, $2, 750, 0, 1), ($1, $3, 140, 5, 2)`, [v1.id, item.id, mcc.id]);
});
await fails('packaging cannot be an ingredient', () =>
  as('sales', `insert into formula_lines (version_id, item_id, amount) values ($1, $2, 1)`, [v1.id, caps.id]), 'only raw materials');
await ok('admin records the magnesium content; label shows 105 mg = 28 % NRV', async () => {
  magnesium = await one('admin', `select id from nutrients where code = 'magnesium'`);
  await as('admin', `insert into item_nutrients (item_id, nutrient_id, content_pct) values ($1, $2, 14)`, [item.id, magnesium.id]);
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
await ok('admin can read formulas and lines', async () => {
  eq((await as('admin', 'select id from formulas')).length, 1, 'formulas');
  eq((await as('admin', 'select id from formula_line_details where version_id = $1', [v2.id])).length, 3, 'lines');
});
await ok('production sees no formulas, versions, lines, nutrients or claims', async () => {
  for (const t of ['formulas', 'formula_versions', 'formula_lines', 'formula_line_details', 'formula_version_checks',
                   'formula_version_nutrients', 'formula_version_claim_checks', 'item_nutrients', 'nutrients', 'health_claims']) {
    eq((await as('production', `select * from ${t}`)).length, 0, t);
  }
});
await fails('production cannot create a formula version', () => as('production', 'select new_formula_version($1)', [formula.id]), 'not allowed');

console.log('\nCosting and offers');
let offer, client2, jar;
const tier = async (qty) => one('sales', 'select * from offer_tiers where offer_id = $1 and quantity = $2', [offer.id, qty]);
await ok('production costs are for Admin only', async () => {
  eq((await as('sales', 'select * from format_costing')).length, 0, 'sales reads nothing');
});
await ok('admin sets capsule production costs; sales cannot change them', async () => {
  await as('admin', `update format_costing set fee_per_pack = 0.10, fee_per_1000_units = 2, setup_fee = 300, loss_pct = 0,
                       default_margin_pct = 30 where product_format = 'capsule'`);
  await as('sales', `update format_costing set setup_fee = 1 where product_format = 'capsule'`);
  eq(Number((await one('admin', `select setup_fee from format_costing where product_format = 'capsule'`)).setup_fee), 300, 'setup fee');
});
await ok('admin prices the ingredients, shells and a jar (with a price break for 100 kg magnesium)', async () => {
  const s = await one('admin', `insert into suppliers (name) values ('Second supplier') returning id`);
  jar = await one('admin', `insert into items (sku, type, name, base_unit) values ('PK-JAR', 'packaging', 'Jar 150 ml', 'pcs') returning id`);
  for (const [it, price] of [[mcc.id, 4], [novelPending.id, 100], [caps.id, 0.01], [jar.id, 0.25]]) {
    const si = await one('admin', `insert into supplier_items (supplier_id, item_id, is_preferred) values ($1, $2, true) returning id`, [s.id, it]);
    await as('admin', 'insert into supplier_prices (supplier_item_id, price) values ($1, $2)', [si.id, price]);
  }
  await as('admin', 'insert into supplier_prices (supplier_item_id, price, min_quantity) values ($1, 16, 100)', [supplierItem.id]);
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
  await as('admin', 'insert into supplier_prices (supplier_item_id, price) values ($1, 30)', [supplierItem.id]);
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
await ok('admin and production see no offers, tiers or production costs', async () => {
  for (const r of ['production']) {
    for (const t of ['offers', 'offer_tiers', 'offer_packaging', 'format_costing']) {
      eq((await as(r, `select * from ${t}`)).length, 0, `${r} ${t}`);
    }
  }
});
await fails('production cannot call the cost breakdown', () =>
  as('production', 'select * from offer_cost_breakdown($1, 1000)', [offer.id]), 'not allowed');
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
await fails('with the deposit received, the order is not in production until Production has a manufacturing order', async () => {
  await as('admin', `update sales_orders set deposit_received_on = current_date where id = $1`, [order.id]);
  await as('admin', `update sales_orders set status = 'in_production' where id = $1`, [order.id]);
}, 'sent to production yet');
await ok('production sees no orders', async () => {
  eq((await as('production', 'select * from sales_order_overview')).length, 0, 'overview');
  eq((await as('production', 'select * from sales_order_line_overview')).length, 0, 'lines');
});

console.log('\nManufacturing');
let mo, mo2, mccWh;
const mreq = async (user = 'admin', id = mo.id) => Object.fromEntries(
  (await as(user, 'select * from mo_material_requirements($1)', [id])).map(r => [r.sku, r]));
const recv = async (itemId, qty, loc) => {
  const l = await one('admin', 'select receive_lot($1, $2, $3) as id', [itemId, L[loc], qty]);
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
  as('admin', `update manufacturing_orders set status = 'released' where id = $1`, [mo.id]), 'production actions');
await ok('admin schedules the order', async () => {
  await as('admin', 'select schedule_mo($1, current_date + 7)', [mo.id]);
  eq((await one('admin', 'select status from manufacturing_orders where id = $1', [mo.id])).status, 'scheduled', 'status');
});
await fails('quantity is fixed once scheduled', () =>
  as('admin', 'update manufacturing_orders set quantity = 2000 where id = $1', [mo.id]), 'only in simulation');
await fails('it cannot go to the production with materials missing', () =>
  as('admin', 'select release_mo($1)', [mo.id]), 'not all materials are reserved');
const lots = {};
await ok('stock arrives at the production; everything gets reserved; sent to the production', async () => {
  const old = await one('admin', `select id from stock_reservations where project_id = $1 and manufacturing_order_id is null and status = 'active'`, [project.id]);
  await as('sales', `select close_reservation($1, 'released')`, [old.id]);
  lots.mcc = await recv(mcc.id, 2, 'G-PRO');
  lots.novel = await recv(novelPending.id, 2, 'G-PRO');
  lots.caps = await recv(caps.id, 70000, 'G-PRO');
  lots.jar = await recv(jar.id, 1100, 'G-PRO');
  await as('admin', 'select reserve_mo_materials($1)', [mo.id]);
  eq((await one('admin', 'select status from sales_orders where id = $1', [order.id])).status, 'confirmed', 'order before');
  await as('admin', 'select release_mo($1)', [mo.id]);
  eq((await one('admin', 'select status from manufacturing_orders where id = $1', [mo.id])).status, 'released', 'status');
});
await ok('sending it to Production puts the sales order in production; project follows', async () => {
  eq((await one('admin', 'select status from sales_orders where id = $1', [order.id])).status, 'in_production', 'order');
  eq((await one('sales', 'select status from projects where id = $1', [project.id])).status, 'production', 'project stage');
});
await fails('an order that Production has cannot go back to confirmed', () =>
  as('admin', `update sales_orders set status = 'confirmed' where id = $1`, [order.id]), 'cannot go back to confirmed');
await ok('production sees the order by project code only and the materials without free stock', async () => {
  const rows = await as('production', 'select * from production_manufacturing_orders');
  eq(rows.length, 1, 'orders'); eq(rows[0].project_code, 'NK-P-0001', 'project code');
  eq(Object.keys(rows[0]).some(k => k.includes('client')), false, 'no client column');
  eq((await as('production', 'select * from manufacturing_orders')).length, 0, 'table hidden');
  const r = await mreq('production');
  eq(r['RM-MGBG'].available, null, 'no free stock'); eq(Number(r['PK-JAR'].at_production) >= 1000, true, 'jars at the facility');
});
await fails('production cannot report before starting', () =>
  as('production', `select complete_production($1, 'B-X', 1, current_date, '[]'::jsonb)`, [mo.id]), 'in production can be reported');
await ok('production starts production', async () => {
  await as('production', 'select start_production($1)', [mo.id]);
  eq((await one('admin', 'select status from manufacturing_orders where id = $1', [mo.id])).status, 'in_production', 'status');
});
await fails('production cannot move an order back', () =>
  as('production', `select revert_mo_status($1, 'oops')`, [mo.id]), 'not allowed');
await fails('admin moves an order back only with a reason', () =>
  as('admin', `select revert_mo_status($1, ' ')`, [mo.id]), 'reason');
await ok('admin moves it back to waiting and forward again on behalf of production', async () => {
  eq((await one('admin', `select revert_mo_status($1, 'Started by mistake') as s`, [mo.id])).s, 'released', 'back');
  eq((await one('admin', 'select status_reason from manufacturing_orders where id = $1', [mo.id])).status_reason, 'Started by mistake', 'reason kept');
  await as('admin', 'select start_production($1)', [mo.id]);
  eq((await one('admin', 'select status from manufacturing_orders where id = $1', [mo.id])).status, 'in_production', 'forward');
});
await ok('production sees supplier, quantity, purchase price and date of its materials', async () => {
  const r = await as('production', 'select * from mo_material_sources($1)', [mo.id]);
  const mg = r.find(x => x.lot_id === lot.id);
  eq(mg.supplier, null, 'magnesium received without supplier'); eq(mg.source, 'stock', 'source');
  eq(r.length > 0, true, 'rows');
  eq(Object.keys(r[0]).some(k => k.includes('client') || k.includes('sale')), false, 'no client or sales columns');
});
await fails('sales cannot see the material sources', () =>
  as('sales', 'select * from mo_material_sources($1)', [mo.id]), 'not allowed');
const consumption = () => JSON.stringify([
  { lot_id: lot.id, location_id: L['G-PRO'], quantity: 22.5 },
  { lot_id: lots.mcc, location_id: L['G-PRO'], quantity: 2 },
  { lot_id: lots.novel, location_id: L['G-PRO'], quantity: 1.5 },
  { lot_id: lots.caps, location_id: L['G-PRO'], quantity: 60000 },
  { lot_id: lots.jar, location_id: L['G-PRO'], quantity: 1000 },
]);
await fails('production cannot consume stock in the Nutrikal warehouse', () =>
  as('production', `select complete_production($1, 'B-24001', 990, current_date, $2::jsonb)`,
     [mo.id, JSON.stringify([{ lot_id: mccWh, location_id: L['NK-WH'], quantity: 1 }])]), 'production locations');
await fails('a lot that is not a material of the order is refused', async () => {
  const other = await one('admin', 'select receive_lot($1, $2, 5) as id', [novelBlocked.id, L['G-PRO']]);
  await as('production', `select complete_production($1, 'B-24001', 990, current_date, $2::jsonb)`,
           [mo.id, JSON.stringify([{ lot_id: other.id, location_id: L['G-PRO'], quantity: 1 }])]);
}, 'not one of the materials');
const reserved = async () => Object.fromEntries((await as('admin',
  `select i.sku, sum(r.quantity) as q from stock_reservations r join items i on i.id = r.item_id
    where r.manufacturing_order_id = $1 and r.status = 'active' group by i.sku`, [mo.id])).map(x => [x.sku, Number(x.q)]));
let reservedBefore;
await fails('a usage more than 5 % away from the reservation needs a reason', async () => {
  reservedBefore = await reserved();
  await as('production', `select complete_production($1, 'B-24001', 990, current_date, $2::jsonb)`, [mo.id, consumption()]);
}, 'enter a reason');
await ok('production reports the batch: lots used, finished lot in quarantine in FG', async () => {
  const before = Number((await one('admin', 'select sum(quantity) as q from stock_movements where lot_id = $1', [lot.id])).q);
  const items = await as('admin', 'select item_id from mo_material_requirements($1)', [mo.id]);
  const reasons = JSON.stringify(items.map(i => ({ item_id: i.item_id, reason: 'Less needed' })));
  const r = await one('production', `select complete_production($1, 'B-24001', 990, current_date, $2::jsonb, $3::jsonb) as lot`,
                      [mo.id, consumption(), reasons]);
  const fg = await one('admin', 'select l.lot_number, l.qc_status, i.type, i.sku from lots l join items i on i.id = l.item_id where l.id = $1', [r.lot]);
  eq(fg.lot_number, 'B-24001', 'batch number'); eq(fg.qc_status, 'quarantine', 'QC'); eq(fg.type, 'finished_good', 'item type');
  eq(fg.sku, 'FG-NK-P-0001', 'finished goods item');
  eq(Number((await one('admin', 'select sum(quantity) as q from stock_movements where lot_id = $1 and location_id = $2', [r.lot, L['FG']])).q), 990, 'made in quarantine');
  eq(Number((await one('admin', 'select sum(quantity) as q from stock_movements where lot_id = $1', [lot.id])).q), before - 22.5, 'magnesium used');
  const m = await one('admin', 'select status, batch_number, produced_quantity from manufacturing_orders where id = $1', [mo.id]);
  eq(m.status, 'completed', 'status'); eq(m.produced_quantity, 990, 'quantity');
  eq((await as('admin', `select id from stock_reservations where manufacturing_order_id = $1 and status = 'active'`, [mo.id])).length, 0, 'reservations closed');
});
await ok('the used part of the reservations is consumed and the rest released', async () => {
  const sum = async (status) => Object.fromEntries((await as('admin',
    `select i.sku, sum(r.quantity) as q from stock_reservations r join items i on i.id = r.item_id
      where r.manufacturing_order_id = $1 and r.status = $2 group by i.sku`, [mo.id, status])).map(x => [x.sku, Number(x.q)]));
  const consumed = await sum('consumed'), released = await sum('released');
  eq(consumed['EX-MCC'], 2, 'cellulose consumed');
  eq(released['EX-MCC'], reservedBefore['EX-MCC'] - 2, 'cellulose released');
  eq(consumed['RM-MGBG'], 22.5, 'magnesium consumed in full'); eq(released['RM-MGBG'] ?? 0, 0, 'no magnesium released');
});
await ok('reserved vs used: the difference value only for Admin; every admin notified', async () => {
  const a = Object.fromEntries((await as('admin', 'select * from mo_usage_report($1)', [mo.id])).map(x => [x.sku, x]));
  eq(Number(a['EX-MCC'].used), 2, 'used'); eq(a['EX-MCC'].over_limit, true, 'over the limit'); eq(a['EX-MCC'].reason, 'Less needed', 'reason');
  eq(a['RM-MGBG'].over_limit, false, 'magnesium as reserved');
  eq(a['EX-MCC'].diff_value !== null, true, 'admin sees the value');
  const p = await as('production', 'select * from mo_usage_report($1)', [mo.id]);
  eq(p.every(x => x.diff_value === null), true, 'production does not');
  eq((await as('admin', `select params from notifications where kind = 'mo_completed'`)).length, 1, 'admin notified');
});
await fails('sales cannot see the usage report', () => as('sales', 'select * from mo_usage_report($1)', [mo.id]), 'not allowed');
await fails('a completed order cannot be moved back', () =>
  as('admin', `select revert_mo_status($1, 'x')`, [mo.id]), 'cannot be moved back');
await fails('production no longer enters an invoice for the batch (owner, Nov 2026)', () =>
  as('production', `insert into production_invoices (mo_id, invoice_number, invoice_date, amount) values ($1, 'PF-2026-118', current_date, 1450)`, [mo.id]),
  'permission denied');
await fails('admin neither', () =>
  as('admin', `insert into production_invoices (mo_id, invoice_number, invoice_date, amount) values ($1, 'PF-2026-118', current_date, 1450)`, [mo.id]),
  'permission denied');
await ok('a second batch of the order in simulation', async () => {
  mo2 = await one('sales', 'insert into manufacturing_orders (sales_order_line_id, quantity) values ($1, 2000) returning id', [line2.id]);
});
await ok('cancelling releases reservations and open requests', async () => {
  await as('sales', 'select create_purchase_requests($1)', [mo2.id]);
  await as('admin', 'select cancel_mo($1)', [mo2.id]);
  eq((await one('admin', 'select status from manufacturing_orders where id = $1', [mo2.id])).status, 'cancelled', 'status');
  eq((await as('admin', `select id from purchase_requests where manufacturing_order_id = $1 and status = 'open'`, [mo2.id])).length, 0, 'requests');
});
await ok('production sees no purchase requests and no simulations', async () => {
  eq((await as('production', 'select * from purchase_requests')).length, 0, 'requests');
  eq((await as('production', 'select id from production_manufacturing_orders')).length, 1, 'only the released one');
});

console.log('\nPackaging on formulas and costs');
let v3;
await ok('packaging goes on a draft formula version and is copied to the next version', async () => {
  v3 = { id: (await one('sales', `select new_formula_version($1, 'Jar and label') as id`, [formula.id])).id };
  await as('sales', 'insert into formula_packaging (version_id, item_id, qty_per_pack) values ($1, $2, 1)', [v3.id, jar.id]);
  await as('admin', 'select approve_formula_version($1)', [v3.id]);
  const v4 = await one('sales', 'select new_formula_version($1) as id', [formula.id]);
  eq((await as('sales', 'select * from formula_packaging where version_id = $1', [v4.id])).length, 1, 'copied');
  await as('sales', `update formula_versions set status = 'archived' where id = $1`, [v4.id]);
});
await fails('only packaging items are packaging', async () => {
  const v = await one('sales', 'select new_formula_version($1) as id', [formula.id]);
  try { await as('sales', 'insert into formula_packaging (version_id, item_id) values ($1, $2)', [v.id, mcc.id]); }
  finally { await as('sales', `update formula_versions set status = 'archived' where id = $1`, [v.id]); }
}, 'only packaging');
await fails('packaging of an approved version is locked', () =>
  as('admin', 'delete from formula_packaging where version_id = $1', [v3.id]), 'only drafts');
await ok('a new offer and a stand-alone production order start with the formula packaging', async () => {
  const o = await one('sales', 'insert into offers (client_id, project_id, formula_version_id) values ($1, $2, $3) returning id', [client.id, project.id, v3.id]);
  eq((await as('sales', 'select * from offer_packaging where offer_id = $1', [o.id])).length, 1, 'offer');
  const m = await one('sales', 'insert into manufacturing_orders (formula_version_id, project_id, quantity) values ($1, $2, 100) returning id', [v3.id, project.id]);
  eq((await as('sales', 'select * from mo_packaging where mo_id = $1', [m.id])).length, 1, 'production order');
  const c = await one('admin', 'select * from mo_cost($1)', [m.id]);
  eq(c.is_actual, false, 'planned cost before production');
});
await ok('a received lot gets the current purchase price as its cost', async () => {
  const c = await one('admin', 'select unit_cost, source from lot_costs where lot_id = $1', [lots.mcc]);
  eq(Number(c.unit_cost), 4, 'cost'); eq(c.source, 'supplier_price', 'source');
});
await ok('admin enters the actual landed cost', async () => {
  await as('admin', 'select set_lot_cost($1, 4.35)', [mccWh]);
  const c = await one('admin', 'select unit_cost, source from lot_costs where lot_id = $1', [mccWh]);
  eq(Number(c.unit_cost), 4.35, 'cost'); eq(c.source, 'receipt', 'source');
});
await fails('sales cannot set lot costs', () => as('sales', 'select set_lot_cost($1, 1)', [mccWh]), 'not allowed');
await ok('production and sales without the price flag see no lot costs', async () => {
  eq((await as('production', 'select * from lot_costs')).length, 0, 'partner');
  eq((await as('sales', 'select * from lot_costs')).length, 0, 'sales');
});
await ok('batch cost: consumed lots at their cost (no partner invoice); per pack on the finished lot', async () => {
  const c = await one('admin', 'select * from mo_cost($1)', [mo.id]);
  eq(c.is_actual, true, 'actual');
  eq(Number(c.material_cost), 1424.25, 'materials (22.5×18.5 + 2×4 + 1.5×100 + 60000×0.01 + 1000×0.25)');
  eq('partner_cost' in c, false, 'no partner cost'); eq(Number(c.total_cost), 1424.25, 'total');
  eq(Number(c.cost_per_pack), 1.438636, 'per pack (990 made)');
  const fg = await one('admin', 'select lc.unit_cost, lc.source from manufacturing_orders m join lot_costs lc on lc.lot_id = m.finished_lot_id where m.id = $1', [mo.id]);
  eq(Number(fg.unit_cost), 1.438636, 'finished lot cost'); eq(fg.source, 'production', 'source');
  eq((await as('admin', 'select * from mo_costs($1)', [mo.id])).length, 5, 'one line per consumed lot');
});
await fails('production cannot see batch costs', () => as('production', 'select * from mo_cost($1)', [mo.id]), 'not allowed');
await fails('sales without the price flag cannot see batch costs', () => as('sales', 'select * from mo_costs($1)', [mo.id]), 'not allowed');
await ok('batch costs are for admin only, even for sales with the price flag', async () => {
  await db.query('update profiles set can_see_purchase_prices = true where id = $1', [U.sales]);
  try {
    let refused = 0;
    for (const sql of ['select * from mo_cost($1)', 'select * from mo_costs($1)']) {
      try { await as('sales', sql, [mo.id]); } catch (e) { if (/not allowed/i.test(e.message)) refused++; }
    }
    try { await as('sales', `select * from admin_production_costs('2000-01-01', '2100-01-01')`); } catch (e) { if (/not allowed/i.test(e.message)) refused++; }
    eq(refused, 3, 'refused');
  } finally {
    await db.query('update profiles set can_see_purchase_prices = false where id = $1', [U.sales]);
  }
});
await ok('admin dashboard: completed batches in the period with actual cost, open ones planned', async () => {
  const rows = await as('admin', `select * from admin_production_costs('2000-01-01', '2100-01-01')`);
  const done = rows.find((r) => r.id === mo.id);
  eq(done?.is_actual, true, 'completed batch listed');
  eq(Number(done.total_cost), 1424.25, 'total'); eq(Number(done.cost_per_pack), 1.4386, 'per pack');
  eq(rows.every((r) => r.status !== 'cancelled' && r.status !== 'simulation'), true, 'no cancelled or simulations');
  eq((await as('admin', `select * from admin_production_costs('2000-01-01', '2000-01-02', false)`)).length, 0, 'empty period');
});
await ok('admin dashboard figures: money, sales, stock and purchases', async () => {
  const { d } = await one('admin', `select admin_dashboard('2000-01-01', '2100-01-01') as d`);
  for (const k of ['money', 'sales', 'stock', 'purchases']) eq(typeof d[k], 'object', k);
  eq(Array.isArray(d.money.open) && Array.isArray(d.sales.top_clients) && Array.isArray(d.stock.low) && Array.isArray(d.purchases.open), true, 'lists');
  eq(Number(d.stock.value) > 0, true, 'stock value');
});
await ok('the admin dashboard is refused to sales (even with the price flag) and production', async () => {
  await db.query('update profiles set can_see_purchase_prices = true where id = $1', [U.sales]);
  try {
    for (const user of ['sales', 'production']) {
      let refused = false;
      try { await as(user, `select admin_dashboard('2000-01-01', '2100-01-01')`); } catch (e) { refused = /not allowed/i.test(e.message); }
      eq(refused, true, user);
    }
  } finally {
    await db.query('update profiles set can_see_purchase_prices = false where id = $1', [U.sales]);
  }
});
await fails('production cannot open the admin dashboard costs', () =>
  as('production', `select * from admin_production_costs('2000-01-01', '2100-01-01')`), 'not allowed');

console.log('\nNumbering and audit');
await fails('production cannot draw invoice numbers', () => as('production', `select next_number('invoice')`), 'not allowed');
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

console.log('\nFormula calculator');
await ok('price list is seeded and readable by admin and sales', async () => {
  eq(Number((await one('sales', 'select count(*) from calc_raw_materials')).count), 148, 'sales rows');
  eq(Number((await one('admin', 'select count(*) from calc_raw_materials')).count), 148, 'admin rows');
});
await ok('production and admin see nothing of the calculator', async () => {
  for (const user of ['production']) {
    for (const table of ['calc_raw_materials', 'calc_settings', 'calc_offers', 'calc_sync_runs', 'calc_catalog_products']) {
      eq((await as(user, `select * from ${table}`)).length, 0, `${user} ${table}`);
    }
  }
});
await fails('sales cannot change a raw material price directly (only through calc_update_raw_material)', () =>
  as('sales', `update calc_raw_materials set price_eur_per_kg = 1 where name = 'Zinc Glycinate'`), 'permission denied');
await fails('sales cannot add raw materials directly', () =>
  as('sales', `insert into calc_raw_materials (name, price_eur_per_kg) values ('X', 1)`), 'permission denied');
await ok('only admin edits the regulatory note', async () => {
  await as('sales', `update calc_raw_materials set regulatory_note = 'sales' where name = 'Zinc Glycinate'`);
  eq((await one('admin', `select regulatory_note from calc_raw_materials where name = 'Zinc Glycinate'`)).regulatory_note, null, 'after sales');
  await as('admin', `update calc_raw_materials set regulatory_note = 'checked' where name = 'Zinc Glycinate'`);
  eq((await one('sales', `select regulatory_note from calc_raw_materials where name = 'Zinc Glycinate'`)).regulatory_note, 'checked', 'after admin');
});
await ok('offer numbers run per year: NK-YYYY-0001, 0002', async () => {
  const y = new Date().getFullYear();
  eq((await one('sales', 'select calc_next_offer_no() as n')).n, `NK-${y}-0001`, 'first');
  eq((await one('admin', 'select calc_next_offer_no() as n')).n, `NK-${y}-0002`, 'second');
});
await fails('production cannot draw calculator offer numbers', () => as('production', 'select calc_next_offer_no()'), 'not allowed');
await ok('sales saves an offer; admin sees it, production does not', async () => {
  await as('sales', `insert into calc_offers (offer_no, receiver_name, receiver_email, data, results)
                     values ('NK-T-1', 'Anna', 'anna@test.com', '{}', '{}')`);
  eq((await as('admin', `select id from calc_offers where offer_no = 'NK-T-1'`)).length, 1, 'admin');
  eq((await as('production', `select id from calc_offers`)).length, 0, 'partner');
});
await ok('sales deletes only own offers, admin any', async () => {
  await as('admin', `insert into calc_offers (offer_no, receiver_name, receiver_email, data, results)
                     values ('NK-T-2', 'Bob', 'bob@test.com', '{}', '{}')`);
  eq((await as('sales', `delete from calc_offers where offer_no = 'NK-T-2' returning id`)).length, 0, 'sales on admin offer');
  eq((await as('sales', `delete from calc_offers where offer_no = 'NK-T-1' returning id`)).length, 1, 'sales on own offer');
  eq((await as('admin', `delete from calc_offers where offer_no = 'NK-T-2' returning id`)).length, 1, 'admin');
});
await ok('only admin changes calculator settings', async () => {
  eq((await as('sales', `update calc_settings set default_markup = 99 returning id`)).length, 0, 'sales');
  eq((await as('admin', `update calc_settings set default_markup = 35 returning id`)).length, 1, 'admin');
  eq(Number((await one('sales', 'select default_markup from calc_settings')).default_markup), 35, 'value');
});
await ok('sales adds a raw material that is not in the price list; marked manual', async () => {
  const { id } = await one('sales', `select calc_add_raw_material('  Saffron   Extract ', 1234.56789) as id`);
  const m = await one('admin', `select name, price_eur_per_kg, active, manual from calc_raw_materials where id = $1`, [id]);
  eq(m.name, 'Saffron Extract', 'name tidied');
  eq(Number(m.price_eur_per_kg), 1234.5679, 'price');
  eq(m.active && m.manual, true, 'active, manual');
});
await fails('a name already in the price list cannot be added again', () =>
  as('admin', `select calc_add_raw_material('zinc glycinate', 5)`), 'already in the price list');
await fails('a hand-added raw material needs a price above 0', () =>
  as('sales', `select calc_add_raw_material('Something', 0)`), 'price per kg above 0');
await fails('production cannot add raw materials', () =>
  as('production', `select calc_add_raw_material('Other', 5)`), 'not allowed');
await ok('sales changes the name and price of a raw material, then sets it inactive (nothing is deleted)', async () => {
  const { id } = await one('sales', `select calc_add_raw_material('Edit Me', 3) as id`);
  await as('sales', `select calc_update_raw_material($1, '  Edited   Name ', 4.56789)`, [id]);
  const m = await one('admin', `select name, price_eur_per_kg from calc_raw_materials where id = $1`, [id]);
  eq(m.name, 'Edited Name', 'name tidied');
  eq(Number(m.price_eur_per_kg), 4.5679, 'price');
  await as('sales', `select calc_set_raw_material_active($1, false)`, [id]);
  eq((await one('admin', `select active from calc_raw_materials where id = $1`, [id])).active, false, 'inactive, still there');
  await as('admin', `select calc_set_raw_material_active($1, true)`, [id]);
  eq((await one('sales', `select active from calc_raw_materials where id = $1`, [id])).active, true, 'active again');
});
await fails('a raw material cannot be renamed to a name already in the price list', async () => {
  const { id } = await one('admin', `select id from calc_raw_materials where name = 'Zinc Glycinate'`);
  await as('admin', `select calc_update_raw_material($1, 'saffron extract', 5)`, [id]);
}, 'already in the price list');
await fails('an edited raw material needs a price above 0', async () => {
  const { id } = await one('admin', `select id from calc_raw_materials where name = 'Zinc Glycinate'`);
  await as('sales', `select calc_update_raw_material($1, 'Zinc Glycinate', 0)`, [id]);
}, 'price per kg above 0');
await fails('a raw material cannot get an empty name', async () => {
  const { id } = await one('admin', `select id from calc_raw_materials where name = 'Zinc Glycinate'`);
  await as('sales', `select calc_update_raw_material($1, '   ', 5)`, [id]);
}, 'name');
await fails('production cannot change raw materials', async () => {
  const { id } = await one('admin', `select id from calc_raw_materials where name = 'Zinc Glycinate'`);
  await as('production', `select calc_update_raw_material($1, 'X', 5)`, [id]);
}, 'not allowed');
await fails('production cannot set a raw material inactive', async () => {
  const { id } = await one('admin', `select id from calc_raw_materials where name = 'Zinc Glycinate'`);
  await as('production', `select calc_set_raw_material_active($1, false)`, [id]);
}, 'not allowed');
await ok('production sees no catalog sync runs', async () => {
  eq((await as('production', 'select id from calc_catalog_sync_runs')).length, 0, 'production');
});
await ok('production cannot read catalog compositions', async () => {
  eq((await as('production', 'select composition from calc_catalog_products')).length, 0, 'production');
});
await fails('nobody writes the catalog sync log directly', () =>
  as('admin', `insert into calc_catalog_sync_runs (source, status) values ('manual', 'success')`), 'permission denied');
await ok('only admin changes the catalog sheet link', async () => {
  eq((await as('sales', `update calc_settings set catalog_sheet_url = 'x' returning id`)).length, 0, 'sales');
  eq((await one('sales', 'select catalog_sheet_url from calc_settings')).catalog_sheet_url.includes('1WE7F6aTC3jezBPPC8oEnDS_aCee1Hpd1FPthdpYdPF0'), true, 'default');
});
await ok('a calculator offer is for a CRM client; sales records the registered address', async () => {
  const c = await one('sales', `insert into clients (legal_name, country_code, registration_address)
                                values ('Offer Client Ltd', 'DE', 'Hauptstr. 1, Berlin') returning id`);
  const o = await one('sales', `insert into calc_offers (offer_no, receiver_name, receiver_email, client_id, data, results)
                                values ('NK-T-CL', 'Offer Client Ltd', '', $1, '{}', '{}') returning client_id`, [c.id]);
  eq(o.client_id, c.id, 'client');
  eq((await one('admin', 'select registration_address from clients where id = $1', [c.id])).registration_address, 'Hauptstr. 1, Berlin', 'address');
  eq((await as('production', 'select id from clients where id = $1', [c.id])).length, 0, 'production');
});

console.log('\nRecipes from calculator offers');
let rcpZg, rcpM2, rcpOffer, rcpFormula, rcpVersion;
const rcpRows = (zgAmount) => JSON.stringify({
  productType: 'capsules_glass', capsulesPerDose: '2', quantityPerUnit: '60', numberOfUnits: '1000',
  rows: [{ name: 'Zinc Glycinate', amount: String(zgAmount), unit: 'mg', materialId: rcpZg.mat },
         { name: rcpM2.name, amount: '200', unit: 'mg', materialId: rcpM2.mat }],
});
await ok('a calculator offer gets a recipe: matched items become lines, the rest waits for a stock item', async () => {
  rcpZg = { mat: (await one('admin', `select id from calc_raw_materials where name = 'Zinc Glycinate'`)).id };
  rcpZg.item = (await one('admin', `insert into items (sku, type, name, base_unit, novel_food_status, shelf_life_months)
                                    values ('RCP-ZG', 'raw_material', 'Zinc Glycinate', 'kg', 'not_novel', 24) returning id`)).id;
  const m2 = await one('admin', `select id, name from calc_raw_materials c where name <> 'Zinc Glycinate'
                                   and not exists (select 1 from items i where lower(i.name) = lower(c.name)) order by name limit 1`);
  rcpM2 = { mat: m2.id, name: m2.name };
  rcpOffer = (await one('sales', `insert into calc_offers (offer_no, receiver_name, receiver_email, client_id, product_name, product_type, data, results)
                                  values ('NK-T-RCP', 'Client', '', $1, 'Recipe Test', 'capsules_glass', $2::jsonb, '{}') returning id`,
    [client.id, rcpRows(15)])).id;
  rcpFormula = await one('sales', 'select * from formulas where calc_offer_id = $1', [rcpOffer]);
  eq(rcpFormula.name, 'Recipe Test', 'name'); eq(rcpFormula.product_format, 'capsule', 'format');
  eq(Number(rcpFormula.serving_size), 2, 'capsules per serving'); eq(rcpFormula.servings_per_pack, 30, 'servings');
  eq(rcpFormula.client_id, client.id, 'client');
  rcpVersion = (await one('sales', 'select id from formula_versions where formula_id = $1', [rcpFormula.id])).id;
  const lines = await as('sales', 'select item_id, amount::float as a, unit from formula_lines where version_id = $1', [rcpVersion]);
  eq(lines.map((l) => `${l.item_id === rcpZg.item}:${l.a}${l.unit}`).join(), 'true:15mg', 'lines');
  eq(Number((await one('sales', 'select overage_pct from formula_lines where version_id = $1', [rcpVersion])).overage_pct), 5, '5 % overage');
  const pend = await as('sales', 'select name, material_id, amount::float as a from formula_pending_lines where version_id = $1', [rcpVersion]);
  eq(pend.map((p) => `${p.name}:${p.a}:${p.material_id === rcpM2.mat}`).join(), `${rcpM2.name}:200:true`, 'pending');
});
await fails('a recipe with ingredients to link cannot be approved', async () => {
  await as('admin', 'update formula_versions set shelf_life_months = 24 where id = $1', [rcpVersion]);
  await as('admin', `update formula_versions set status = 'approved' where id = $1`, [rcpVersion]);
}, 'Link every ingredient');
await ok('saving the offer again rebuilds an untouched recipe', async () => {
  await as('sales', 'update calc_offers set data = $2::jsonb where id = $1', [rcpOffer, rcpRows(20)]);
  eq((await one('sales', 'select amount::float as a from formula_lines where version_id = $1', [rcpVersion])).a, 20, 'amount');
  eq((await as('sales', 'select id from formula_pending_lines where version_id = $1', [rcpVersion])).length, 1, 'still pending');
});
await ok('sales links the waiting ingredient; the link is remembered and the recipe is no longer rebuilt', async () => {
  rcpM2.item = (await one('admin', `insert into items (sku, type, name, base_unit, novel_food_status)
                                    values ('RCP-M2', 'raw_material', 'Recipe test material', 'kg', 'not_novel') returning id`)).id;
  const p = await one('sales', 'select id from formula_pending_lines where version_id = $1', [rcpVersion]);
  await as('sales', 'select link_recipe_pending_line($1, $2)', [p.id, rcpM2.item]);
  eq((await as('sales', 'select id from formula_pending_lines where version_id = $1', [rcpVersion])).length, 0, 'none pending');
  eq((await as('sales', 'select id from formula_lines where version_id = $1', [rcpVersion])).length, 2, 'two lines');
  eq(Number((await one('sales', 'select overage_pct from formula_lines where version_id = $1 and item_id = $2', [rcpVersion, rcpM2.item])).overage_pct), 5, 'linked line overage');
  eq((await one('sales', 'select item_id from calc_material_items where material_id = $1', [rcpM2.mat])).item_id, rcpM2.item, 'remembered');
  await as('sales', `update formula_lines set amount = 25 where version_id = $1 and item_id = $2`, [rcpVersion, rcpZg.item]);
  await as('sales', 'update calc_offers set data = $2::jsonb where id = $1', [rcpOffer, rcpRows(30)]);
  eq((await one('sales', 'select amount::float as a from formula_lines where version_id = $1 and item_id = $2', [rcpVersion, rcpZg.item])).a, 25, 'hand edit kept');
  eq((await one('sales', 'select offer_edited from formulas where id = $1', [rcpFormula.id])).offer_edited, true, 'edited');
});
await ok('the next offer with that material finds the stock item by itself; a catalog offer uses its composition', async () => {
  const o2 = (await one('sales', `insert into calc_offers (offer_no, receiver_name, receiver_email, data, results)
                                  values ('NK-T-RCP2', 'Client', '', $1::jsonb, '{}') returning id`, [rcpRows(10)])).id;
  const v2 = (await one('sales', 'select v.id from formula_versions v join formulas f on f.id = v.formula_id where f.calc_offer_id = $1', [o2])).id;
  eq((await as('sales', 'select id from formula_lines where version_id = $1', [v2])).length, 2, 'both lines');
  eq((await as('sales', 'select id from formula_pending_lines where version_id = $1', [v2])).length, 0, 'nothing pending');
  const o3 = (await one('sales', `insert into calc_offers (offer_no, receiver_name, receiver_email, product_type, data, results)
                                  values ('NK-T-RCP3', 'Client', '', 'powder', $1::jsonb, '{}') returning id`,
    [JSON.stringify({ mode: 'catalog', productType: 'powder', rows: [], catalog: { servings_per_container: 30, composition: [{ name: 'zinc glycinate', amount: 5, unit: 'g' }] } })])).id;
  const f3 = await one('sales', 'select id, product_format, serving_size::float as s, serving_unit, servings_per_pack from formulas where calc_offer_id = $1', [o3]);
  eq(`${f3.product_format}:${f3.s}${f3.serving_unit}:${f3.servings_per_pack}`, 'powder:5g:30', 'powder serving');
  eq((await one('sales', 'select count(*)::int as n from formula_lines l join formula_versions v on v.id = l.version_id where v.formula_id = $1', [f3.id])).n, 1, 'catalog line');
});
await ok('a recipe from an offer starts at 5 % overage, whatever waste the offer carries', async () => {
  const offer = async (waste) => (await one('sales', `insert into calc_offers (offer_no, receiver_name, receiver_email, data, results)
                                                      values ('NK-T-W' || $2, 'Client', '', $1::jsonb, '{}') returning id`,
    [JSON.stringify({ ...JSON.parse(rcpRows(10)), waste }), waste || 'empty'])).id;
  const overages = async (id) => (await as('sales', `select l.overage_pct::float as o from formula_lines l join formula_versions v on v.id = l.version_id
                                                       join formulas f on f.id = v.formula_id where f.calc_offer_id = $1`, [id])).map((r) => r.o).join();
  eq(await overages(await offer('2,5')), '5,5', 'typed');
  eq(await overages(await offer('')), '5,5', 'empty (new offers)');
  eq(await overages(await offer('150')), '5,5', 'any');
  eq(Number((await one('sales', 'select calc_offer_waste($1::jsonb) as w', [rcpRows(10)])).w), 5, 'older offer');
});
await ok('a recipe from an offer gets the capsule 00, the jar and the lid of the offer', async () => {
  const pack = async (no, extra) => {
    const o = await one('sales', `insert into calc_offers (offer_no, receiver_name, receiver_email, data, results)
                                  values ($1, 'Client', '', $2::jsonb, '{}') returning id`, [no, JSON.stringify({ ...JSON.parse(rcpRows(10)), ...extra })]);
    const r = await one('sales', `select s.sku as shell,
        (select string_agg(i.sku, ',' order by i.sku) from formula_packaging fp join items i on i.id = fp.item_id
          join formula_versions v on v.id = fp.version_id where v.formula_id = f.id) as pack
      from formulas f left join items s on s.id = f.shell_item_id where f.calc_offer_id = $1`, [o.id]);
    return `${r.shell}|${r.pack}`;
  };
  eq(await pack('NK-T-PK1', { productType: 'capsules_plastic', lid: 'plastic' }), 'PK-CAPS-00|PK-JAR-PL,PK-LID-PL', 'plastic jar, plastic lid');
  eq(await pack('NK-T-PK2', { productType: 'capsules_plastic', lid: 'aluminium' }), 'PK-CAPS-00|PK-JAR-PL,PK-LID-AL', 'aluminium lid');
  eq(await pack('NK-T-PK3', { productType: 'capsules_glass', lid: 'plastic' }), 'PK-CAPS-00|PK-JAR-GL,PK-LID-PL', 'glass jar');
  eq(await pack('NK-T-PK4', { productType: 'capsules_glass', catalogPackaging: true, lid: 'plastic' }), 'PK-CAPS-00|PK-JAR-GL,PK-LID-AL', 'catalog glass jar: aluminium lid');
  eq(await pack('NK-T-PK5', { productType: 'powder', quantityPerUnit: '30' }), 'null|null', 'powder');
});
await ok('the basic capsule, jar and lid are shown in the recipe only: not needed as materials', async () => {
  const v = await one('admin', `select v.id from formula_versions v join formulas f on f.id = v.formula_id
    join calc_offers o on o.id = f.calc_offer_id where o.offer_no = 'NK-T-PK1'`);
  const kinds = (await db.query('select kind from version_required_materials($1, 100) order by kind', [v.id])).rows.map((r) => r.kind);
  eq(kinds.join(), 'ingredient,ingredient', 'ingredients only');
});
await ok('production sees no recipes, links or waiting ingredients', async () => {
  for (const table of ['formulas', 'formula_lines', 'formula_pending_lines', 'calc_material_items']) {
    eq((await as('production', `select * from ${table}`)).length, 0, table);
  }
});
await fails('production cannot link ingredients', () =>
  as('production', 'select link_recipe_pending_line($1, $2)', [rcpVersion, rcpZg.item]), 'not allowed');
await fails('nobody runs the offer recipe sync directly', () =>
  as('sales', 'select calc_offer_recipe_sync($1)', [rcpOffer]), 'permission denied');

console.log('\nOrders from calculator offers');
let calcA, calcB, calcOrder;
const calcV = await one('admin', `select v.id from formula_versions v join formulas f on f.id = v.formula_id
  where v.status = 'approved' and f.client_id = $1 limit 1`, [client.id]);
const calcOffer = (no, clientId, units, price) => one('sales',
  `insert into calc_offers (offer_no, receiver_name, receiver_email, client_id, product_name, data, results)
   values ($1, 'Client', '', $2, $1 || ' product', jsonb_build_object('numberOfUnits', $3::text), jsonb_build_object('unitPrice', $4::numeric))
   returning id`, [no, clientId, units, price]);
await ok('an order takes another price level of the offer: a tier at its own markup, a catalog price step', async () => {
  const tiered = await one('sales',
    `insert into calc_offers (offer_no, receiver_name, receiver_email, client_id, product_name, data, results)
     values ('NK-T-TIER', 'Client', '', $1, 'Tiered', $2::jsonb, $3::jsonb) returning id`,
    [client.id, JSON.stringify({ numberOfUnits: '1000', priceTiers: [{ key: 'a', qty: '3 000', markup: '25' }, { key: 'b', qty: '5000', markup: '20,5' }] }),
     JSON.stringify({ unitPrice: 3.2, unitCost: 2.4567 })]);
  const levels = (qty, price) => JSON.stringify([{ offer_id: tiered.id, quantity: qty, unit_price: price }]);
  // 2.4567 × 1.205 = 2.96032… → 2.96
  const r = await one('sales', `select create_order_from_calc_offers($1, $2, '[]', 20, null, null, null, $3::jsonb) as id`,
    [client.id, [tiered.id], levels(5000, 2.96)]);
  const l = await one('sales', 'select quantity, unit_price::float as price from sales_order_lines where order_id = $1', [r.id]);
  eq(`${l.quantity}x${l.price}`, '5000x2.96', 'tier');
  await as('sales', `update sales_orders set status = 'cancelled' where id = $1`, [r.id]);
  let refused = '';
  try { await as('sales', `select create_order_from_calc_offers($1, $2, '[]', 20, null, null, null, $3::jsonb)`, [client.id, [tiered.id], levels(5000, 1)]); }
  catch (e) { refused = e.message; }
  eq(/no price level/.test(refused), true, 'a price that is not the tier\'s is refused');
  refused = '';
  try { await as('sales', `select create_order_from_calc_offers($1, $2, '[]', 20, null, null, null, $3::jsonb)`, [client.id, [tiered.id], levels(4000, 3)]); }
  catch (e) { refused = e.message; }
  eq(/no price level/.test(refused), true, 'a quantity that is not a tier is refused');
  const cat = await one('sales',
    `insert into calc_offers (offer_no, receiver_name, receiver_email, client_id, product_name, data, results)
     values ('NK-T-CATT', 'Client', '', $1, 'Catalog', $2::jsonb, '{"unitPrice": 4.1}'::jsonb) returning id`,
    [client.id, JSON.stringify({ mode: 'catalog', numberOfUnits: '1000', catalog: { tiers: [{ min_qty: 1000, price: 4.1 }, { min_qty: 3000, price: 3.6 }] } })]);
  const rc = await one('sales', `select create_order_from_calc_offers($1, $2, '[]', 20, null, null, null, $3::jsonb) as id`,
    [client.id, [cat.id], JSON.stringify([{ offer_id: cat.id, quantity: 3000, unit_price: 3.6 }])]);
  eq(`${(await one('sales', 'select quantity from sales_order_lines where order_id = $1', [rc.id])).quantity}`, '3000', 'catalog step');
  await as('sales', `update sales_orders set status = 'cancelled' where id = $1`, [rc.id]);
});
await ok('a price tier is a quantity with a discount on the unit price of the offer (owner, Nov 2026)', async () => {
  const off = await one('sales',
    `insert into calc_offers (offer_no, receiver_name, receiver_email, client_id, product_name, data, results)
     values ('NK-T-DISC', 'Client', '', $1, 'Discounted', $2::jsonb, $3::jsonb) returning id`,
    [client.id, JSON.stringify({ numberOfUnits: '1000', priceTiers: [{ key: 'a', qty: '3000', discount: '7,5', markup: '' }] }),
     JSON.stringify({ unitPrice: 3.21, unitCost: 2.4 })]);
  const levels = (qty, price) => JSON.stringify([{ offer_id: off.id, quantity: qty, unit_price: price }]);
  // 3.21 × 0.925 = 2.96925 → 2.97
  const r = await one('sales', `select create_order_from_calc_offers($1, $2, '[]', 20, null, null, null, $3::jsonb) as id`,
    [client.id, [off.id], levels(3000, 2.97)]);
  const l = await one('sales', 'select quantity, unit_price::float as price from sales_order_lines where order_id = $1', [r.id]);
  eq(`${l.quantity}x${l.price}`, '3000x2.97', 'discounted tier');
  await as('sales', `update sales_orders set status = 'cancelled' where id = $1`, [r.id]);
  let refused = '';
  // the old markup reading of the same tier (2.4 × 1.075 = 2.58) is not a price of this offer
  try { await as('sales', `select create_order_from_calc_offers($1, $2, '[]', 20, null, null, null, $3::jsonb)`, [client.id, [off.id], levels(3000, 2.58)]); }
  catch (e) { refused = e.message; }
  eq(/no price level/.test(refused), true, 'another price is refused');
});
await ok('a catalog product has price tiers too: a quantity with a discount on its catalog price (owner, Nov 2026)', async () => {
  const off = await one('sales',
    `insert into calc_offers (offer_no, receiver_name, receiver_email, client_id, product_name, data, results)
     values ('NK-T-CATD', 'Client', '', $1, 'Catalog tiered', $2::jsonb, '{"unitPrice": 4.1}'::jsonb) returning id`,
    [client.id, JSON.stringify({ mode: 'catalog', numberOfUnits: '1000', priceTiers: [{ key: 'a', qty: '2000', discount: '5', markup: '' }],
      catalog: { tiers: [{ min_qty: 1000, price: 4.1 }, { min_qty: 3000, price: 3.6 }] } })]);
  // 2000 falls in the 1000 step: 4.10 × 0.95 = 3.895 → 3.90
  const r = await one('sales', `select create_order_from_calc_offers($1, $2, '[]', 20, null, null, null, $3::jsonb) as id`,
    [client.id, [off.id], JSON.stringify([{ offer_id: off.id, quantity: 2000, unit_price: 3.9 }])]);
  const l = await one('sales', 'select quantity, unit_price::float as price from sales_order_lines where order_id = $1', [r.id]);
  eq(`${l.quantity}x${l.price}`, '2000x3.9', 'catalog tier');
  await as('sales', `update sales_orders set status = 'cancelled' where id = $1`, [r.id]);
  let refused = '';
  try { await as('sales', `select create_order_from_calc_offers($1, $2, '[]', 20, null, null, null, $3::jsonb)`,
    [client.id, [off.id], JSON.stringify([{ offer_id: off.id, quantity: 2500, unit_price: 3.9 }])]); } catch (e) { refused = e.message; }
  eq(/no price level/.test(refused), true, 'a quantity that is neither a step nor a tier is refused');
});
await ok('the offer of a cancelled order can be deleted; the order line keeps its product and price', async () => {
  const line = await one('sales', `select l.id, l.order_id from sales_order_lines l join calc_offers co on co.id = l.calc_offer_id
    where co.offer_no = 'NK-T-CATT'`);
  eq((await as('sales', `delete from calc_offers where offer_no = 'NK-T-CATT' returning id`)).length, 1, 'deleted');
  const l = await one('sales', 'select kind, calc_offer_id, description, quantity, unit_price::float as price from sales_order_lines where id = $1', [line.id]);
  eq(`${l.kind}:${l.calc_offer_id}:${l.description}:${l.quantity}x${l.price}`, 'calc_offer:null:Catalog:3000x3.6', 'line kept');
  eq((await one('sales', 'select status from sales_orders where id = $1', [line.order_id])).status, 'cancelled', 'order');
});
await ok('sales creates an unpaid order from two calculator offers and services', async () => {
  calcA = await calcOffer('NK-T-OA', client.id, 1000, 4.5);
  calcB = await calcOffer('NK-T-OB', client.id, 500, 6);
  const r = await one('sales', `select create_order_from_calc_offers($1, $2, $3::jsonb, 20, 'PO-1') as id`,
    [client.id, [calcA.id, calcB.id], JSON.stringify([{ description: 'Free Sale Certificate', quantity: 1, unit_price: 300 }])]);
  calcOrder = await one('sales', 'select * from sales_orders where id = $1', [r.id]);
  eq(calcOrder.status, 'unpaid', 'status'); eq(calcOrder.vat_pct, '20.00', 'vat');
  const lines = await as('sales', 'select kind, description, quantity, unit_price::float as price from sales_order_lines where order_id = $1 order by sort_order', [r.id]);
  eq(lines.map(l => `${l.kind}:${l.quantity}x${l.price}`).join(','), 'calc_offer:1000x4.5,calc_offer:500x6,service:1x300', 'lines');
  const ov = await one('sales', 'select line_count, total_packs from sales_order_overview where id = $1', [r.id]);
  eq(ov.line_count, 2, 'products only'); eq(ov.total_packs, 1500, 'packs');
});
await fails('the offer of an order that is not cancelled cannot be deleted', () =>
  as('admin', `delete from calc_offers where offer_no = 'NK-T-OA'`), 'can no longer be changed');
await fails('an offer already in an order cannot be ordered again', () =>
  as('sales', 'select create_order_from_calc_offers($1, $2)', [client.id, [calcA.id]]), 'already in an order');
await ok('the calculator sees which offers are locked by an order (offerState)', async () => {
  const state = (id) => as('sales', `select exists (select 1 from sales_order_lines l join sales_orders so on so.id = l.order_id
                                                     where l.calc_offer_id = o.id and so.status <> 'cancelled') as locked
                                       from calc_offers o where o.id = $1`, [id]);
  eq((await state(calcA.id))[0].locked, true, 'in an order');
  const free = await calcOffer('NK-T-OF', client.id, 100, 5);
  eq((await state(free.id))[0].locked, false, 'not in an order');
  eq((await state('00000000-0000-4000-8000-0000000000ff')).length, 0, 'missing');
});
await fails('an offer of another client cannot be ordered', async () => {
  const x = await calcOffer('NK-T-OX', client2.id, 100, 5);
  await as('sales', 'select create_order_from_calc_offers($1, $2)', [client.id, [x.id]]);
}, 'another client');
await fails('an offer in an order cannot be changed', () =>
  as('sales', `update calc_offers set product_name = 'X' where id = $1`, [calcA.id]), 'in an order');
await fails('production cannot create orders from calculator offers', () =>
  as('production', 'select create_order_from_calc_offers($1, $2)', [client.id, [calcB.id]]), 'not allowed|permission');
await fails('only admin confirms the payment', () =>
  as('sales', `update sales_orders set status = 'confirmed' where id = $1`, [calcOrder.id]), 'only admin confirms');
await fails('a line cannot be linked to a formula before the payment', async () => {
  const l = await one('admin', `select id from sales_order_lines where calc_offer_id = $1`, [calcA.id]);
  await as('admin', 'select link_order_line_formula($1, $2)', [l.id, calcV.id]);
}, 'confirm the payment');
await fails('an unpaid order has no invoice', () =>
  as('sales', 'select create_order_invoice($1)', [calcOrder.id]), 'payment is confirmed');
await ok('admin confirms the payment: paid in full', async () => {
  await as('admin', `select confirm_order_payment($1, 'full')`, [calcOrder.id]);
  const o = await one('admin', 'select status, deposit_received_on, balance_received_on from sales_orders where id = $1', [calcOrder.id]);
  eq(o.status, 'confirmed', 'status'); eq(!!o.deposit_received_on && !!o.balance_received_on, true, 'paid');
});
await fails('an order from calculator offers does not go back to draft', () =>
  as('admin', `update sales_orders set status = 'draft' where id = $1`, [calcOrder.id]), 'back to draft');
await fails('sales cannot link a line to a formula', async () => {
  const l = await one('sales', `select id from sales_order_lines where calc_offer_id = $1`, [calcA.id]);
  await as('sales', 'select link_order_line_formula($1, $2)', [l.id, calcV.id]);
}, 'not allowed|permission');
await ok('admin links the line to an approved formula: a project opens and production can be planned', async () => {
  const l = await one('admin', `select id from sales_order_lines where calc_offer_id = $1`, [calcA.id]);
  const p = (await one('admin', 'select link_order_line_formula($1, $2) as id', [l.id, calcV.id])).id;
  const proj = await one('admin', 'select client_id, name, status from projects where id = $1', [p]);
  eq(proj.client_id, client.id, 'client'); eq(proj.name, 'NK-T-OA product', 'name'); eq(proj.status, 'order', 'stage');
  const m = await one('admin', 'insert into manufacturing_orders (sales_order_line_id, quantity) values ($1, 1000) returning formula_version_id, project_id', [l.id]);
  eq(m.formula_version_id, calcV.id, 'formula'); eq(m.project_id, p, 'project');
});
await fails('a planned line keeps its formula', async () => {
  const l = await one('admin', `select id from sales_order_lines where calc_offer_id = $1`, [calcA.id]);
  await as('admin', 'select link_order_line_formula($1, $2)', [l.id, calcV.id]);
}, 'already planned');
await fails('a service line is never linked to a formula', async () => {
  const l = await one('admin', `select id from sales_order_lines where order_id = $1 and kind = 'service'`, [calcOrder.id]);
  await as('admin', 'select link_order_line_formula($1, $2)', [l.id, calcV.id]);
}, 'only a calculator line');
await ok('production sees no calculator orders', async () => {
  eq((await as('production', 'select * from sales_order_lines')).length, 0, 'lines');
  eq((await as('production', 'select * from sales_order_overview')).length, 0, 'overview');
});

console.log('\nInvoices');
let inv;
await ok('a paid order gets one draft invoice with its lines, opened again on the second call', async () => {
  inv = (await one('sales', 'select create_order_invoice($1) as id', [calcOrder.id])).id;
  eq((await one('sales', 'select create_order_invoice($1) as id', [calcOrder.id])).id, inv, 'same draft');
  const i = await one('sales', 'select status, number, vat_pct::float as vat, tax_point_date is not null as tp from invoices where id = $1', [inv]);
  eq(i.status, 'draft', 'status'); eq(i.number, null, 'no number yet'); eq(i.vat, 20, 'vat'); eq(i.tp, true, 'tax point');
  const lines = await as('sales', 'select kind, quantity::int as q, amount::float as a from invoice_lines where invoice_id = $1 order by sort_order', [inv]);
  eq(lines.map(l => `${l.kind}:${l.q}:${l.a}`).join(','), 'calc_offer:1000:4500,calc_offer:500:3000,service:1:300', 'lines');
});
await fails('nobody writes invoices directly', () =>
  as('admin', `update invoices set vat_pct = 0 where id = $1`, [inv]), 'permission denied');
await fails('sales cannot issue with another number than the next one', async () => {
  await as('admin', `update number_series set next_number = 1000000041 where key = 'invoice'`);
  await as('sales', `select issue_invoice($1, '1000000050', current_date)`, [inv]);
}, 'only admin');
await fails('admin confirms a number that is not the next one', () =>
  as('admin', `select issue_invoice($1, '1000000050', current_date)`, [inv]), 'confirm it');
await fails('the number has 10 digits', () =>
  as('sales', `select issue_invoice($1, '41', current_date)`, [inv]), '10 digits');
await ok('sales issues with the next number: totals fixed, series moves on', async () => {
  eq((await one('sales', `select issue_invoice($1, next_invoice_number(), current_date) as n`, [inv])).n, '1000000041', 'number');
  const i = await one('sales', 'select status, subtotal::float as s, vat_amount::float as v, total::float as t, buyer ->> \'name\' as buyer from invoices where id = $1', [inv]);
  eq(i.status, 'issued', 'status'); eq(i.s, 7800, 'subtotal'); eq(i.v, 1560, 'vat'); eq(i.t, 9360, 'total'); eq(!!i.buyer, true, 'buyer');
  eq((await one('sales', 'select next_invoice_number() as n')).n, '1000000042', 'next');
});
await fails('an issued invoice cannot be changed', () =>
  as('admin', `select issue_invoice($1, '1000000042', current_date)`, [inv]), 'already issued');
await fails('an issued invoice is locked even for the database owner', () =>
  db.query(`update invoices set total = 1 where id = $1`, [inv]), 'credit or debit note');
await fails('an invoice number is never used twice', async () => {
  const o = (await db.query(`insert into sales_orders (client_id) values ($1) returning id`, [client.id])).rows[0];
  const d = (await db.query(`insert into invoices (order_id, client_id, currency, seller, buyer) values ($1, $2, 'EUR', '{}', '{}') returning id`, [o.id, client.id])).rows[0];
  await db.query(`insert into invoice_lines (invoice_id, kind, description, quantity, unit_price, amount) values ($1, 'service', 'X', 1, 1, 1)`, [d.id]);
  await as('admin', `select issue_invoice($1, '1000000041', current_date, true)`, [d.id]);
}, 'already used');
await ok('production sees no invoices', async () => {
  eq((await as('production', 'select * from invoices')).length, 0, 'invoices');
  eq((await as('production', 'select * from invoice_lines')).length, 0, 'lines');
  eq((await one('production', 'select next_invoice_number() as n')).n, null, 'series');
});
await fails('production cannot open an invoice', () =>
  as('production', 'select create_order_invoice($1)', [calcOrder.id]), 'not allowed');

console.log('\nExpected deliveries and stock counts');
let edItem, edSupplier, edReq, ed1, ed2, edLot;
await db.query('update company_settings set require_waybill_photo = false'); // the photo rule is tested further down
await ok('admin records an expected delivery with a code', async () => {
  edItem = await one('admin', `insert into items (sku, type, name, base_unit, novel_food_status, shelf_life_months)
                                   values ('RM-ED', 'raw_material', 'Delivery test extract', 'kg', 'not_novel', 24) returning id`);
  edSupplier = await one('admin', `insert into suppliers (name) values ('Delivery Supplier Ltd') returning id`);
  ed1 = await one('admin', `select create_expected_delivery($1, 50, $2, current_date + 7, 12.5, 'PO-778', $3) as id`,
                  [edItem.id, edSupplier.id, L['NK-WH']]);
  const d = await one('admin', 'select code, status from expected_deliveries where id = $1', [ed1.id]);
  eq(d.code, 'ED-00001', 'code');
  eq(d.status, 'open', 'status');
});
await ok('incoming and projected stock show on the item summary', async () => {
  const s = await one('sales', 'select incoming, projected, available from item_stock_summary where item_id = $1', [edItem.id]);
  eq(Number(s.incoming), 50, 'incoming');
  eq(Number(s.projected), Number(s.available) + 50, 'projected');
});
await ok('sales without the price flag sees incoming totals but not the delivery', async () => {
  eq((await as('sales', 'select id from expected_deliveries')).length, 0, 'deliveries');
  eq((await as('sales', 'select id from expected_delivery_overview')).length, 0, 'overview');
  eq((await as('sales', 'select item_id from item_incoming where item_id = $1', [edItem.id])).length, 1, 'item_incoming');
});
await ok('production sees no deliveries and no incoming totals', async () => {
  eq((await as('production', 'select id from expected_deliveries')).length, 0, 'deliveries');
  eq((await as('production', 'select item_id from item_incoming')).length, 0, 'item_incoming');
  eq(Number((await one('production', 'select incoming from item_stock_summary where item_id = $1', [edItem.id])).incoming), 0, 'summary');
});
await fails('sales cannot record a delivery', () =>
  as('sales', 'select create_expected_delivery($1, 5)', [edItem.id]), 'not allowed');
await fails('production cannot record a delivery', () =>
  as('production', 'select create_expected_delivery($1, 5)', [edItem.id]), 'not allowed');
await fails('deliveries cannot be inserted directly', () =>
  as('admin', `insert into expected_deliveries (code, item_id, quantity) values ('X', $1, 1)`, [edItem.id]), 'row-level security');
await fails('status cannot be changed by a plain update', () =>
  as('admin', `update expected_deliveries set status = 'received' where id = $1`, [ed1.id]), 'receive_expected_delivery');
await ok('admin changes the date of an open delivery', async () => {
  eq((await as('admin', `update expected_deliveries set expected_on = current_date - 2 where id = $1 returning id`, [ed1.id])).length, 1, 'updated');
  eq((await one('admin', 'select is_overdue from expected_delivery_overview where id = $1', [ed1.id])).is_overdue, true, 'overdue');
});
await ok('a partial receipt makes a released lot at the delivery price and keeps it open', async () => {
  edLot = await one('admin', `select receive_expected_delivery($1, $2, 20, 'SUP-ED-1') as id`, [ed1.id, L['NK-WH']]);
  const l = await one('admin', `select l.qc_status, l.expected_delivery_id, c.unit_cost from lots l
                                  left join lot_costs c on c.lot_id = l.id where l.id = $1`, [edLot.id]);
  eq(l.qc_status, 'released', 'qc');
  eq(l.expected_delivery_id, ed1.id, 'linked');
  eq(Number(l.unit_cost), 12.5, 'cost');
  const d = await one('admin', 'select status, received, remaining, is_partial from expected_delivery_overview where id = $1', [ed1.id]);
  eq(d.status, 'open', 'status');
  eq(Number(d.received), 20, 'received');
  eq(Number(d.remaining), 30, 'remaining');
  eq(d.is_partial, true, 'partial');
  eq(Number((await one('sales', 'select incoming from item_stock_summary where item_id = $1', [edItem.id])).incoming), 30, 'incoming');
});
await ok('receiving the rest closes the delivery', async () => {
  await as('admin', 'select receive_expected_delivery($1, $2, 30)', [ed1.id, L['NK-WH']]);
  eq((await one('admin', 'select status from expected_deliveries where id = $1', [ed1.id])).status, 'received', 'status');
  eq(Number((await one('sales', 'select incoming from item_stock_summary where item_id = $1', [edItem.id])).incoming), 0, 'incoming');
});
await fails('a closed delivery cannot be received again', () =>
  as('admin', 'select receive_expected_delivery($1, $2, 1)', [ed1.id, L['NK-WH']]), 'is received');
await fails('a closed delivery cannot be edited', () =>
  as('admin', 'update expected_deliveries set note = $2 where id = $1', [ed1.id, 'x']), 'cannot be changed');
await ok('a delivery from a purchase request orders it, and receiving marks it received', async () => {
  edReq = await one('admin', `insert into purchase_requests (item_id, quantity) values ($1, 10) returning id`, [edItem.id]);
  ed2 = await one('admin', 'select create_expected_delivery(null, null, $2, null, null, null, $3, $1) as id', [edReq.id, edSupplier.id, L['NK-WH']]);
  eq((await one('admin', 'select status from purchase_requests where id = $1', [edReq.id])).status, 'ordered', 'ordered');
  eq(Number((await one('admin', 'select quantity from expected_deliveries where id = $1', [ed2.id])).quantity), 10, 'quantity from request');
  await as('admin', 'select receive_expected_delivery($1, $2, 8, null, null, null, null, true)', [ed2.id, L['NK-WH']]);
  eq((await one('admin', 'select status from expected_deliveries where id = $1', [ed2.id])).status, 'received', 'closed short');
  eq((await one('admin', 'select status from purchase_requests where id = $1', [edReq.id])).status, 'received', 'request');
});
await ok('cancelling the only delivery of a request puts the request back to open', async () => {
  const r = await one('admin', `insert into purchase_requests (item_id, quantity) values ($1, 4) returning id`, [edItem.id]);
  const d = await one('admin', 'select create_expected_delivery(null, null, null, null, null, null, null, $1) as id', [r.id]);
  await as('admin', 'select cancel_expected_delivery($1)', [d.id]);
  eq((await one('admin', 'select status from expected_deliveries where id = $1', [d.id])).status, 'cancelled', 'cancelled');
  eq((await one('admin', 'select status from purchase_requests where id = $1', [r.id])).status, 'open', 'request open');
});
await fails('sales cannot cancel a delivery', () =>
  as('sales', 'select cancel_expected_delivery($1)', [ed2.id]), 'not allowed');

await ok('admin counts a lot: the difference is posted as an adjustment', async () => {
  const diff = await one('admin', `select count_stock($1, $2, 17.5, 'Shelf count') as d`, [edLot.id, L['NK-WH']]);
  eq(Number(diff.d), -2.5, 'difference');
  const m = await one('admin', `select quantity, reason from stock_movements where lot_id = $1 and type = 'adjustment'`, [edLot.id]);
  eq(Number(m.quantity), -2.5, 'movement');
  eq(m.reason, 'Stock count: Shelf count', 'reason');
  eq(Number((await one('admin', 'select count_stock($1, $2, 17.5) as d', [edLot.id, L['NK-WH']])).d), 0, 'second count matches');
});
await fails('sales cannot count stock', () =>
  as('sales', 'select count_stock($1, $2, 1)', [edLot.id, L['NK-WH']]), 'not allowed');
await fails('production cannot count stock in the Nutrikal warehouse', () =>
  as('production', 'select count_stock($1, $2, 1)', [edLot.id, L['NK-WH']]), 'production locations');
await ok('a production count is posted directly, also in quarantine', async () => {
  const pl = await one('production', `select receive_lot($1, $2, 10) as id`, [edItem.id, L['G-PRO']]);
  eq(Number((await one('production', `select count_stock($1, $2, 9, 'Bag torn') as d`, [pl.id, L['G-PRO']])).d), -1, 'difference');
  eq(Number((await one('admin', 'select sum(quantity) as q from stock_movements where lot_id = $1', [pl.id])).q), 9, 'balance');
});
await fails('a count below zero is refused', () =>
  as('admin', 'select count_stock($1, $2, -1)', [edLot.id, L['NK-WH']]), 'zero or more');

console.log('\nProduction: deliveries and waybill photos');
let pd, pdWh, pdLot;
const attach = (user, deliveryId, name = 'w.jpg') =>
  one(user, `insert into delivery_attachments (delivery_id, storage_path, kind) values ($1, $2, 'waybill') returning id`,
      [deliveryId, deliveryId + '/' + name]);
await ok('admin orders a delivery to production; production is notified', async () => {
  await db.query('update company_settings set require_waybill_photo = true');
  pd = await one('admin', `select create_expected_delivery($1, 40, $2, current_date + 3, 9.9, 'PO-9', $3) as id`, [edItem.id, edSupplier.id, L['G-PRO']]);
  pdWh = await one('admin', `select create_expected_delivery($1, 5, $2, current_date + 3, 9.9, null, $3) as id`, [edItem.id, edSupplier.id, L['NK-WH']]);
  const n = await as('production', `select params, link from notifications where kind = 'delivery_ordered'`);
  eq(n.length, 1, 'one notification (not for the warehouse delivery)'); eq(Number(n[0].params.quantity), 40, 'quantity');
});
await ok('production sees deliveries to its locations with supplier, without price', async () => {
  const rows = await as('production', 'select * from production_deliveries');
  eq(rows.length, 1, 'only its delivery'); eq(rows[0].id, pd.id, 'delivery');
  eq(rows[0].supplier, 'Delivery Supplier Ltd', 'supplier');
  eq(Object.keys(rows[0]).some(k => k.includes('price') || k.includes('client')), false, 'no price or client column');
  eq((await as('production', 'select id from expected_deliveries')).length, 0, 'table still hidden');
  eq((await as('sales', 'select id from production_deliveries')).length, 0, 'not for sales');
});
await fails('production cannot change price or supplier', () =>
  as('production', 'select update_delivery_terms($1, null, 40, 1)', [pd.id]), 'not allowed');
await ok('production cannot edit the delivery table either', async () => {
  eq((await as('production', 'update expected_deliveries set unit_price = 1 where id = $1 returning id', [pd.id])).length, 0, 'no rows');
});
await fails('receiving needs a waybill photo', () =>
  as('production', 'select receive_expected_delivery($1, null, 40)', [pd.id]), 'photo of the waybill');
await fails('production cannot add files to a warehouse delivery', () =>
  attach('production', pdWh.id), 'row-level security');
await fails('a file path must start with its delivery', () =>
  as('production', `insert into delivery_attachments (delivery_id, storage_path) values ($1, 'other/x.jpg')`, [pd.id]), 'path_chk');
await fails('production cannot receive a warehouse delivery', () =>
  as('production', 'select receive_expected_delivery($1, null, 5)', [pdWh.id]), 'not found');
await ok('production receives with a photo: released lot in G-PRO at the delivery price, admins notified', async () => {
  await attach('production', pd.id, 'a.jpg');
  await attach('production', pd.id, 'b.jpg');
  pdLot = await one('production', `select receive_expected_delivery($1, $2, 40, 'SUP-PF-1', null, current_date + 400) as id`, [pd.id, L['G-PRO']]);
  const l = await one('admin', `select l.qc_status, l.supplier_lot, l.expires_on = current_date + 400 as exp, c.unit_cost
                                  from lots l left join lot_costs c on c.lot_id = l.id where l.id = $1`, [pdLot.id]);
  eq(l.qc_status, 'released', 'released'); eq(l.supplier_lot, 'SUP-PF-1', 'supplier lot'); eq(l.exp, true, 'expiry');
  eq(Number(l.unit_cost), 9.9, 'cost');
  eq(Number((await one('admin', 'select sum(quantity) as q from stock_movements where lot_id = $1 and location_id = $2', [pdLot.id, L['G-PRO']])).q), 40, 'in G-PRO');
  eq((await one('admin', 'select status from expected_deliveries where id = $1', [pd.id])).status, 'received', 'received');
  eq((await as('admin', 'select id from delivery_attachments where lot_id = $1', [pdLot.id])).length, 2, 'photos on the lot');
  const n = await one('admin', `select params from notifications where kind = 'delivery_received'`);
  eq(n.params.photos, 2, 'photos in the notification');
});
await fails('production cannot release the received lot', () =>
  as('production', `select set_lot_qc_status($1, 'released')`, [pdLot.id]), 'not allowed');
await ok('production deletes only its own files, within 24 hours', async () => {
  const mine = await attach('production', pd.id, 'c.jpg');
  const old = await attach('production', pd.id, 'd.jpg');
  const admins = await attach('admin', pd.id, 'e.jpg');
  await db.query(`update delivery_attachments set uploaded_at = now() - interval '25 hours' where id = $1`, [old.id]);
  eq((await as('production', 'delete from delivery_attachments where id = $1 returning id', [admins.id])).length, 0, 'not another user\'s file');
  eq((await as('production', 'delete from delivery_attachments where id = $1 returning id', [old.id])).length, 0, 'not after 24 hours');
  eq((await as('production', 'delete from delivery_attachments where id = $1 returning id', [mine.id])).length, 1, 'own fresh file');
  eq((await as('admin', 'delete from delivery_attachments where id = $1 returning id', [old.id])).length, 0, 'admin keeps the evidence');
});
await ok('sales sees no delivery files', async () => {
  eq((await as('sales', 'select id from delivery_attachments')).length, 0, 'files');
});
await ok('admin changes supplier and price of a received delivery; the lot follows', async () => {
  const s = await one('admin', `insert into suppliers (name) values ('Cheaper Supplier') returning id`);
  await as('admin', 'select update_delivery_terms($1, $2, 40, 8.5)', [pd.id, s.id]);
  const l = await one('admin', `select l.supplier_id, c.unit_cost from lots l join lot_costs c on c.lot_id = l.id where l.id = $1`, [pdLot.id]);
  eq(l.supplier_id, s.id, 'lot supplier'); eq(Number(l.unit_cost), 8.5, 'lot cost');
  eq((await as('admin', `select id from audit_log where table_name = 'expected_deliveries' and row_id = $1::text`, [pd.id])).length > 0, true, 'logged');
});
await ok('production never sees client names or sales prices', async () => {
  for (const t of ['clients', 'contacts', 'sales_orders', 'sales_order_lines', 'offers', 'offer_tiers', 'calc_offers',
                   'sales_order_overview', 'sales_order_line_overview', 'supplier_prices', 'current_supplier_prices']) {
    eq((await as('production', `select * from ${t}`)).length, 0, t);
  }
  const cols = async (sql) => Object.keys((await as('production', sql))[0] ?? {});
  for (const c of [...await cols('select * from production_projects'), ...await cols('select * from production_manufacturing_orders'),
                   ...await cols('select * from production_deliveries'), ...await cols(`select * from mo_material_sources('${mo.id}')`)]) {
    if (/client|sale|offer|customer/.test(c)) throw new Error(`column ${c} visible to production`);
  }
});
await ok('production sees purchase prices only through the materials of its orders', async () => {
  eq((await as('production', 'select * from lot_costs')).length, 0, 'lot costs table');
  eq((await as('production', 'select * from suppliers')).length, 0, 'suppliers table');
});
await fails('production cannot see the sources of an order not sent to it', () =>
  as('production', 'select * from mo_material_sources($1)', [mo2.id]), 'not allowed');

console.log('\nPurchase orders');
let poSup, poItem, poId;
const shortage = async (user = 'admin') => (await as(user, 'select * from purchase_shortages where item_id = $1', [poItem]))[0];
await ok('an item under its minimum is missing, with its preferred supplier and price', async () => {
  poSup = (await one('admin', `insert into suppliers (name) values ('PO Test Supplier') returning id`)).id;
  poItem = (await one('admin', `insert into items (sku, type, name, base_unit, novel_food_status, reorder_level)
                                values ('PO-RM', 'raw_material', 'PO test material', 'kg', 'not_novel', 10) returning id`)).id;
  const si = (await one('admin', 'insert into supplier_items (supplier_id, item_id, is_preferred) values ($1, $2, true) returning id', [poSup, poItem])).id;
  await as('admin', 'insert into supplier_prices (supplier_item_id, price) values ($1, 12)', [si]);
  const s = await shortage();
  eq(`${s.source}:${Number(s.quantity)}:${s.supplier_id === poSup}:${Number(s.unit_price)}`, 'low_stock:10:true:12', 'shortage');
});
await ok('production does not see missing materials or purchase orders', async () => {
  eq((await as('production', 'select * from purchase_shortages')).length, 0, 'shortages');
  eq((await as('production', 'select * from purchase_orders')).length, 0, 'orders');
  eq((await as('production', 'select * from purchase_order_lines')).length, 0, 'lines');
});
await fails('sales cannot generate purchase orders', () =>
  as('sales', 'select generate_purchase_orders($1::jsonb)', [JSON.stringify([{ item_id: poItem, quantity: 10, supplier_id: poSup }])]), 'not allowed');
await fails('every chosen line needs a supplier', () =>
  as('admin', 'select generate_purchase_orders($1::jsonb)', [JSON.stringify([{ item_id: poItem, quantity: 10 }])]), 'supplier');
await ok('admin generates a draft purchase order per supplier; the item is no longer missing', async () => {
  const ids = (await one('admin', 'select generate_purchase_orders($1::jsonb) as ids',
    [JSON.stringify([{ item_id: poItem, quantity: 10, supplier_id: poSup, unit_price: 12 }])])).ids;
  eq(ids.length, 1, 'one order'); poId = ids[0];
  const po = await one('admin', 'select code, status, supplier_id from purchase_orders where id = $1', [poId]);
  eq(/^PO-\d{5}$/.test(po.code) && po.status === 'draft' && po.supplier_id === poSup, true, `draft ${po.code}`);
  eq(await shortage(), undefined, 'not missing while on a draft');
});
await ok('admin changes the draft and sends it: every line becomes an expected delivery with the order number', async () => {
  await as('admin', 'update purchase_order_lines set quantity = 15 where purchase_order_id = $1', [poId]);
  await as('admin', `update purchase_orders set expected_on = current_date + 14 where id = $1`, [poId]);
  await as('admin', 'select send_purchase_order($1)', [poId]);
  const po = await one('admin', 'select code, status from purchase_orders where id = $1', [poId]);
  eq(po.status, 'sent', 'sent');
  const d = await one('admin', `select d.quantity, d.po_reference, d.supplier_id, d.unit_price from purchase_order_lines l
                                 join expected_deliveries d on d.id = l.expected_delivery_id where l.purchase_order_id = $1`, [poId]);
  eq(`${Number(d.quantity)}:${d.po_reference === po.code}:${d.supplier_id === poSup}:${Number(d.unit_price)}`, '15:true:true:12', 'delivery');
  eq(await shortage(), undefined, 'on the way, not missing');
});
await fails('a sent purchase order is locked', () =>
  as('admin', 'update purchase_order_lines set quantity = 1 where purchase_order_id = $1', [poId]), 'cannot be changed');
await fails('a sent purchase order cannot be cancelled here', () => as('admin', 'select cancel_purchase_order($1)', [poId]), 'Only a draft');
await ok('admin cancels a draft', async () => {
  const id = (await one('admin', 'select (generate_purchase_orders($1::jsonb))[1] as id',
    [JSON.stringify([{ item_id: poItem, quantity: 1, supplier_id: poSup }])])).id;
  await as('admin', 'select cancel_purchase_order($1)', [id]);
  eq((await one('admin', 'select status from purchase_orders where id = $1', [id])).status, 'cancelled', 'cancelled');
});

console.log('\nOpening stock import (Supplements Inventory sheet)');
await ok('the import loads every ingredient with its opening stock, price and supplier', async () => {
  const before = (await db.query('select count(*)::int as n from items')).rows[0].n;
  await db.exec(readFileSync(join(here, '..', 'supabase', 'import', 'opening_stock.sql'), 'utf8'));
  eq((await db.query('select count(*)::int as n from items')).rows[0].n - before, 163, 'items');
  eq((await db.query(`select count(*)::int as n from stock_movements where type = 'opening_balance'`)).rows[0].n, 144, 'opening balances');
  const mg = (await db.query(`select s.on_hand, s.available, c.unit_cost, sup.name as supplier
                                from items i join item_stock_summary s on s.item_id = i.id
                                join lots l on l.item_id = i.id join lot_costs c on c.lot_id = l.id
                                left join suppliers sup on sup.id = l.supplier_id
                               where i.name = 'Biotin'`)).rows[0];
  eq(Number(mg.on_hand), 0.378, 'on hand');
  eq(Number(mg.available), 0.378, 'released and available');
  eq(Number(mg.unit_cost), 18.66, 'lot cost = average purchase price');
  eq(mg.supplier, 'Grherb Biotech Co Ltd', 'supplier');
  eq((await db.query(`select count(*)::int as n from suppliers where lower(name) like 'astron%'`)).rows[0].n, 1, 'supplier spellings merged');
  eq((await db.query(`select type from items where name = 'Magnesium Stearate'`)).rows[0].type, 'excipient', 'excipient');
  eq((await db.query(`select count(*)::int as n from lots l join items i on i.id = l.item_id where i.name like 'Harpagophytum%'`)).rows[0].n, 0, 'negative quantity: no stock');
});
await ok('running the import twice adds nothing', async () => {
  const n = (await db.query('select count(*)::int as n from stock_movements')).rows[0].n;
  await db.exec(readFileSync(join(here, '..', 'supabase', 'import', 'opening_stock.sql'), 'utf8'));
  eq((await db.query('select count(*)::int as n from stock_movements')).rows[0].n, n, 'movements');
});
await ok('production sees imported items but not their prices or suppliers', async () => {
  eq((await as('production', `select id from items where name = 'Biotin'`)).length, 1, 'item');
  eq((await as('production', `select * from supplier_prices`)).length, 0, 'prices');
  eq((await as('production', `select * from lot_costs`)).length, 0, 'lot costs');
});

console.log('\nOrder tasks');
let tkClient, tkItem, tkJar, tkVer, tkA, tkB, boardA, boardB, tkFinal;
const tk = (order, key) => one('admin', `select t.* from order_tasks t join order_task_boards b on b.id = t.board_id
                                           where b.sales_order_id = $1 and t.template_key = $2`, [order, key]);
const tkStatus = async (order, key) => (await tk(order, key))?.status;
await ok('setup: a client, a recipe with one raw material and a jar, two unpaid orders', async () => {
  tkClient = await one('sales', `insert into clients (legal_name, country_code, owner_id) values ('Task Client Ltd', 'DE', $1) returning id`, [U.sales]);
  tkItem = await one('admin', `insert into items (sku, type, name, base_unit, novel_food_status, shelf_life_months)
                               values ('RM-TK', 'raw_material', 'Task powder', 'kg', 'not_novel', 24) returning id`);
  tkJar = await one('admin', `insert into items (sku, type, name, base_unit) values ('PK-TKJ', 'packaging', 'Task jar', 'pcs') returning id`);
  const f = await one('admin', `insert into formulas (name, product_format, serving_size, servings_per_pack) values ('Task blend', 'capsule', 1, 30) returning id`);
  tkVer = await one('admin', 'select id from formula_versions where formula_id = $1', [f.id]);
  await as('admin', `insert into formula_lines (version_id, item_id, amount) values ($1, $2, 1000)`, [tkVer.id, tkItem.id]);
  await as('admin', `insert into formula_packaging (version_id, item_id, qty_per_pack) values ($1, $2, 1)`, [tkVer.id, tkJar.id]);
  await as('admin', 'select approve_formula_version($1)', [tkVer.id]);
  const oa = await calcOffer('NK-T-TKA', tkClient.id, 100, 10);
  const ob = await calcOffer('NK-T-TKB', tkClient.id, 100, 10);
  tkA = (await one('sales', `select create_order_from_calc_offers($1, $2, $3::jsonb, 20) as id`, [tkClient.id, [oa.id],
    JSON.stringify([{ description: 'Free Sale Certificate', quantity: 1, unit_price: 300 }, { description: 'Express courier', quantity: 1, unit_price: 50 }])])).id;
  tkB = (await one('sales', 'select create_order_from_calc_offers($1, $2) as id', [tkClient.id, [ob.id]])).id;
});
await ok('an unpaid order has no tasks; the default template is Private label', async () => {
  eq((await as('admin', 'select * from order_task_boards where sales_order_id = $1', [tkA])).length, 0, 'board');
  eq((await one('sales', 'select name_bg from order_task_templates where is_default')).name_bg, 'Private label — нова поръчка', 'default');
  eq((await as('sales', 'select * from order_task_templates order by name_bg')).length, 3, 'templates');
});
await fails('sales cannot confirm the first payment', () =>
  as('sales', `select confirm_order_payment($1, 'advance')`, [tkA]), 'not allowed');
await fails('production cannot confirm the first payment', () =>
  as('production', `select confirm_order_payment($1, 'advance')`, [tkA]), 'not allowed');
await fails('the advance is entered as an amount', () =>
  as('admin', `select confirm_order_payment($1, 'advance')`, [tkA]), 'Enter the advance received');
await fails('the advance is less than the order total with VAT (1350 + 20 % = 1620)', () =>
  as('admin', `select confirm_order_payment($1, 'advance', 1620)`, [tkA]), 'less than the order total');
await ok('a proforma downloaded before the board waits; production sees none', async () => {
  const p = `${tkA}/00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000a2-Proforma-X.pdf`;
  eq((await one('sales', `select order_proforma_task($1, 'advance') as t`, [tkA])).t, null, 'no task yet');
  eq((await one('sales', `select keep_order_proforma($1, 'advance', $2, 'Proforma-X.pdf', 1000) as old`, [tkA, p])).old.length, 0, 'nothing replaced');
  eq((await as('sales', 'select kind from order_proforma_pending where order_id = $1', [tkA])).length, 1, 'waiting');
  eq((await as('production', 'select * from order_proforma_pending')).length, 0, 'production');
});
await fails('production cannot keep a proforma', () =>
  as('production', `select keep_order_proforma($1, 'advance', $2, 'P.pdf', 10)`, [tkA, `${tkA}/00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000a3-P.pdf`]), 'not allowed');
await ok('admin confirms an advance of 810 received (VAT included): the board is made in the same step, "Аванс 810,00 €" is done', async () => {
  boardA = (await one('admin', `select confirm_order_payment($1, 'advance', 810) as id`, [tkA])).id;
  const o = await one('admin', 'select status, deposit_pct::int as pct, deposit_amount::float as amount, deposit_received_on, balance_received_on from sales_orders where id = $1', [tkA]);
  eq(o.status, 'confirmed', 'status'); eq(o.pct, 50, 'deposit'); eq(o.amount, 810, 'amount'); eq(!!o.deposit_received_on, true, 'deposit received');
  eq(o.balance_received_on, null, 'balance open');
  const cols = await as('admin', 'select system_key from order_task_columns where board_id = $1 order by position', [boardA]);
  eq(cols.map(c => c.system_key).join(','), 'payments,formula,design,materials,production,dispatch', 'columns');
  const first = await tk(tkA, 'payment_first');
  eq(first.title, 'Аванс 810,00 €', 'title'); eq(first.title_en, 'Advance 810.00 €', 'title en'); eq(first.status, 'done', 'done');
  eq(first.completed_by, U.admin, 'by admin');
  const act = await one('admin', 'select actor_id, action, payload from order_task_activity where task_id = $1', [first.id]);
  eq(act.actor_id, U.admin, 'actor'); eq(act.payload.source, 'payment_confirmed', 'source');
  eq(!!(await tk(tkA, 'payment_final')), true, 'final payment task'); eq(await tk(tkA, 'invoice_full'), undefined, 'no single invoice');
  const pay = await as('admin', `select t.template_key from order_tasks t join order_task_columns c on c.id = t.column_id
                                   where t.board_id = $1 and c.system_key = 'payments' order by t.position`, [boardA]);
  eq(pay.map(x => x.template_key).join(','), 'payment_first,invoice_advance,proforma_final,payment_final,invoice_final', 'proforma before the final payment');
  eq((await tk(tkA, 'proforma_final')).title, 'Проформа за финално плащане', 'proforma title');
});
await ok('once the board is there, a proforma goes to Payment (advance) or Proforma for the final payment, the latest replaces the earlier', async () => {
  const first = await tk(tkA, 'payment_first'), fin = await tk(tkA, 'proforma_final');
  eq((await one('sales', `select order_proforma_task($1, 'advance') as t`, [tkA])).t, first.id, 'advance task');
  eq((await one('sales', `select order_proforma_task($1, 'final') as t`, [tkA])).t, fin.id, 'final task');
  const path = (task, n) => `${tkA}/${task}/00000000-0000-4000-8000-00000000000${n}-Proforma-X.pdf`;
  const old = (await one('sales', `select keep_order_proforma($1, 'advance', $2, 'Proforma-X.pdf', 1200) as old`, [tkA, path(first.id, 5)])).old;
  eq(old.length, 1, 'the waiting copy is handed back for removal');
  eq((await as('sales', 'select 1 from order_proforma_pending where order_id = $1', [tkA])).length, 0, 'no longer waiting');
  const again = (await one('admin', `select keep_order_proforma($1, 'advance', $2, 'Proforma-X.pdf', 1300) as old`, [tkA, path(first.id, 6)])).old;
  eq(again[0], path(first.id, 5), 'earlier copy replaced');
  const files = await as('sales', 'select name, size from order_task_files where task_id = $1 and deleted_at is null', [first.id]);
  eq(files.length, 1, 'one file'); eq(Number(files[0].size), 1300, 'the latest');
  await as('sales', `select keep_order_proforma($1, 'final', $2, 'Proforma-final-X.pdf', 900)`, [tkA, `${tkA}/${fin.id}/00000000-0000-4000-8000-000000000007-Proforma-final-X.pdf`]);
  eq((await as('sales', 'select 1 from order_task_files where task_id = $1 and deleted_at is null', [fin.id])).length, 1, 'final proforma on its task');
});
await fails('a proforma path of another task is refused', async () => {
  const first = await tk(tkA, 'payment_first');
  await as('sales', `select keep_order_proforma($1, 'final', $2, 'P.pdf', 10)`, [tkA, `${tkA}/${first.id}/00000000-0000-4000-8000-000000000008-P.pdf`]);
}, 'Invalid file path');
await ok('confirming again never makes a second board', async () => {
  eq((await one('admin', `select confirm_order_payment($1, 'full') as id`, [tkA])).id, boardA, 'same board');
  eq((await as('admin', 'select id from order_task_boards where sales_order_id = $1', [tkA])).length, 1, 'one board');
  eq((await one('admin', 'select balance_received_on from sales_orders where id = $1', [tkA])).balance_received_on, null, 'payment unchanged');
});
await ok('services: Free Sale Certificate gets its task, an unknown service its own, label design none', async () => {
  eq(!!(await tk(tkA, 'free_sale')), true, 'free sale');
  eq(await tk(tkA, 'label_design'), undefined, 'no label design ordered');
  const s = await tk(tkA, 'service');
  eq(s.title, 'Express courier', 'other service');
  eq((await one('admin', 'select system_key from order_task_columns where id = $1', [s.column_id])).system_key, 'dispatch', 'column');
  const ck = await as('admin', 'select text from order_task_checklist_items where task_id = $1 order by position', [(await tk(tkA, 'label_check')).id]);
  eq(ck.length, 6, 'regulatory checklist'); eq(ck[0].text, 'Здравни претенции (Рег. 1924/2006)', 'first item');
});
await ok('admin confirms 100 % on the other order: "Плащане 100%", no final payment task', async () => {
  boardB = (await one('admin', `select confirm_order_payment($1, 'full') as id`, [tkB])).id;
  eq((await tk(tkB, 'payment_first')).title, 'Плащане 100%', 'title');
  eq(await tk(tkB, 'payment_final'), undefined, 'no final payment'); eq(await tk(tkB, 'proforma_final'), undefined, 'no final proforma'); eq(await tk(tkB, 'invoice_advance'), undefined, 'no advance invoice');
  eq(!!(await tk(tkB, 'invoice_full')), true, 'one invoice');
  eq(await tk(tkB, 'free_sale'), undefined, 'no service, no task');
  const o = await one('admin', 'select deposit_pct::int as pct, balance_received_on from sales_orders where id = $1', [tkB]);
  eq(o.pct, 100, 'paid in full'); eq(!!o.balance_received_on, true, 'balance');
});
await ok('dispatch waits for the final payment, the QC release and the client information', async () => {
  const d = await tk(tkA, 'dispatch');
  const deps = await as('admin', `select t.template_key from order_task_dependencies x join order_tasks t on t.id = x.depends_on_task_id
                                   where x.task_id = $1 order by 1`, [d.id]);
  eq(deps.map(r => r.template_key).join(','), 'client_info,payment_final,qc_released', 'waits for');
  const d2 = await tk(tkB, 'dispatch');
  eq((await as('admin', 'select * from order_task_dependencies where task_id = $1', [d2.id])).length, 2, 'no final payment at 100 %');
});
await fails('a blocked task cannot be done', async () =>
  as('sales', `select set_order_task_status($1, 'done')`, [(await tk(tkA, 'dispatch')).id]), 'blocked');
await fails('an automatic task is not ticked by hand', async () =>
  as('sales', `select set_order_task_status($1, 'done')`, [(await tk(tkA, 'recipes_approved')).id]), 'ticks itself');
await fails('sales cannot mark an automatic task by hand', async () =>
  as('sales', `select override_order_task($1, true, 'Checked by phone')`, [(await tk(tkA, 'coa')).id]), 'not allowed');
await fails('admin needs a reason to mark an automatic task by hand', async () =>
  as('admin', `select override_order_task($1, true, ' ')`, [(await tk(tkA, 'coa')).id]), 'reason');
await ok('admin marks it by hand with a reason and takes it back', async () => {
  const t = await tk(tkA, 'coa');
  await as('admin', `select override_order_task($1, true, 'COA sent by e-mail')`, [t.id]);
  eq((await tk(tkA, 'coa')).status, 'done', 'done');
  await as('admin', 'select clear_order_task_override($1)', [t.id]);
  const x = await tk(tkA, 'coa'); eq(x.status, 'todo', 'the rule decides again'); eq(x.override, false, 'override');
  eq((await as('admin', `select action from order_task_activity where task_id = $1 order by id`, [t.id])).map(a => a.action).join(','),
     'override,override_cleared,auto_undone', 'logged');
});
await fails('automatic tasks stay in their column', async () =>
  as('sales', 'select move_order_task($1, $2)', [(await tk(tkA, 'recipes_approved')).id, (await tk(tkA, 'dispatch')).column_id]), 'stay in their column');
await ok('sales adds a manual task, assigns it, moves it to another column and ticks it', async () => {
  const col = (await tk(tkA, 'label_approved')).column_id;
  const id = (await one('sales', 'select add_order_task($1, $2) as id', [col, 'Send samples'])).id;
  await as('sales', 'select save_order_task($1, $2, $3, $4)', [id, 'Send samples', 'Two jars by courier', U.sales]);
  const disp = (await tk(tkA, 'dispatch')).column_id;
  await as('sales', 'select move_order_task($1, $2, 1)', [id, disp]);
  const t = await one('sales', 'select column_id, position, assignee_id from order_tasks where id = $1', [id]);
  eq(t.column_id, disp, 'moved'); eq(t.position, 1, 'on top'); eq(t.assignee_id, U.sales, 'assignee');
  await as('sales', `select set_order_task_status($1, 'done')`, [id]);
  eq((await one('sales', 'select status, completed_by from order_tasks where id = $1', [id])).completed_by, U.sales, 'done by');
  eq((await as('sales', 'select action from order_task_activity where task_id = $1 order by id', [id])).map(a => a.action).join(','),
     'created,assigned,described,moved,status', 'activity');
});
await fails('tasks are assigned to admin or sales users only', async () =>
  as('sales', 'select save_order_task($1, $2, $3, $4)', [(await tk(tkA, 'client_info')).id, 'x', '', U.production]), 'admin or sales');
await fails('tasks cannot wait for each other in a circle', async () => {
  const a = await tk(tkA, 'client_info'); const d = await tk(tkA, 'dispatch');
  await as('sales', 'select set_order_task_dependency($1, $2)', [a.id, d.id]);
}, 'wait for each other');

console.log('\nOrder tasks: automatic rules');
const reqA = async () => Number((await db.query(`select required from version_required_materials($1, 100) where item_id = $2`, [tkVer.id, tkItem.id])).rows[0].required);
let tkNeed, tkLineA, tkLineB, tkMoA;
await ok('linking the recipe ticks "Рецептури одобрени" and takes the first availability snapshot', async () => {
  tkLineA = await one('admin', `select id from sales_order_lines where order_id = $1 and kind = 'calc_offer'`, [tkA]);
  tkLineB = await one('admin', `select id from sales_order_lines where order_id = $1 and kind = 'calc_offer'`, [tkB]);
  eq(await tkStatus(tkA, 'recipes_approved'), 'todo', 'before');
  tkNeed = await reqA();
  await recv(tkItem.id, tkNeed * 1.5, 'NK-WH');
  await recv(tkJar.id, 250, 'NK-WH');
  await as('admin', 'select link_order_line_formula($1, $2)', [tkLineA.id, tkVer.id]);
  await as('admin', 'select link_order_line_formula($1, $2)', [tkLineB.id, tkVer.id]);
  eq(await tkStatus(tkA, 'recipes_approved'), 'done', 'after');
  const act = await one('admin', `select actor_id, payload from order_task_activity where task_id = $1 and action = 'auto_done'`, [(await tk(tkA, 'recipes_approved')).id]);
  eq(act.actor_id, null, 'system'); eq(act.payload.source, 'recipe_linked', 'source');
  const link = await one('sales', `select entity_type, label from order_task_links where task_id = $1`, [(await tk(tkA, 'recipes_approved')).id]);
  eq(link.entity_type, 'formula_version', 'chip');
  const c = await one('sales', 'select total, ok, lines, recipe_versions from order_task_material_checks where board_id = $1 order by id desc limit 1', [boardB]);
  eq(c.total, 2, 'materials'); eq(c.ok, 2, 'available'); eq(c.recipe_versions.length, 1, 'recipe checked');
  eq(await tkStatus(tkB, 'materials_available'), 'done', 'B in stock');
  eq(await tkStatus(tkB, 'shortfall_delivered'), 'done', 'nothing missing');
});
await ok("another order's reservation leaves this one short: snapshot, untick and a notice to its owner", async () => {
  tkMoA = await one('admin', 'insert into manufacturing_orders (sales_order_line_id, quantity) values ($1, 100) returning id', [tkLineA.id]);
  eq((await as('admin', 'select * from mo_packaging where mo_id = $1', [tkMoA.id])).length, 1, 'jar from the recipe');
  await as('sales', 'select reserve_mo_materials($1)', [tkMoA.id]);
  eq(await tkStatus(tkA, 'materials_reserved'), 'done', 'A reserved');
  eq(await tkStatus(tkA, 'packaging_reserved'), 'done', 'A packaging');
  eq(await tkStatus(tkA, 'materials_available'), 'done', 'A locked');
  const c = await one('sales', 'select total, ok, source, cause_order_id, lines from order_task_material_checks where board_id = $1 order by id desc limit 1', [boardB]);
  eq(c.source, 'reservation', 'source'); eq(c.cause_order_id, tkA, 'cause'); eq(c.ok, 1, 'one short');
  const short = c.lines.find(l => l.sku === 'RM-TK');
  eq(short.status, 'short_no_order', 'status'); eq(Number(short.free), Number((tkNeed * 0.5).toFixed(4)), 'free');
  eq(await tkStatus(tkB, 'materials_available'), 'todo', 'B unticked');
  eq((await one('admin', `select payload from order_task_activity where task_id = $1 order by id desc limit 1`, [(await tk(tkB, 'materials_available')).id])).payload.source, 'reservation', 'logged');
  const n = await one('sales', `select params, link from notifications where kind = 'materials_short' and user_id = $1`, [U.sales]);
  const codeA = (await one('admin', 'select code from sales_orders where id = $1', [tkA])).code;
  eq(n.params.by, codeA, 'by'); eq(n.params.item, 'Task powder', 'item'); eq(n.link, `/orders/${tkB}`, 'link');
});
await ok('an incoming delivery makes it "short, incoming"; requesting what is missing makes a purchase request', async () => {
  const pr = (await one('sales', 'select create_order_shortfall_requests($1) as n', [tkB])).n;
  eq(pr, 1, 'one request');
  const r = await one('admin', 'select quantity::float as q, status from purchase_requests where sales_order_id = $1', [tkB]);
  eq(r.q, Number((tkNeed * 0.5).toFixed(4)), 'what is missing');
  eq(await tkStatus(tkB, 'shortfall_delivered'), 'todo', 'requested, not delivered');
  await as('admin', `select create_expected_delivery($1, $2, null::uuid, current_date + 5)`, [tkItem.id, r.q]);
  const c = await one('sales', 'select lines from order_task_material_checks where board_id = $1 order by id desc limit 1', [boardB]);
  eq(c.lines.find(l => l.sku === 'RM-TK').status, 'short_incoming', 'incoming');
});
await ok('"check again" always takes a snapshot; production cannot', async () => {
  const n = (await one('admin', 'select count(*)::int as n from order_task_material_checks where board_id = $1', [boardB])).n;
  await as('sales', 'select refresh_order_materials($1)', [tkB]);
  eq((await one('admin', 'select count(*)::int as n from order_task_material_checks where board_id = $1', [boardB])).n, n + 1, 'snapshot');
});
await fails('production cannot check the materials of an order', () => as('production', 'select refresh_order_materials($1)', [tkB]), 'not allowed');
await ok('releasing a reservation unticks "Суровини резервирани"; reserving again ticks it', async () => {
  const r = await one('admin', `select id from stock_reservations where manufacturing_order_id = $1 and item_id = $2 and status = 'active'`, [tkMoA.id, tkItem.id]);
  await as('sales', `select close_reservation($1, 'released')`, [r.id]);
  eq(await tkStatus(tkA, 'materials_reserved'), 'todo', 'unticked');
  eq((await one('admin', `select action from order_task_activity where task_id = $1 order by id desc limit 1`, [(await tk(tkA, 'materials_reserved')).id])).action, 'auto_undone', 'logged');
  await as('sales', 'select reserve_mo_materials($1)', [tkMoA.id]);
  eq(await tkStatus(tkA, 'materials_reserved'), 'done', 'ticked again');
});
await ok('sent to production, back and again; started', async () => {
  await as('admin', 'select schedule_mo($1, current_date + 3)', [tkMoA.id]);
  await as('admin', 'select release_mo($1)', [tkMoA.id]);
  eq(await tkStatus(tkA, 'sent_to_production'), 'done', 'sent');
  await as('admin', `select revert_mo_status($1, 'Wrong date')`, [tkMoA.id]);
  eq(await tkStatus(tkA, 'sent_to_production'), 'todo', 'taken back');
  await as('admin', 'select release_mo($1)', [tkMoA.id]);
  await as('production', 'select start_production($1)', [tkMoA.id]);
  eq(await tkStatus(tkA, 'in_production'), 'done', 'started by production');
  eq((await tk(tkA, 'in_production')).note.key, 'batch_in_production', 'note');
  eq(await tkStatus(tkA, 'consumption_reported'), 'todo', 'not reported');
});
await fails('sales cannot confirm the final payment', () => as('sales', 'select confirm_final_payment($1)', [tkA]), 'not allowed');
await fails('the final invoice waits for the final payment', () =>
  as('sales', `select create_order_invoice($1, 'final')`, [tkA]), 'final payment is confirmed');
let tkAdv;
await ok('the advance invoice: 50 % of the order, issuing it ticks "Фактура за аванс"', async () => {
  tkAdv = (await one('sales', 'select create_order_invoice($1) as id', [tkA])).id;
  const i = await one('sales', 'select purpose from invoices where id = $1', [tkAdv]);
  eq(i.purpose, 'advance', 'purpose');
  const l = await as('sales', 'select kind, amount::float as a from invoice_lines where invoice_id = $1', [tkAdv]);
  eq(l.map(x => `${x.kind}:${x.a}`).join(','), 'advance:675', '810 received / 1.2 VAT');
  // Without VAT the whole amount received is the base; with VAT again the order's 20 %
  await as('sales', 'select set_invoice_vat($1, false)', [tkAdv]);
  let v = await one('sales', 'select i.vat_pct::float as pct, l.amount::float as a from invoices i join invoice_lines l on l.invoice_id = i.id where i.id = $1', [tkAdv]);
  eq(`${v.pct}:${v.a}`, '0:810', 'without VAT');
  await as('sales', 'select set_invoice_vat($1, true)', [tkAdv]);
  v = await one('sales', 'select i.vat_pct::float as pct, l.amount::float as a from invoices i join invoice_lines l on l.invoice_id = i.id where i.id = $1', [tkAdv]);
  eq(`${v.pct}:${v.a}`, '20:675', 'with VAT');
  await as('sales', `select issue_invoice($1, next_invoice_number(), current_date)`, [tkAdv]);
  eq(await tkStatus(tkA, 'invoice_advance'), 'done', 'ticked');
});
await fails('production cannot set the VAT of an invoice', () => as('production', 'select set_invoice_vat($1, false)', [tkAdv]), 'not allowed');
await fails('an issued invoice keeps its VAT', () => as('sales', 'select set_invoice_vat($1, false)', [tkAdv]), 'cannot be changed');
await ok('admin confirms the final payment: ticked; clearing the date unticks it', async () => {
  await as('admin', 'select confirm_final_payment($1)', [tkA]);
  eq(await tkStatus(tkA, 'payment_final'), 'done', 'done');
  eq((await one('admin', `select payload from order_task_activity where task_id = $1 and action = 'auto_done'`, [(await tk(tkA, 'payment_final')).id])).payload.source, 'final_payment_confirmed', 'source');
  await as('admin', 'update sales_orders set balance_received_on = null where id = $1', [tkA]);
  eq(await tkStatus(tkA, 'payment_final'), 'todo', 'reversed');
  await as('admin', 'select confirm_final_payment($1)', [tkA]);
});
await fails('sales cannot clear a payment date', () =>
  as('sales', 'update sales_orders set balance_received_on = null where id = $1', [tkA]), 'Only admin enters the payment dates');
await fails('sales cannot enter a payment date', () =>
  as('sales', 'update sales_orders set deposit_received_on = current_date - 1 where id = $1', [tkA]), 'Only admin enters the payment dates');
await ok('sales still edits the rest of the order; the dates stay', async () => {
  await as('sales', `update sales_orders set notes = 'dates stay', deposit_received_on = deposit_received_on where id = $1`, [tkA]);
  const o = await one('admin', 'select notes, balance_received_on from sales_orders where id = $1', [tkA]);
  eq(o.notes, 'dates stay', 'notes'); eq(!!o.balance_received_on, true, 'balance kept');
});
await fails('the final invoice waits until every batch of the order is produced', () =>
  as('sales', 'select create_order_invoice($1)', [tkA]), 'every batch of the order is produced');
await ok('QC release of the batch ticks "QC освобождаване"', async () => {
  const lot = await one('admin', 'select receive_lot($1, $2, 1) as id', [tkJar.id, L['NK-WH']]);
  // the finished batch of the order (complete_production is tested above; here only its lot matters)
  await db.query(`select set_config('nk.mo_transition', 'on', false)`);
  await db.query(`update manufacturing_orders set status = 'completed', finished_lot_id = $2, completed_at = now() where id = $1`, [tkMoA.id, lot.id]);
  await db.query(`select set_config('nk.mo_transition', 'off', false)`);
  eq(await tkStatus(tkA, 'consumption_reported'), 'done', 'reported');
  eq(await tkStatus(tkA, 'qc_released'), 'done', 'released on receipt');
  await as('admin', `select set_lot_qc_status($1, 'released')`, [lot.id]);
  eq(await tkStatus(tkA, 'qc_released'), 'done', 'released');
  await as('admin', `select set_lot_qc_status($1, 'quarantine', 'Under review')`, [lot.id]);
  eq(await tkStatus(tkA, 'qc_released'), 'todo', 'back in quarantine');
});
await ok('the final invoice: every line less the advance invoiced', async () => {
  const id = (await one('sales', 'select create_order_invoice($1) as id', [tkA])).id;
  eq((await one('sales', 'select purpose from invoices where id = $1', [id])).purpose, 'final', 'purpose');
  const l = await as('sales', 'select kind, amount::float as a from invoice_lines where invoice_id = $1 order by sort_order', [id]);
  eq(l.map(x => `${x.kind}:${x.a}`).join(','), 'calc_offer:1000,service:300,service:50,advance:-675', 'lines');
  eq((await one('sales', `select issue_invoice($1, next_invoice_number(), current_date) as n`, [id])).n.length, 10, 'issued');
  eq(Number((await one('sales', 'select subtotal from invoices where id = $1', [id])).subtotal), 675, 'balance');
  eq(await tkStatus(tkA, 'invoice_final'), 'done', 'ticked');
});
await fails('an order paid at once has no advance invoice', () => as('sales', `select create_order_invoice($1, 'advance')`, [tkB]), 'paid with an advance|advance and a final');
await ok('Repeat order: the recipe the client already ordered ticks "Финални формули потвърдени"', async () => {
  const rep = await one('sales', `select id from order_task_templates where name_bg = 'Повторна поръчка'`);
  const oc = await calcOffer('NK-T-TKC', tkClient.id, 100, 10);
  const c = (await one('sales', 'select create_order_from_calc_offers($1, $2) as id', [tkClient.id, [oc.id]])).id;
  await as('admin', `select confirm_order_payment($1, 'full', null, $2)`, [c, rep.id]);
  eq(await tkStatus(c, 'formulas_confirmed'), 'todo', 'before the recipe is linked');
  const l = await one('admin', `select id from sales_order_lines where order_id = $1 and kind = 'calc_offer'`, [c]);
  await as('admin', 'select link_order_line_formula($1, $2)', [l.id, tkVer.id]);
  eq(await tkStatus(c, 'formulas_confirmed'), 'done', 'same recipe as before');
  eq(await tkStatus(tkA, 'formulas_confirmed'), 'todo', 'the default template does not');
});
await ok('admin cancels a payment confirmed by mistake: back to unpaid, board and draft invoices gone, then paid again', async () => {
  const od = await calcOffer('NK-T-TKD', tkClient.id, 100, 10);
  const d = (await one('sales', 'select create_order_from_calc_offers($1, $2) as id', [tkClient.id, [od.id]])).id;
  await as('admin', `select confirm_order_payment($1, 'advance', 500)`, [d]);
  await as('admin', `select create_order_invoice($1, 'advance')`, [d]);
  eq(Number((await one('admin', 'select count(*) from invoices where order_id = $1', [d])).count), 1, 'a draft advance invoice');
  await as('admin', `select cancel_order_payment($1, 'Wrong order')`, [d]);
  const o = await one('admin', 'select status, deposit_received_on, balance_received_on, deposit_amount, confirmed_at from sales_orders where id = $1', [d]);
  eq(o.status, 'unpaid', 'status'); eq(o.deposit_received_on, null, 'deposit date'); eq(o.deposit_amount, null, 'advance');
  eq(o.confirmed_at, null, 'confirmed at');
  eq((await as('admin', 'select * from order_task_boards where sales_order_id = $1', [d])).length, 0, 'board deleted');
  eq(Number((await one('admin', 'select count(*) from invoices where order_id = $1', [d])).count), 0, 'draft invoice deleted');
  eq((await as('admin', `select * from activities where client_id = $1 and body = 'Wrong order'`, [tkClient.id])).length, 1, 'reason noted');
  await as('admin', `select confirm_order_payment($1, 'full')`, [d]);
  eq((await one('admin', 'select status from sales_orders where id = $1', [d])).status, 'confirmed', 'paid again');
  eq((await as('admin', 'select * from order_task_boards where sales_order_id = $1', [d])).length, 1, 'new board');
});
await ok('the final proforma takes the units made once every batch is produced, plus the transport', async () => {
  const of = await calcOffer('NK-T-FIN', tkClient.id, 1000, 2);
  const o = (await one('sales', `select create_order_from_calc_offers($1, $2, '[]'::jsonb, 20) as id`, [tkClient.id, [of.id]])).id;
  await as('admin', `select confirm_order_payment($1, 'advance', 600)`, [o]);
  const l = await one('admin', 'select id from sales_order_lines where order_id = $1', [o]);
  await as('admin', 'select link_order_line_formula($1, $2)', [l.id, tkVer.id]);
  const mo = await one('admin', `insert into manufacturing_orders (sales_order_line_id, quantity)
                                  select id, quantity from sales_order_line_overview where id = $1 returning id`, [l.id]);
  const fin = async () => (await as('sales', 'select ordered, produced, quantity, amount::float as a from order_final_lines($1)', [o]))
    .map((x) => `${x.ordered}:${x.produced}:${x.quantity}:${x.a}`).join();
  const totals = async () => { const t = await one('sales', 'select net::float as n, gross::float as g from order_totals($1)', [o]); return `${t.n}:${t.g}`; };
  eq(await fin(), '1000:null:1000:2000', 'as ordered while the batch is open');
  eq((await one('sales', 'select order_production_done($1) as d', [o])).d, false, 'not done');
  await as('sales', 'select set_order_transport($1, 150)', [o]);
  eq(await totals(), '2150:2580', 'with transport');
  await db.query(`select set_config('nk.mo_transition', 'on', false)`);
  await db.query(`update manufacturing_orders set status = 'completed', produced_quantity = 1040, completed_at = now() where id = $1`, [mo.id]);
  await db.query(`select set_config('nk.mo_transition', 'off', false)`);
  eq(await fin(), '1000:1040:1040:2080', 'the units made');
  eq(await totals(), '2230:2676', 'units made and transport');
  await as('sales', `select issue_invoice(create_order_invoice($1, 'advance'), next_invoice_number(), current_date)`, [o]);
  await as('admin', 'select confirm_final_payment($1)', [o]);
  const inv = (await one('sales', 'select create_order_invoice($1) as id', [o])).id;
  const lines = await as('sales', 'select kind, quantity, amount::float as a from invoice_lines where invoice_id = $1 order by sort_order', [inv]);
  eq(lines.map((x) => `${x.kind}:${Number(x.quantity)}:${x.a}`).join(), 'calc_offer:1040:2080,service:1:150,advance:1:-500', 'final invoice');
  // Changing the transport makes the draft again
  await as('sales', 'select set_order_transport($1, 200)', [o]);
  const inv2 = (await one('sales', 'select create_order_invoice($1) as id', [o])).id;
  eq((await one('sales', `select amount::float as a from invoice_lines where invoice_id = $1 and kind = 'service'`, [inv2])).a, 200, 'new transport');
  await as('sales', 'select issue_invoice($1, next_invoice_number(), current_date)', [inv2]);
  tkFinal = o;
});
await ok('fewer units made than ordered: the final proforma and invoice take the fewer units', async () => {
  const of = await calcOffer('NK-T-FIN2', tkClient.id, 1000, 2);
  const o = (await one('sales', `select create_order_from_calc_offers($1, $2, '[]'::jsonb, 20) as id`, [tkClient.id, [of.id]])).id;
  await as('admin', `select confirm_order_payment($1, 'advance', 600)`, [o]);
  const l = await one('admin', 'select id from sales_order_lines where order_id = $1', [o]);
  await as('admin', 'select link_order_line_formula($1, $2)', [l.id, tkVer.id]);
  const mo = await one('admin', `insert into manufacturing_orders (sales_order_line_id, quantity)
                                  select id, quantity from sales_order_line_overview where id = $1 returning id`, [l.id]);
  await db.query(`select set_config('nk.mo_transition', 'on', false)`);
  await db.query(`update manufacturing_orders set status = 'completed', produced_quantity = 995, completed_at = now() where id = $1`, [mo.id]);
  await db.query(`select set_config('nk.mo_transition', 'off', false)`);
  const x = await one('sales', 'select ordered, quantity, amount::float as a from order_final_lines($1)', [o]);
  eq(`${x.ordered}:${x.quantity}:${x.a}`, '1000:995:1990', 'fewer units');
  const t = await one('sales', 'select net::float as n, gross::float as g from order_totals($1)', [o]);
  eq(`${t.n}:${t.g}`, '1990:2388', 'totals');
  await as('sales', `select issue_invoice(create_order_invoice($1, 'advance'), next_invoice_number(), current_date)`, [o]);
  await as('admin', 'select confirm_final_payment($1)', [o]);
  const inv = (await one('sales', 'select create_order_invoice($1) as id', [o])).id;
  const lines = await as('sales', 'select kind, quantity, amount::float as a from invoice_lines where invoice_id = $1 order by sort_order', [inv]);
  eq(lines.map((y) => `${y.kind}:${Number(y.quantity)}:${y.a}`).join(), 'calc_offer:995:1990,advance:1:-500', 'final invoice');
});
await fails('the transport of an invoiced order is corrected with a credit or debit note', () =>
  as('sales', 'select set_order_transport($1, 10)', [tkFinal]), 'credit or debit note');
await fails('the transport is not negative', () => as('sales', 'select set_order_transport($1, -1)', [tkB]), 'zero or more');
for (const [what, sql] of [['set the transport', 'select set_order_transport($1, 5)'], ['read the final lines', 'select * from order_final_lines($1)'],
                           ['read the order totals', 'select * from order_totals($1)']]) {
  await fails(`production cannot ${what}`, () => as('production', sql, [tkFinal]), 'not allowed');
}
await fails('sales cannot cancel a payment', () =>
  as('sales', `select cancel_order_payment($1, 'x')`, [tkB]), 'not allowed');
await fails('cancelling a payment needs a reason', () =>
  as('admin', `select cancel_order_payment($1, '  ')`, [tkB]), 'reason');
await fails('a confirmed order cannot be set back to unpaid by hand', () =>
  as('admin', `update sales_orders set status = 'unpaid' where id = $1`, [tkB]), 'cannot go from');
await ok('Export outside the EU adds Transport before Documents & dispatch', async () => {
  const exp = await one('sales', `select id from order_task_templates where name_bg = 'Износ извън ЕС'`);
  const cols = await as('sales', 'select coalesce(system_key, name_bg) as k from order_task_template_columns where template_id = $1 order by position', [exp.id]);
  eq(cols.map(c => c.k).join(','), 'payments,formula,design,materials,production,Транспорт,dispatch', 'columns');
  eq((await as('sales', `select key from order_task_template_items i join order_task_template_columns c on c.id = i.column_id
                         where c.template_id = $1 and c.system_key is null`, [exp.id])).length, 3, 'transport tasks');
});

console.log('\nOrder tasks: columns, chat, files');
await ok('a new column goes before Documents & dispatch by default', async () => {
  const id = (await one('sales', `select add_order_task_column($1, 'Мостри', 'Samples', 'teal') as id`, [boardA])).id;
  const cols = await as('sales', 'select id, coalesce(system_key, name_bg) as k from order_task_columns where board_id = $1 order by position', [boardA]);
  eq(cols.map(c => c.k).join(','), 'payments,formula,design,materials,production,Мостри,dispatch', 'order');
  await as('sales', 'select move_order_task_column($1, 1)', [id]);
  eq((await one('sales', 'select position from order_task_columns where id = $1', [id])).position, 1, 'moved first');
});
await ok('a column with tasks is deleted only after moving them; an empty one directly', async () => {
  const id = (await one('sales', `select add_order_task_column($1, 'Временна') as id`, [boardA])).id;
  const t = (await one('sales', 'select add_order_task($1, $2) as id', [id, 'Temporary task'])).id;
  let refused = false;
  try { await as('sales', 'select delete_order_task_column($1)', [id]); } catch (e) { refused = /choose a column/i.test(e.message); }
  eq(refused, true, 'refused while it has tasks');
  const to = (await tk(tkA, 'client_info')).column_id;
  await as('sales', 'select delete_order_task_column($1, $2)', [id, to]);
  eq((await one('sales', 'select column_id from order_tasks where id = $1', [t])).column_id, to, 'task moved');
  const e = (await one('sales', `select add_order_task_column($1, 'Празна') as id`, [boardA])).id;
  await as('sales', 'select delete_order_task_column($1)', [e]);
  eq((await as('sales', 'select id from order_task_columns where id = $1', [e])).length, 0, 'deleted');
});
await fails('a system column is never deleted', async () =>
  as('admin', 'select delete_order_task_column($1)', [(await tk(tkA, 'dispatch')).column_id]), 'hide them');
await fails('sales cannot delete a task of the template', async () =>
  as('sales', 'select delete_order_task($1)', [(await tk(tkB, 'labels_received')).id]), 'only admin');
await fails('sales cannot delete an automatic task', async () =>
  as('sales', 'select delete_order_task($1)', [(await tk(tkB, 'packaging_reserved')).id]), 'only admin');
await ok('sales deletes a task they added; admin one added by someone else', async () => {
  const col = (await tk(tkB, 'labels_received')).column_id;
  const mine = (await one('sales', 'select add_order_task($1, $2) as id', [col, 'Mine'])).id;
  await as('sales', 'select delete_order_task($1)', [mine]);
  eq((await as('admin', 'select id from order_tasks where id = $1', [mine])).length, 0, 'own task deleted');
  const other = (await one('sales', 'select add_order_task($1, $2) as id', [col, 'Theirs'])).id;
  await as('admin', 'select delete_order_task($1)', [other]);
  eq((await as('admin', 'select id from order_tasks where id = $1', [other])).length, 0, 'deleted by admin');
});
await ok('admin deletes a template task and an automatic one: logged, the template keeps them', async () => {
  for (const key of ['labels_received', 'packaging_reserved']) {
    const t = await tk(tkB, key);
    await as('admin', 'select delete_order_task($1)', [t.id]);
    eq(await tk(tkB, key), undefined, `${key} gone from the board`);
    eq((await one('admin', `select old_data->>'title' as title from audit_log where table_name = 'order_tasks' and row_id = $1`, [t.id])).title, t.title, `${key} logged`);
  }
  const tpl = (await one('admin', 'select template_id from order_task_boards where id = $1', [boardB])).template_id;
  eq((await as('admin', `select key from order_task_template_items where template_id = $1 and key in ('labels_received', 'packaging_reserved')`, [tpl])).length, 2, 'template unchanged');
});
await fails('production cannot delete tasks', async () =>
  as('production', 'select delete_order_task($1)', [(await tk(tkB, 'client_info')).id]));
await fails('sales cannot save a column to the template', () =>
  as('sales', `select add_order_task_column($1, 'X', null, 'grey', null, true)`, [boardA]), 'not allowed');
await ok('admin saves a column to the template: future boards only', async () => {
  await as('admin', `select add_order_task_column($1, 'Проби', 'Trials', 'purple', null, true)`, [boardA]);
  const tpl = (await one('admin', 'select template_id from order_task_boards where id = $1', [boardA])).template_id;
  eq((await as('admin', `select id from order_task_template_columns where template_id = $1 and name_bg = 'Проби'`, [tpl])).length, 1, 'in the template');
  eq((await as('admin', `select id from order_task_columns where board_id = $1 and name_bg = 'Проби'`, [boardB])).length, 0, 'other boards unchanged');
});
await fails('sales cannot change templates', () =>
  as('sales', `insert into order_task_templates (name_bg) values ('Моят шаблон')`), 'row-level security');
await ok('admin edits templates directly', async () => {
  const t = await one('admin', `insert into order_task_templates (name_bg, name_en) values ('Проба', 'Trial') returning id`);
  const c = await one('admin', `insert into order_task_template_columns (template_id, name_bg, position) values ($1, 'Етап', 1) returning id`, [t.id]);
  await as('admin', `insert into order_task_template_items (template_id, column_id, key, title_bg) values ($1, $2, 'step', 'Стъпка')`, [t.id, c.id]);
  await as('admin', 'delete from order_task_templates where id = $1', [t.id]);
});
await fails('a system column of a template is never deleted', () =>
  as('admin', `delete from order_task_template_columns where system_key = 'payments'`), 'hide them');
let tkMsg;
await ok('a message with a mention notifies admin; it is unread until admin opens the task', async () => {
  const t = await tk(tkA, 'client_info');
  tkMsg = (await one('sales', 'select post_order_task_comment($1, $2, $3) as id', [t.id, 'Address confirmed @admin', [U.admin, U.production]])).id;
  const m = await one('sales', 'select mentions from order_task_comments where id = $1', [tkMsg]);
  eq(m.mentions.join(','), U.admin, 'production is never mentioned');
  const n = await one('admin', `select params, link from notifications where kind = 'task_mention' and user_id = $1`, [U.admin]);
  eq(n.params.task, 'Информация за клиента', 'task'); eq(n.link.includes(`?task=${t.id}`), true, 'link');
  eq((await as('admin', 'select * from order_task_reads where task_id = $1', [t.id])).length, 0, 'unread for admin');
  eq((await as('sales', 'select * from order_task_reads where task_id = $1', [t.id])).length, 1, 'read by the author');
  await as('admin', 'select mark_order_task_read($1)', [t.id]);
  eq((await as('admin', 'select * from order_task_reads where task_id = $1', [t.id])).length, 1, 'read');
});
await fails('only the author edits a message', () => as('admin', 'select edit_order_task_comment($1, $2)', [tkMsg, 'Changed']), 'own messages');
await ok('the author edits; admin deletes any message (soft: the text goes)', async () => {
  await as('sales', 'select edit_order_task_comment($1, $2)', [tkMsg, 'Address confirmed']);
  eq(!!(await one('sales', 'select edited_at from order_task_comments where id = $1', [tkMsg])).edited_at, true, 'edited');
  await as('admin', 'select delete_order_task_comment($1)', [tkMsg]);
  const c = await one('sales', 'select body, deleted_at, deleted_by from order_task_comments where id = $1', [tkMsg]);
  eq(c.body, '', 'text removed'); eq(!!c.deleted_at, true, 'kept as deleted'); eq(c.deleted_by, U.admin, 'by');
});
await ok('files: recorded under {order}/{task}/{uuid}-{name}, removed by the uploader', async () => {
  const t = await tk(tkA, 'label_approved');
  const path = `${tkA}/${t.id}/00000000-0000-0000-0000-000000000001-label.pdf`;
  eq((await one('sales', 'select can_access_order_task_path($1) as ok', [path])).ok, true, 'sales may use the path');
  eq((await one('production', 'select can_access_order_task_path($1) as ok', [path])).ok, false, 'production may not');
  const f = (await one('sales', `select add_order_task_file($1, $2, 'label.pdf', 1200, 'application/pdf') as id`, [t.id, path])).id;
  eq((await one('sales', 'select delete_order_task_file($1) as p', [f])).p, path, 'path returned');
  eq((await as('sales', `select action from order_task_activity where task_id = $1 order by id`, [t.id])).map(a => a.action).join(','), 'file_added,file_removed', 'logged');
});
await fails('a file over 25 MB is refused', async () => {
  const t = await tk(tkA, 'label_approved');
  await as('sales', `select add_order_task_file($1, $2, 'big.pdf', 26214401, 'application/pdf')`, [t.id, `${tkA}/${t.id}/00000000-0000-0000-0000-000000000002-big.pdf`]);
}, '25 MB');
await fails('a program file is refused', async () => {
  const t = await tk(tkA, 'label_approved');
  await as('sales', `select add_order_task_file($1, $2, 'run.exe', 10, null)`, [t.id, `${tkA}/${t.id}/00000000-0000-0000-0000-000000000003-run.exe`]);
}, 'not allowed');
await fails('a file path of another order is refused', async () => {
  const t = await tk(tkA, 'label_approved');
  await as('sales', `select add_order_task_file($1, $2, 'a.pdf', 10, null)`, [t.id, `${tkB}/${t.id}/00000000-0000-0000-0000-000000000004-a.pdf`]);
}, 'invalid file path');
await ok('production sees no table of the task manager', async () => {
  const tables = ['order_task_templates', 'order_task_template_columns', 'order_task_template_items', 'order_task_boards',
    'order_task_columns', 'order_tasks', 'order_task_checklist_items', 'order_task_dependencies', 'order_task_links',
    'order_task_material_checks', 'order_task_comments', 'order_task_files', 'order_task_reads', 'order_task_activity'];
  for (const t of tables) {
    eq((await as('production', `select * from ${t}`)).length, 0, t);
    eq((await as('admin', `select count(*)::int as n from ${t}`))[0].n >= 0, true, t);
  }
  eq((await as('sales', 'select * from order_tasks where board_id = $1', [boardA])).length > 20, true, 'sales sees them');
});
await ok('production cannot write any table of the task manager', async () => {
  const t = await tk(tkA, 'client_info');
  const attempts = [
    [`insert into order_task_templates (name_bg) values ('X')`, []],
    [`update order_tasks set title = 'X' where id = $1`, [t.id]],
    [`delete from order_task_comments`, []],
    [`insert into order_task_reads (task_id, user_id) values ($1, $2)`, [t.id, U.production]],
    [`delete from order_task_template_items`, []],
  ];
  for (const [sql, params] of attempts) {
    let blocked = false;
    try { const r = await as('production', sql + (sql.startsWith('delete') || sql.startsWith('update') ? ' returning 1' : ''), params); blocked = r.length === 0; }
    catch (e) { blocked = /permission denied|row-level security/i.test(e.message); }
    eq(blocked, true, sql);
  }
  eq((await one('admin', 'select title from order_tasks where id = $1', [t.id])).title, 'Информация за клиента', 'unchanged');
});
await ok('production cannot call any function of the task manager', async () => {
  const t = await tk(tkA, 'client_info');
  const calls = [
    ['add_order_task($1, $2)', [t.column_id, 'X']], ['save_order_task($1, $2, $3, null)', [t.id, 'X', '']],
    ['set_order_task_status($1, \'done\')', [t.id]], ['move_order_task($1, $2)', [t.id, t.column_id]],
    ['delete_order_task($1)', [t.id]], ['override_order_task($1, true, $2)', [t.id, 'x']], ['clear_order_task_override($1)', [t.id]],
    ['add_order_task_checklist_item($1, $2)', [t.id, 'X']], ['set_order_task_dependency($1, $2)', [t.id, t.id]],
    ['add_order_task_link($1, \'sales_order\', $2)', [t.id, tkA]], ['post_order_task_comment($1, $2)', [t.id, 'Hi']],
    ['mark_order_task_read($1)', [t.id]], ['add_order_task_column($1, $2)', [boardA, 'X']],
    ['confirm_final_payment($1)', [tkA]], ['create_order_shortfall_requests($1)', [tkA]],
    ['delete_order_task_file($1)', [t.id]], ['add_order_task_file($1, $2, \'a.pdf\', 1, null)', [t.id, `${tkA}/${t.id}/x-a.pdf`]],
  ];
  for (const [fn, params] of calls) {
    let refused = false;
    try { await as('production', `select ${fn}`, params); } catch (e) { refused = /not allowed|permission denied/i.test(e.message); }
    eq(refused, true, fn);
  }
  for (const fn of ['order_tasks_sync($1, null)', 'order_tasks_refresh($1, \'x\')', 'order_material_check($1, \'manual\')']) {
    let refused = false;
    try { await as('sales', `select ${fn}`, [tkA]); } catch (e) { refused = /permission denied/i.test(e.message); }
    eq(refused, true, `internal ${fn}`);
  }
});

console.log('\nRead-only views');
await ok('production cannot change a project through production_projects', async () => {
  const before = (await db.query('select id, status from projects limit 1')).rows[0];
  let blocked = false;
  try { await as('production', `update production_projects set status = 'lost' where id = $1`, [before.id]); }
  catch (e) { blocked = /permission denied/i.test(e.message); }
  eq((await db.query('select status from projects where id = $1', [before.id])).rows[0].status, before.status, 'status unchanged');
  eq(blocked, true, 'permission denied');
});
await ok('no view in public can be written by users', async () => {
  const w = (await db.query(`select g.table_name, g.privilege_type from information_schema.role_table_grants g
      join pg_views v on v.schemaname = g.table_schema and v.viewname = g.table_name
     where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated') and g.privilege_type <> 'SELECT'`)).rows;
  eq(w.map(r => r.table_name + ':' + r.privilege_type).join(','), '', 'write grants on views');
});

console.log('\nDeveloper role');
await ok('developer has no data rights of their own', async () => {
  eq((await as('developer', 'select * from clients')).length, 0, 'clients');
  eq((await as('developer', 'select * from suppliers')).length, 0, 'suppliers');
  eq((await as('developer', 'select * from lot_costs')).length, 0, 'lot costs');
  eq((await one('developer', 'select public.is_staff() as s')).s, false, 'not staff');
});
await ok('developer lists every active user except developers', async () => {
  const rows = await as('developer', 'select id, role from impersonation_targets()');
  eq(rows.map(r => r.role).join(','), 'admin,admin,sales,production', 'targets');
});
await fails('admin cannot list users to act as', () => as('admin', 'select * from impersonation_targets()'), 'Only a developer');
await fails('production cannot start acting as another user', () => as('production', 'select start_impersonation($1)', [U.admin]), 'Only a developer');
await fails('developer cannot act as another developer', () => as('developer', 'select start_impersonation($1)', [U.developer]), 'cannot be selected');
await ok('acting as a user is logged; admin and the developer can read the log', async () => {
  await as('developer', 'select start_impersonation($1)', [U.production]);
  eq((await as('admin', 'select * from impersonation_log where target_id = $1', [U.production])).length, 1, 'admin');
  eq((await as('developer', 'select * from impersonation_log')).length, 1, 'developer');
  eq((await as('sales', 'select * from impersonation_log')).length, 0, 'others');
});
await fails('nobody writes the impersonation log directly',
  () => as('admin', 'insert into impersonation_log (developer_id, target_id) values ($1, $2)', [U.developer, U.admin]));

console.log('\nBatch release, dispatch, traceability, credit and debit notes');
const fgLot = (await one('admin', 'select finished_lot_id as id from manufacturing_orders where id = $1', [mo.id])).id;
const qcDispatch = () => JSON.stringify([{ lot_id: fgLot, location_id: L['FG'], quantity: 500 }]);
await fails('blocking a lot needs a reason', () =>
  as('admin', `select set_lot_qc_status($1, 'rejected')`, [lot.id]), 'reason');
await fails('sales cannot block a lot', () =>
  as('sales', `select set_lot_qc_status($1, 'rejected', 'x')`, [lot.id]), 'not allowed');
await fails('sales cannot release a finished batch', () =>
  as('sales', `select set_lot_qc_status($1, 'released')`, [fgLot]), 'not allowed');
await fails('a batch without any shelf life needs an expiry date', async () => {
  const p = await one('sales', `insert into projects (client_id, name) values ($1, 'No shelf life') returning id`, [client2.id]);
  const f = await one('sales', `insert into formulas (name, product_format, serving_size, servings_per_pack) values ('No shelf', 'capsule', 1, 30) returning id`);
  const v = await one('sales', 'select id from formula_versions where formula_id = $1', [f.id]);
  await as('sales', 'insert into formula_lines (version_id, item_id, amount) values ($1, $2, 100)', [v.id, mcc.id]);
  await as('admin', 'select approve_formula_version($1)', [v.id]);
  const l = await recv(mcc.id, 5, 'G-PRO');
  const m = await one('admin', 'insert into manufacturing_orders (formula_version_id, project_id, quantity) values ($1, $2, 10) returning id', [v.id, p.id]);
  await as('admin', 'select schedule_mo($1, current_date + 1)', [m.id]);
  await as('admin', 'select release_mo($1)', [m.id]);
  await as('production', 'select start_production($1)', [m.id]);
  globalThis.nkExpiry = { m: m.id, usage: JSON.stringify([{ lot_id: l, location_id: L['G-PRO'], quantity: 0.03 }]) };
  await as('production', `select complete_production($1, 'B-EXP', 10, current_date, $2::jsonb)`, [m.id, globalThis.nkExpiry.usage]);
}, 'expiry date');
await ok('the expiry date entered with the batch is used; the batch waits in quarantine', async () => {
  const { m, usage } = globalThis.nkExpiry;
  const r = await one('production', `select complete_production($1, 'B-EXP', 10, current_date, $2::jsonb, '[]'::jsonb, date '2028-05-31') as lot`, [m, usage]);
  const l = await one('admin', 'select expires_on::text, qc_status from lots where id = $1', [r.lot]);
  eq(l.expires_on, '2028-05-31', 'expiry'); eq(l.qc_status, 'quarantine', 'status');
});
await fails('an order cannot be set to dispatched without its batches', async () => {
  await as('sales', `update sales_orders set status = 'ready' where id = $1`, [order.id]);
  await as('sales', `update sales_orders set status = 'dispatched' where id = $1`, [order.id]);
}, 'delivery note');
await fails('sales cannot dispatch', () =>
  as('sales', 'select dispatch_order($1, current_date, $2::jsonb)', [order.id, qcDispatch()]), 'not allowed');
await fails('no dispatch before the balance is paid', () =>
  as('admin', 'select dispatch_order($1, current_date, $2::jsonb)', [order.id, qcDispatch()]), 'balance must be paid');
await fails('a batch in quarantine cannot be dispatched', async () => {
  await as('admin', 'update sales_orders set balance_received_on = current_date where id = $1', [order.id]);
  await as('admin', 'select dispatch_order($1, current_date, $2::jsonb)', [order.id, qcDispatch()]);
}, 'not released');
await ok('without a COA the batch is released and dispatched: delivery note, stock out, order and project move on', async () => {
  await as('admin', `select set_lot_qc_status($1, 'released')`, [fgLot]);
  eq((await one('admin', 'select qc_status from lots where id = $1', [fgLot])).qc_status, 'released', 'released');
  const r = await one('admin', `select dispatch_order($1, current_date, $2::jsonb, 'DHL', 'T-1') as id`, [order.id, qcDispatch()]);
  eq((await one('sales', 'select code from dispatches where id = $1', [r.id])).code, 'DN-00001', 'delivery note');
  eq(Number((await one('admin', 'select sum(quantity) as q from stock_movements where lot_id = $1', [fgLot])).q), 490, 'left');
  eq((await one('sales', 'select status from sales_orders where id = $1', [order.id])).status, 'dispatched', 'order');
  eq((await one('sales', 'select status from projects where id = $1', [project.id])).status, 'completed', 'project');
});
await ok('the COA can be attached after the release', async () => {
  const path = `${fgLot}/00000000-0000-4000-8000-000000000001.pdf`;
  await as('admin', 'select set_lot_coa($1, $2)', [fgLot, path]);
  eq((await one('admin', 'select coa_path from lots where id = $1', [fgLot])).coa_path, path, 'path');
  eq((await one('admin', 'select qc_status from lots where id = $1', [fgLot])).qc_status, 'released', 'still released');
});
await ok('the rest can follow on a second delivery note', async () => {
  const lines = JSON.stringify([{ lot_id: fgLot, location_id: L['FG'], quantity: 90 }]);
  await as('admin', 'select dispatch_order($1, current_date, $2::jsonb)', [order.id, lines]);
  eq((await as('sales', 'select id from dispatches where order_id = $1', [order.id])).length, 2, 'notes');
});
await fails('no more than is in stock', () =>
  as('admin', 'select dispatch_order($1, current_date, $2::jsonb)',
     [order.id, JSON.stringify([{ lot_id: fgLot, location_id: L['FG'], quantity: 401 }])]), 'insufficient');
await fails('a batch of another order is refused', () =>
  as('admin', 'select dispatch_order($1, current_date, $2::jsonb)',
     [order.id, JSON.stringify([{ lot_id: lot.id, location_id: L['G-PRO'], quantity: 1 }])]), 'does not belong');
await ok('trace back: a finished batch lists the raw material lots', async () => {
  const rows = await as('sales', 'select lot_id, mo_code, quantity from trace_back($1)', [fgLot]);
  const m = rows.find(r => r.lot_id === lot.id);
  eq(m.mo_code, mo.code, 'order'); eq(Number(m.quantity), 22.5, 'quantity');
});
await ok('trace forward: a raw material lot leads to the batch, its stock and the client', async () => {
  const f = (await as('sales', 'select lot_number, on_hand from trace_forward($1)', [lot.id])).find(r => r.lot_number === 'B-24001');
  eq(Number(f.on_hand), 400, 'left of the batch');
  const c = await as('sales', 'select client, quantity from trace_clients($1)', [lot.id]);
  eq(c.length, 2, 'two delivery notes'); eq(c[0].client, 'Acme Wellness GmbH', 'client');
  eq(c.reduce((a, r) => a + Number(r.quantity), 0), 590, 'sent');
});
await fails('production cannot read traceability', () => as('production', 'select * from trace_clients($1)', [lot.id]), 'not allowed');
await ok('production sees no delivery notes', async () => {
  eq((await as('production', 'select * from dispatches')).length, 0, 'notes');
  eq((await as('production', 'select * from dispatch_lines')).length, 0, 'lines');
});
const orig = await one('admin', `select id, total, order_id from invoices where kind = 'invoice' and status = 'issued' and total > 0 order by number limit 1`);
let credit;
await fails('a credit note needs a reason', () => as('sales', `select create_invoice_note($1, 'credit_note', ' ')`, [orig.id]), 'reason');
await fails('a note is only against an issued invoice', async () => {
  const c = await one('sales', `select create_invoice_note($1, 'debit_note', 'more') as id`, [orig.id]);
  await as('sales', `select create_invoice_note($1, 'credit_note', 'x')`, [c.id]);
}, 'issued invoice');
await ok('a credit note starts from the lines of the invoice and keeps the link', async () => {
  credit = (await one('sales', `select create_invoice_note($1, 'credit_note', 'Wrong quantity') as id`, [orig.id])).id;
  const n = await one('sales', 'select corrects_invoice_id, reason, status from invoices where id = $1', [credit]);
  eq(n.corrects_invoice_id, orig.id, 'link'); eq(n.status, 'draft', 'draft');
  eq((await as('sales', 'select id from invoice_lines where invoice_id = $1', [credit])).length > 0, true, 'lines');
});
await fails('a credit note cannot exceed the invoice', async () => {
  const l = await one('sales', 'select id from invoice_lines where invoice_id = $1 order by sort_order limit 1', [credit]);
  await as('sales', `select save_note_line($1, $2, 'Correction', 1, 99999999)`, [credit, l.id]);
  await as('sales', 'select issue_invoice($1, next_invoice_number(), current_date)', [credit]);
}, 'more than what is left');
await ok('a corrected credit note takes the next number of the shared series and locks', async () => {
  const lines = await as('sales', 'select id from invoice_lines where invoice_id = $1 order by sort_order', [credit]);
  await as('sales', `select save_note_line($1, $2, 'Correction', 1, 1)`, [credit, lines[0].id]);
  for (const l of lines.slice(1)) await as('sales', 'select delete_note_line($1, $2)', [credit, l.id]);
  const next = (await one('sales', 'select next_invoice_number() as n')).n;
  eq((await one('sales', 'select issue_invoice($1, next_invoice_number(), current_date) as n', [credit])).n, next, 'number');
  eq((await one('sales', 'select total from invoices where id = $1', [credit])).total !== null, true, 'total');
});
await fails('an issued note cannot be changed', () =>
  as('sales', `select save_note_line($1, null, 'x', 1, 1)`, [credit]), 'cannot be changed');
await fails('an invoice itself is not changed through note lines', () =>
  as('sales', `select save_note_line($1, null, 'x', 1, 1)`, [orig.id]), 'only the lines');
await fails('production cannot create notes', () =>
  as('production', `select create_invoice_note($1, 'credit_note', 'x')`, [orig.id]), 'not allowed');

console.log('\nRepeat orders, preparing production, e-mailed documents');
const shOffer = async (no, name) => (await one('sales', `insert into calc_offers (offer_no, receiver_name, receiver_email, client_id, product_name, product_type, data, results)
  values ($1, 'Client', 'buyer@client.test', $2, $3, 'capsules_glass', $4::jsonb, '{"unitPrice": 2}') returning id`, [no, client.id, name,
  JSON.stringify({ productType: 'capsules_glass', capsulesPerDose: '1', quantityPerUnit: '60', numberOfUnits: '100', rows: [] })])).id;
const shReady = await shOffer('NK-T-SH1', 'Shortcut Ready');
const shNoRecipe = await shOffer('NK-T-SH2', 'Shortcut No Recipe');
const shVersion = await one('sales', 'select v.id from formula_versions v join formulas f on f.id = v.formula_id where f.calc_offer_id = $1', [shReady]);
let shOrder, shCopy;
await ok('setup: an approved recipe for one offer and an unpaid order with a service', async () => {
  await as('sales', 'insert into formula_lines (version_id, item_id, amount) values ($1, $2, 100)', [shVersion.id, mcc.id]);
  await as('admin', 'select approve_formula_version($1)', [shVersion.id]);
  shOrder = (await one('sales', `select create_order_from_calc_offers($1, $2, $3::jsonb, 20, 'REF-1') as id`, [client.id, [shReady, shNoRecipe],
    JSON.stringify([{ description: 'Label design', quantity: 1, unit_price: 200 }])])).id;
});
await fails('prepare production waits for the payment', () =>
  as('admin', 'select prepare_order_production($1)', [shOrder]), 'Confirm the payment');
await fails('sales cannot prepare production', () =>
  as('sales', 'select prepare_order_production($1)', [shOrder]), 'not allowed');
await ok('prepare production: recipe linked, batch planned and dated, materials reserved or requested; a product without a recipe is named', async () => {
  await as('admin', `select confirm_order_payment($1, 'full')`, [shOrder]);
  const r = (await one('admin', `select prepare_order_production($1, current_date + 5) as r`, [shOrder])).r;
  eq(r.created, 1, 'created'); eq(r.no_recipe.join(), 'Shortcut No Recipe', 'no recipe');
  eq(r.reserved + r.requested > 0, true, 'materials');
  const m = await one('admin', `select m.status, m.planned_date is not null as dated, l.formula_version_id from manufacturing_orders m
    join sales_order_lines l on l.id = m.sales_order_line_id where l.order_id = $1`, [shOrder]);
  eq(m.status, 'scheduled', 'scheduled'); eq(m.dated, true, 'date'); eq(m.formula_version_id, shVersion.id, 'recipe');
});
await ok('prepare production twice changes nothing', async () => {
  const r = (await one('admin', 'select prepare_order_production($1, current_date + 5) as r', [shOrder])).r;
  eq(r.created, 0, 'created'); eq(r.requested, 0, 'requested');
  eq((await one('admin', `select count(*)::int as n from manufacturing_orders m join sales_order_lines l on l.id = m.sales_order_line_id where l.order_id = $1`, [shOrder])).n, 1, 'one batch');
});
await fails('production cannot repeat an order', () => as('production', 'select copy_order($1)', [shOrder]), 'not allowed');
await ok('a repeat order: unpaid, same products and prices, no dates, reference, payment or recipe', async () => {
  shCopy = (await one('sales', 'select copy_order($1) as id', [shOrder])).id;
  const c = await one('sales', 'select status, customer_ref, deposit_received_on, vat_pct from sales_orders where id = $1', [shCopy]);
  eq(c.status, 'unpaid', 'status'); eq(c.customer_ref, null, 'ref'); eq(c.deposit_received_on, null, 'payment'); eq(Number(c.vat_pct), 20, 'vat');
  const same = 'select kind, calc_offer_id, description, quantity, unit_price from sales_order_lines where order_id = $1 order by sort_order';
  eq(JSON.stringify(await as('sales', same, [shCopy])), JSON.stringify(await as('sales', same, [shOrder])), 'lines');
  eq((await one('sales', 'select count(*)::int as n from sales_order_lines where order_id = $1 and formula_version_id is not null', [shCopy])).n, 0, 'recipe later');
});
await ok('the repeat order gets its recipe and its own project when production is prepared', async () => {
  await as('admin', `select confirm_order_payment($1, 'full')`, [shCopy]);
  eq((await one('admin', 'select prepare_order_production($1) as r', [shCopy])).r.created, 1, 'created');
  const a = await one('admin', 'select project_id from sales_order_lines where order_id = $1 and calc_offer_id = $2', [shOrder, shReady]);
  const b = await one('admin', 'select project_id from sales_order_lines where order_id = $1 and calc_offer_id = $2', [shCopy, shReady]);
  eq(b.project_id !== null && a.project_id !== b.project_id, true, 'own project');
});
await fails('production cannot send documents', () =>
  as('production', `select begin_document_send('proforma', $1, 'a@b.co', null, 'x')`, [shOrder]), 'not allowed');
await fails('a wrong e-mail address is refused', () =>
  as('sales', `select begin_document_send('proforma', $1, 'no-address', null, 'x')`, [shOrder]), 'e-mail address');
await fails('a draft invoice cannot be sent', async () => {
  const d = (await one('sales', 'select create_order_invoice($1) as id', [shOrder])).id;
  await as('sales', `select begin_document_send('invoice', $1, 'a@b.co', null, 'x')`, [d]);
}, 'cannot be sent');
await ok('a send is logged with its result; only its sender closes it', async () => {
  const id = (await one('sales', `select begin_document_send('proforma', $1, 'a@b.co', null, 'Proforma') as id`, [shOrder])).id;
  await fails('another user cannot close it', () => as('admin', 'select finish_document_send($1)', [id]), 'not found');
  await as('sales', 'select finish_document_send($1)', [id]);
  const r = await one('admin', 'select status, sent_by from document_sends where id = $1', [id]);
  eq(r.status, 'sent', 'status'); eq(r.sent_by, U.sales, 'sender');
  const f = (await one('sales', `select begin_document_send('proforma', $1, 'a@b.co', null, 'Proforma') as id`, [shOrder])).id;
  await as('sales', `select finish_document_send($1, 'Mailbox full')`, [f]);
  eq((await one('sales', 'select status, error from document_sends where id = $1', [f])).error, 'Mailbox full', 'error');
});
await ok('production sees no sent documents and nobody writes them directly', async () => {
  eq((await as('production', 'select id from document_sends')).length, 0, 'production');
  let refused = false;
  try { await as('sales', `insert into document_sends (kind, ref_id, recipient, subject) values ('proforma', $1, 'a@b.co', 'x')`, [shOrder]); }
  catch { refused = true; }
  eq(refused, true, 'insert');
});

console.log('\nAI assistant');
let aiConv;
await ok('a conversation belongs to its author', async () => {
  aiConv = (await one('sales', `insert into ai_conversations (title) values ('Test') returning id`)).id;
  await as('sales', `insert into ai_messages (conversation_id, role, content) values ($1, 'user', 'Hello')`, [aiConv]);
  eq((await as('sales', 'select id from ai_messages where conversation_id = $1', [aiConv])).length, 1, 'own');
  eq((await as('admin', 'select id from ai_conversations where id = $1', [aiConv])).length, 0, 'admin');
  eq((await as('admin', 'select id from ai_messages where conversation_id = $1', [aiConv])).length, 0, 'admin messages');
});
await fails("nobody writes into another person's conversation", () =>
  as('admin', `insert into ai_messages (conversation_id, role, content) values ($1, 'user', 'x')`, [aiConv]));
await fails('production has no conversations', () =>
  as('production', `insert into ai_conversations (title) values ('x')`));
await ok('production sees no AI data', async () => {
  eq((await as('production', 'select id from ai_conversations')).length, 0, 'conversations');
  eq((await as('production', 'select id from ai_messages')).length, 0, 'messages');
});

console.log('\nAI recipe proposals');
const aiRecipe = (over = {}) => JSON.stringify({
  name: 'AI Test', name_bg: 'AI тест', product_format: 'capsule', serving_size: 2, serving_unit: 'pcs', servings_per_pack: 30,
  lines: [{ sku: 'RCP-ZG', amount: 300, unit: 'mg' }], ...over,
});
let aiProposal;
await ok('the database calculates: amounts per pack, capsule fill, no price without the right to see it', async () => {
  const conv = (await one('admin', `insert into ai_conversations (title) values ('Recipe') returning id`)).id;
  globalThis.aiConvAdmin = conv;
  const r = (await one('admin', 'select add_recipe_proposal($1, $2::jsonb, 730) as r', [conv, aiRecipe()])).r;
  eq(r.saved_for_review, true, 'saved'); aiProposal = r.proposal_id;
  eq(Number(r.lines[0].qty_per_pack), 0.009, 'kg per pack'); eq(Number(r.mg_per_capsule), 150, 'fill'); eq(r.fits, true, 'fits');
  const s = (await one('sales', 'select recipe_estimate($1::jsonb, 730) as r', [aiRecipe()])).r;
  eq(s.prices_hidden, true, 'sales without the right'); eq(s.materials_cost_per_pack, null, 'no cost');
  eq(s.lines[0].cost_per_pack, null, 'no line cost');
});
await ok('too much for a capsule is reported', async () => {
  const r = (await one('admin', 'select recipe_estimate($1::jsonb, 730) as r', [aiRecipe({ lines: [{ sku: 'RCP-ZG', amount: 2000, unit: 'mg' }] })])).r;
  eq(r.fits, false, 'fits');
});
await ok('an unknown item keeps the proposal out', async () => {
  const before = (await one('admin', 'select count(*)::int as n from ai_recipe_proposals')).n;
  const r = (await one('admin', 'select add_recipe_proposal($1, $2::jsonb, 730) as r', [globalThis.aiConvAdmin, aiRecipe({ lines: [{ sku: 'NOPE', amount: 1, unit: 'mg' }] })])).r;
  eq(r.unknown[0], 'NOPE', 'unknown');
  eq((await one('admin', 'select count(*)::int as n from ai_recipe_proposals')).n, before, 'nothing saved');
});
await ok('materials for a recipe: prices only with the right to see them', async () => {
  const a = await one('admin', `select price_per_base_unit, available from recipe_materials('RCP-ZG')`);
  eq(a !== undefined, true, 'found');
  await db.query('update supplier_prices set price = price');
  const hidden = await as('sales', `select price_per_base_unit from recipe_materials('')`);
  eq(hidden.length > 0 && hidden.every((x) => x.price_per_base_unit === null), true, 'no prices for sales');
  const shown = await as('admin', `select price_per_base_unit from recipe_materials('')`);
  eq(shown.some((x) => x.price_per_base_unit !== null), true, 'prices for admin');
});
await fails('production cannot list recipe materials', () => as('production', "select * from recipe_materials('')"), 'not allowed');
await fails('production cannot estimate recipes', () => as('production', 'select recipe_estimate($1::jsonb, 730)', [aiRecipe()]), 'not allowed');
await fails('nobody saves into a conversation of another person', () =>
  as('sales', 'select add_recipe_proposal($1, $2::jsonb, 730)', [globalThis.aiConvAdmin, aiRecipe()]), 'Conversation not found');
await fails('a proposal cannot be written directly', () =>
  as('admin', `insert into ai_recipe_proposals (conversation_id, recipe, estimate) values ($1, '{}', '{}')`, [globalThis.aiConvAdmin]));
await fails('another person cannot save the proposal', () => as('sales', 'select recipe_from_proposal($1)', [aiProposal]), 'Proposal not found');
await ok('a person saves it: a new recipe with a draft version, not approved; saving twice gives the same recipe', async () => {
  const id = (await one('admin', 'select recipe_from_proposal($1) as id', [aiProposal])).id;
  const v = await one('admin', 'select id, status from formula_versions where formula_id = $1', [id]);
  eq(v.status, 'draft', 'draft');
  eq((await as('admin', 'select id from formula_lines where version_id = $1', [v.id])).length, 1, 'lines');
  eq((await one('admin', 'select recipe_from_proposal($1) as id', [aiProposal])).id, id, 'same');
});
await ok('production sees no proposals', async () => {
  eq((await as('production', 'select id from ai_recipe_proposals')).length, 0, 'none');
});

console.log('\nEU lists');
await ok('the Register and the Catalogue are loaded', async () => {
  eq((await one('sales', `select count(*)::int as n from eu_health_claims where status = 'authorised'`)).n > 200, true, 'authorised claims');
  eq((await one('sales', 'select count(*)::int as n from eu_novel_food_status')).n > 900, true, 'catalogue');
  const m = await as('sales', `select claim from eu_health_claims where status = 'authorised' and substance ilike '%magnesium%'`);
  eq(m.some((x) => x.claim.includes('tiredness and fatigue')), true, 'magnesium claim');
});
await ok('production does not see the lists', async () => {
  eq((await as('production', 'select code from eu_health_claims limit 1')).length, 0, 'claims');
  eq((await as('production', 'select code from eu_novel_food_status limit 1')).length, 0, 'catalogue');
});
await fails('nobody changes the lists from the app', () =>
  as('admin', `update eu_health_claims set claim = 'x' where code = (select code from eu_health_claims limit 1) returning code`).then((r) => { if (!r.length) throw new Error('refused'); }));

console.log('\nGmail');
const mailClient = await one('sales', `insert into clients (legal_name, billing_email) values ('Mail Client GmbH', 'office@mailclient.test') returning id`);
const mail = (id, over = {}) => ({ gmail_id: id, thread_id: 't-' + id, direction: 'in', from_address: 'Anna <anna@mailclient.test>', parties: ['anna@mailclient.test'],
  subject: 'Enquiry', snippet: 's', body: 'b', has_attachments: false, sent_at: '2026-10-30T10:00:00Z', ...over });
const saveMail = (list) => db.query('select gmail_job_save($1::jsonb) as n', [JSON.stringify(list)]);
await ok('mail of a known client is kept, by exact address or company domain; other mail is skipped', async () => {
  const r = await saveMail([mail('m1'), mail('m2', { parties: ['stranger@elsewhere.test'] }), mail('m3', { parties: ['office@mailclient.test'], thread_id: 't-m1', direction: 'out', sent_at: '2026-10-30T11:00:00Z' })]);
  eq(r.rows[0].n, 2, 'kept');
  eq((await as('sales', 'select id from client_emails where client_id = $1', [mailClient.id])).length, 2, 'on the client');
});
await ok('saving the same mail twice keeps one copy; a free mail domain does not match by domain', async () => {
  eq((await saveMail([mail('m1')])).rows[0].n, 0, 'same');
  await as('sales', `insert into contacts (client_id, first_name, email) values ($1, 'Ivan', 'ivan@gmail.com')`, [mailClient.id]);
  eq((await saveMail([mail('m4', { parties: ['someone@gmail.com'] })])).rows[0].n, 0, 'free domain');
});
await ok('a thread waits for a reply only when the client wrote last', async () => {
  await saveMail([mail('m5')]);
  const w = await as('sales', 'select thread_id from emails_waiting_reply');
  eq(w.some((x) => x.thread_id === 't-m5'), true, 'waiting'); eq(w.some((x) => x.thread_id === 't-m1'), false, 'answered');
});
await ok('production sees no mail', async () => {
  eq((await as('production', 'select id from client_emails')).length, 0, 'mail');
  eq((await as('production', 'select id from emails_waiting_reply')).length, 0, 'waiting');
});
await fails('only admin connects the mailbox', () => as('sales', `select gmail_connect('a@b.co', 'x')`), 'not allowed');
await ok('nobody reads the stored token', async () => {
  await as('admin', `select gmail_connect('shared@nutrikal.test', 'secret')`);
  eq((await as('admin', 'select id from gmail_connection')).length, 0, 'table');
  eq((await one('admin', 'select email from gmail_status()')).email, 'shared@nutrikal.test', 'status');
});
await fails('the sync functions are not for signed-in users', () => as('admin', 'select * from gmail_job_state()'), 'permission denied');

console.log('\nInvoices without an order');
let dInv, dLine;
await fails('production cannot create invoices', () =>
  as('production', 'select create_client_invoice($1, 20, null, null, null, null)', [client.id]), 'not allowed');
await fails('a client is needed', () =>
  as('sales', 'select create_client_invoice(null, 20, null, null, null, null)'), 'Choose the client');
await ok('a draft for a client, without an order, with free lines', async () => {
  dInv = (await one('sales', `select create_client_invoice($1, 20, current_date + 14, 'bank', 'PO-9', 'Consulting') as id`, [client.id])).id;
  const i = await one('sales', 'select order_id, status, due_date is not null as due, buyer ->> \'customer_ref\' as ref from invoices where id = $1', [dInv]);
  eq(i.order_id, null, 'no order'); eq(i.status, 'draft', 'draft'); eq(i.due, true, 'due'); eq(i.ref, 'PO-9', 'reference');
  await as('sales', `select save_note_line($1, null, 'Regulatory consulting', 2, 100)`, [dInv]);
  dLine = (await one('sales', 'select id from invoice_lines where invoice_id = $1', [dInv])).id;
  await as('sales', `select save_note_line($1, $2, 'Regulatory consulting', 3, 100)`, [dInv, dLine]);
  eq(Number((await one('sales', 'select amount from invoice_lines where id = $1', [dLine])).amount), 300, 'amount');
});
await ok('terms of a draft can change', async () => {
  await as('sales', `select set_client_invoice_terms($1, 0, current_date - 1, current_date - 1, 'cash', 'Note', 'Basis')`, [dInv]);
  eq(Number((await one('sales', 'select vat_pct from invoices where id = $1', [dInv])).vat_pct), 0, 'vat');
  await as('sales', `select set_client_invoice_terms($1, 20, null, current_date - 1, 'bank', null, null)`, [dInv]);
});
await fails('no payment on a draft', () => as('admin', 'select add_invoice_payment($1, current_date, 10, null, null)', [dInv]), 'issued invoice');
await ok('issued on the shared series; the date of the taxable event defaults to the issue date', async () => {
  const next = (await one('sales', 'select next_invoice_number() as n')).n;
  eq((await one('sales', 'select issue_invoice($1, next_invoice_number(), current_date) as n', [dInv])).n, next, 'number');
  const i = await one('sales', 'select total, tax_point_date = issue_date as same from invoices where id = $1', [dInv]);
  eq(Number(i.total), 360, 'total'); eq(i.same, true, 'tax date');
});
await fails('an issued invoice stays locked', () =>
  as('sales', `select save_note_line($1, null, 'x', 1, 1)`, [dInv]), 'cannot be changed');
await fails('the terms of an issued invoice stay locked', () =>
  as('sales', `select set_client_invoice_terms($1, 0, null, null, null, null, null)`, [dInv]), 'draft invoice');
await fails('sales cannot record a payment', () => as('sales', 'select add_invoice_payment($1, current_date, 10, null, null)', [dInv]), 'not allowed');
await ok('partial payments lower what is left; the invoice itself does not change', async () => {
  await as('admin', `select add_invoice_payment($1, current_date, 100, 'cash', 'First')`, [dInv]);
  eq(Number((await one('sales', 'select invoice_open_amount($1) as n', [dInv])).n), 260, 'left');
  eq(Number((await one('sales', 'select total from invoices where id = $1', [dInv])).total), 360, 'total');
});
await fails('no payment above what is left', () => as('admin', 'select add_invoice_payment($1, current_date, 261, null, null)', [dInv]), 'more than what is left');
await ok('a credit note lowers what is left and works on a direct invoice', async () => {
  const n = (await one('sales', `select create_invoice_note($1, 'credit_note', 'Price') as id`, [dInv])).id;
  const lines = await as('sales', 'select id from invoice_lines where invoice_id = $1', [n]);
  await as('sales', `select save_note_line($1, $2, 'Correction', 1, 50)`, [n, lines[0].id]);
  await as('sales', 'select issue_invoice($1, next_invoice_number(), current_date)', [n]);
  eq(Number((await one('sales', 'select invoice_open_amount($1) as n', [dInv])).n), 200, 'left');
});
await ok('with an empty VAT: 20 % in Bulgaria, 0 % abroad, as on new orders', async () => {
  const bg = await one('sales', `insert into clients (legal_name, country_code) values ('BG Client', 'BG') returning id`);
  const de = await one('sales', `insert into clients (legal_name, country_code) values ('DE Client', 'DE') returning id`);
  const vat = async (c) => {
    const id = (await one('sales', 'select create_client_invoice($1, null, null, null, null, null) as id', [c])).id;
    return Number((await one('sales', 'select vat_pct from invoices where id = $1', [id])).vat_pct);
  };
  eq(await vat(bg.id) > 0, true, 'Bulgaria'); eq(await vat(de.id), 0, 'abroad');
});
await ok('production sees no payments and no open amount', async () => {
  eq((await as('production', 'select id from invoice_payments')).length, 0, 'payments');
  eq((await one('production', 'select invoice_open_amount($1) as n', [dInv])).n, null, 'amount');
});
await fails('a draft of an order keeps its lines from the order', () =>
  as('sales', `select save_note_line($1, null, 'x', 1, 1)`, [orig.id]), 'only the lines');

console.log('\nInvoice tools');
const tool = async (vat = 0) => {
  const id = (await one('sales', 'select create_client_invoice($1, $2, null, null, null, null) as id', [client.id, vat])).id;
  await as('sales', `select save_note_line($1, null, 'Service', 1, 100)`, [id]);
  return id;
};
await ok('a proforma has its own series, keeps its number and takes none of the invoice series', async () => {
  const id = await tool(20);
  const before = (await one('sales', 'select next_invoice_number() as n')).n;
  const a = (await one('sales', 'select proforma_from_draft($1) as n', [id])).n;
  eq(a.startsWith('PF-'), true, 'series');
  eq((await one('sales', 'select proforma_from_draft($1) as n', [id])).n, a, 'same');
  eq((await one('sales', 'select next_invoice_number() as n')).n, before, 'invoice series untouched');
  eq((await one('sales', 'select status, number from invoices where id = $1', [id])).number, null, 'no number');
  const s = (await one('sales', `select begin_document_send('proforma', $1, 'a@b.co', null, 'Proforma') as id`, [id])).id;
  await as('sales', 'select finish_document_send($1)', [s]);
});
await fails('a proforma needs lines', async () => {
  const id = (await one('sales', 'select create_client_invoice($1, 20, null, null, null, null) as id', [client.id])).id;
  await as('sales', 'select proforma_from_draft($1)', [id]);
}, 'without lines');
await fails('production cannot make a proforma', async () => as('production', 'select proforma_from_draft($1)', [dInv]), 'not allowed');
await fails('0 % VAT without a basis is not issued', async () => {
  const id = await tool(0);
  await as('sales', 'select issue_invoice($1, next_invoice_number(), current_date)', [id]);
}, 'basis');
await ok('with the basis it is issued and printed from the invoice', async () => {
  const id = await tool(0);
  await as('sales', `select set_client_invoice_terms($1, 0, null, null, 'bank', null, 'Export')`, [id]);
  await as('sales', 'select issue_invoice($1, next_invoice_number(), current_date)', [id]);
  eq((await one('sales', 'select vat_basis from invoices where id = $1', [id])).vat_basis, 'Export', 'kept');
});
await ok('a new draft like an earlier invoice: same lines and terms, no number, no due date', async () => {
  const id = (await one('sales', 'select copy_client_invoice($1) as id', [dInv])).id;
  const c = await one('sales', 'select status, number, due_date, proforma_no from invoices where id = $1', [id]);
  eq(c.status, 'draft', 'draft'); eq(c.number, null, 'number'); eq(c.due_date, null, 'due'); eq(c.proforma_no, null, 'proforma');
  eq((await as('sales', 'select id from invoice_lines where invoice_id = $1', [id])).length, 1, 'lines');
});
await fails('an invoice of an order is not copied', () => as('sales', 'select copy_client_invoice($1)', [orig.id]), 'without an order');
await ok('an invoice of a paid order counts as paid', async () => {
  eq(Number((await one('sales', 'select invoice_open_amount($1) as n', [orig.id])).n), 0, 'nothing to pay');
});

console.log('\nFollow-ups');
const fuClient = await one('sales', `insert into clients (legal_name, billing_email) values ('Followup Ltd', 'x@followup.test') returning id`);
const fuOffer = (await one('sales', `insert into calc_offers (offer_no, receiver_name, receiver_email, client_id, product_name, data, results)
  values ('NK-T-FU', 'Client', 'a@b.co', $1, 'Followup', '{}', '{}') returning id`, [fuClient.id])).id;
await db.query(`alter table calc_offers disable trigger user`);
await db.query(`update calc_offers set created_at = now() - interval '10 days' where id = $1`, [fuOffer]);
await db.query(`alter table calc_offers enable trigger user`);
await ok('an offer without an order after the set days waits for a reminder; a person takes it out', async () => {
  const has = async () => (await as('sales', 'select id from offers_waiting where id = $1', [fuOffer])).length;
  eq(await has(), 1, 'waiting');
  await db.query('update company_settings set offer_followup_days = 30');
  eq(await has(), 0, 'not yet');
  await db.query('update company_settings set offer_followup_days = 7');
  await as('sales', 'insert into calc_offer_closed (offer_id) values ($1)', [fuOffer]);
  eq(await has(), 0, 'closed');
});
await ok('production sees no offers waiting and no reorder list', async () => {
  eq((await as('production', 'select id from offers_waiting')).length, 0, 'offers');
  eq((await as('production', 'select client_id from clients_reorder_due')).length, 0, 'reorder');
  eq((await as('production', 'select offer_id from calc_offer_closed')).length, 0, 'closed');
});
await fails('these lists cannot be written', () => as('admin', `delete from offers_waiting`));
await ok('a client with regular orders and none open is due; an open order takes the client out', async () => {
  const c = await one('sales', `insert into clients (legal_name) values ('Regular Ltd') returning id`);
  const add = async (days, status) => {
    await db.query(`alter table sales_orders disable trigger user`);
    await db.query(`insert into sales_orders (code, client_id, currency, status, created_at) values ($4, $1, 'EUR', $2::order_status, now() - make_interval(days => $3::int))`, [c.id, status, days, `T-RE-${days}`]);
    await db.query(`alter table sales_orders enable trigger user`);
  };
  await add(260, 'closed'); await add(170, 'closed'); await add(80, 'closed');
  const r = await one('sales', 'select usual_gap, expected_on is not null as has from clients_reorder_due where client_id = $1', [c.id]);
  eq(r?.usual_gap, 90, 'gap');
  await add(1, 'unpaid');
  eq((await as('sales', 'select client_id from clients_reorder_due where client_id = $1', [c.id])).length, 0, 'open order');
});
await ok('Gmail is searched for company domains and full public addresses, never our own domain', async () => {
  await db.query(`insert into contacts (client_id, first_name, email) values ($1, 'P', 'petya@gmail.com'), ($1, 'N', 'x@nutrikal.com')`, [fuClient.id]);
  const t = (await db.query('select term from gmail_job_terms()')).rows.map((r) => r.term);
  eq(t.includes('followup.test'), true, 'domain'); eq(t.includes('petya@gmail.com'), true, 'public address');
  eq(t.includes('gmail.com'), false, 'no public domain'); eq(t.some((x) => x.includes('nutrikal.com')), false, 'not our own');
});
await fails('the job functions are not for signed-in users', () => as('admin', 'select * from gmail_job_terms()'), 'permission denied');

console.log('\nRoles: bookkeeper, accountant, designer');
for (const [k, id] of [['bookkeeper', '00000000-0000-0000-0000-0000000000b1'], ['accountant', '00000000-0000-0000-0000-0000000000b2'], ['designer', '00000000-0000-0000-0000-0000000000b3']]) {
  U[k] = id;
  await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query('insert into public.profiles (id, full_name, email, role) values ($1, $2, $3, $4)', [id, `Test ${k}`, `${k}@nutrikal.test`, k]);
}
/** As the app runs it: a transaction opened with app_session_start. */
const session = async (user, sql, params = []) => {
  await db.exec('reset role');
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U[user]]);
    await db.exec('set local role authenticated');
    await db.query('select public.app_session_start()');
    const rows = (await db.query(sql, params)).rows;
    await db.exec('commit');
    return rows;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
};
await ok('accountant sees clients, orders, invoices, payments and stock with their prices', async () => {
  for (const t of ['clients', 'sales_orders', 'sales_order_lines', 'invoices', 'invoice_payments', 'manufacturing_orders', 'calc_offers']) {
    eq((await session('accountant', `select count(*)::int as n from ${t}`))[0].n > 0, true, t);
  }
  eq((await session('accountant', 'select can_see_purchase_prices() as p'))[0].p, true, 'purchase prices');
});
await fails('accountant cannot change a client', () => session('accountant', `update clients set legal_name = 'x' where id = $1`, [client.id]), 'read-only');
await fails('accountant cannot issue through a function', () => session('accountant', 'select create_client_invoice($1, 20, null, null, null, null)', [client.id]), 'read-only');
await fails('accountant cannot record a payment', () => session('accountant', 'select add_invoice_payment($1, current_date, 1, null, null)', [dInv]));
await fails('accountant cannot post stock', () => session('accountant', 'select dispatch_order($1, current_date, $2::jsonb)', [order.id, '[]']));
await ok('outside a read-only transaction the accountant reads nothing', async () => {
  eq((await as('accountant', 'select id from clients')).length, 0, 'clients');
  eq((await as('accountant', 'select id from invoices')).length, 0, 'invoices');
});
await ok('designer sees clients, projects and order overviews', async () => {
  eq((await session('designer', 'select id from clients')).length > 0, true, 'clients');
  eq((await session('designer', 'select id from projects')).length > 0, true, 'projects');
  eq((await session('designer', 'select id from sales_order_overview')).length > 0, true, 'orders');
});
await ok('designer sees no prices: not the orders themselves, invoices, offers, costs or mail', async () => {
  for (const t of ['sales_orders', 'sales_order_lines', 'invoices', 'calc_offers', 'offers', 'client_emails', 'invoice_payments', 'lot_costs']) {
    eq((await session('designer', `select count(*)::int as n from ${t}`))[0].n, 0, t);
  }
  const cols = (await db.query(`select column_name from information_schema.columns where table_name in ('sales_order_overview', 'sales_order_line_overview')`)).rows.map((r) => r.column_name);
  eq(cols.some((c) => /price|total$|amount/.test(c)), false, 'no price column in the overviews');
});
await ok('designer changes nothing except client files', async () => {
  eq((await session('designer', `update clients set legal_name = 'x' where id = $1 returning id`, [client.id])).length, 0, 'client');
  eq((await session('designer', `update projects set name = 'x' returning id`)).length, 0, 'projects');
});
await fails('designer issues no documents', () => session('designer', 'select create_client_invoice($1, 20, null, null, null, null)', [client.id]), 'not allowed');
await ok('production still sees neither clients nor order overviews', async () => {
  eq((await as('production', 'select id from clients')).length, 0, 'clients');
  eq((await as('production', 'select id from sales_order_overview')).length, 0, 'orders');
});
await ok('bookkeeper works like Sales and records payments', async () => {
  const id = (await one('bookkeeper', 'select create_client_invoice($1, 20, null, null, null, null) as id', [client.id])).id;
  await as('bookkeeper', `select save_note_line($1, null, 'Service', 1, 100)`, [id]);
  await as('bookkeeper', 'select issue_invoice($1, next_invoice_number(), current_date)', [id]);
  await as('bookkeeper', 'select add_invoice_payment($1, current_date, 120, null, null)', [id]);
  eq(Number((await one('bookkeeper', 'select invoice_open_amount($1) as n', [id])).n), 0, 'paid');
});
await fails('bookkeeper does not approve recipes', () => as('bookkeeper', 'select approve_formula_version($1)', [v1.id]), 'not allowed');
await ok('bookkeeper reaches dispatch and the dashboard', async () => {
  eq((await one('bookkeeper', `select admin_dashboard(current_date - 30, current_date) as d`)).d !== null, true, 'dashboard');
  await as('bookkeeper', 'select dispatch_order($1, current_date, $2::jsonb)', [order.id, '[]']).catch((e) => { if (/not allowed/i.test(e.message)) throw e; });
});
await fails('bookkeeper does not change other people', () =>
  as('bookkeeper', `update profiles set role = 'admin' where id = $1 returning id`, [U.bookkeeper]).then((r) => { if (!r.length) throw new Error('refused'); }));

console.log('\nClient files');
let cf;
await ok('design uploads a file on a client; sales and admin see it', async () => {
  cf = (await one('designer', `insert into client_files (client_id, file_name, storage_path) values ($1, 'label.ai', 'a/b/c') returning id`, [client.id])).id;
  eq((await as('sales', 'select id from client_files where id = $1', [cf])).length, 1, 'sales');
  eq((await session('accountant', 'select id from client_files where id = $1', [cf])).length, 1, 'accountant');
});
await fails('accountant cannot upload', () => session('accountant', `insert into client_files (client_id, file_name, storage_path) values ($1, 'x', 'a/b/d')`, [client.id]));
await fails('production cannot upload', () => as('production', `insert into client_files (client_id, file_name, storage_path) values ($1, 'x', 'a/b/e')`, [client.id]));
await ok('production sees no client files', async () => { eq((await as('production', 'select id from client_files')).length, 0, 'files'); });
await ok('only the author or admin removes a file', async () => {
  eq((await as('sales', 'delete from client_files where id = $1 returning id', [cf])).length, 0, 'sales');
  eq((await as('designer', 'delete from client_files where id = $1 returning id', [cf])).length, 1, 'author');
});

console.log('\nChat');
const gen = (await one('admin', `select id from chat_channels where name = 'общи'`)).id;
await ok('people write in a channel; the others see it with the name and as unread', async () => {
  await as('designer', `select chat_post($1, 'Етикетът е готов')`, [gen]);
  const m = await as('sales', 'select author, body from chat_feed($1)', [gen]);
  eq(m[0].author, 'Test designer', 'author');
  eq(Number((await one('sales', 'select sum(unread) as n from chat_unread()')).n), 1, 'unread');
  await as('sales', 'insert into chat_reads (channel_id, user_id) values ($1, auth.uid())', [gen]);
  eq((await one('sales', 'select sum(unread) as n from chat_unread()')).n, null, 'read');
  eq((await session('accountant', 'select body from chat_feed($1)', [gen])).length, 1, 'accountant reads');
});
await fails('nobody writes as someone else', () => as('sales', `insert into chat_messages (channel_id, author_id, body) values ($1, $2, 'x')`, [gen, U.admin]));
await fails('only admin creates channels', () => as('sales', `insert into chat_channels (name) values ('x')`));
await ok('production sees no channels and no messages', async () => {
  eq((await as('production', 'select id from chat_messages')).length, 0, 'messages');
  eq((await as('production', 'select id from chat_feed($1)', [gen])).length, 0, 'feed');
});

console.log('\nChat: partner, direct messages, attachments, mentions, reactions');
const partnerCh = (await one('admin', `select id from chat_channels where kind = 'external'`)).id;
await ok('the partner sees only the partner channel and can write there', async () => {
  const l = await as('production', 'select id, kind from chat_channel_list()');
  eq(l.length, 1, 'one channel'); eq(l[0].kind, 'external', 'partner');
  await as('production', `select chat_post($1, 'Партидата е готова')`, [partnerCh]);
  eq((await as('sales', 'select body from chat_feed($1)', [partnerCh])).length, 1, 'team reads it');
});
await fails('the partner does not write in a team channel', () => as('production', `select chat_post($1, 'x')`, [gen]), 'not allowed');
await fails('the partner does not write directly into the table', () => as('production', `insert into chat_messages (channel_id, body) values ($1, 'x')`, [gen]));
await fails('the partner opens no direct messages', () => as('production', 'select chat_open_direct($1)', [U.sales]), 'not allowed');
await fails('nobody opens a direct conversation with the partner', () => as('sales', 'select chat_open_direct($1)', [U.production]), 'not allowed');
await ok('the partner does not list the team as people, except in the partner channel; the team finds no partner elsewhere', async () => {
  eq((await as('production', 'select id from chat_people()')).length, 0, 'no list');
  eq((await as('sales', 'select id from chat_people()')).some((x) => x.id === U.production), false, 'not for direct');
  eq((await as('sales', 'select id from chat_people($1)', [partnerCh])).some((x) => x.id === U.production), true, 'in the channel');
});
let dm;
await ok('a direct conversation is the same both ways and shows the other name', async () => {
  dm = (await one('sales', 'select chat_open_direct($1) as id', [U.designer])).id;
  eq((await one('designer', 'select chat_open_direct($1) as id', [U.sales])).id, dm, 'same');
  await as('sales', `select chat_post($1, 'Лично')`, [dm]);
  eq((await as('designer', 'select body from chat_feed($1)', [dm])).length, 1, 'other side');
  eq((await as('sales', `select name from chat_channel_list() where kind = 'direct'`))[0].name, 'Test designer', 'name');
});
await ok('nobody else reads a direct conversation: not admin, not the accountant, not the partner', async () => {
  eq((await as('admin', 'select id from chat_feed($1)', [dm])).length, 0, 'admin feed');
  eq((await as('admin', 'select id from chat_messages where channel_id = $1', [dm])).length, 0, 'admin table');
  eq((await session('accountant', 'select id from chat_feed($1)', [dm])).length, 0, 'accountant');
  eq((await as('production', 'select id from chat_feed($1)', [dm])).length, 0, 'partner');
  eq((await as('admin', 'select id from chat_search($1)', ['Лично'])).length, 0, 'search');
});
await fails('an outsider does not post into a direct conversation', () => as('bookkeeper', `select chat_post($1, 'x')`, [dm]), 'not allowed');
await ok('the accountant writes in the chat, and only there', async () => {
  await as('accountant', `select chat_post($1, 'От счетоводството')`, [gen]);
  eq((await as('sales', 'select body from chat_feed($1)', [gen])).some((x) => x.body === 'От счетоводството'), true, 'posted');
});
await ok('the accountant writing does not open anything else', async () => {
  eq((await as('accountant', `update clients set legal_name = 'x' where id = $1 returning id`, [client.id])).length, 0, 'clients');
  eq((await as('accountant', 'select id from invoices')).length, 0, 'invoices');
});
await fails('the accountant issues nothing outside read-only either', () => as('accountant', 'select create_client_invoice($1, 20, null, null, null, null)', [client.id]), 'not allowed');
await ok('a mention notifies a person of the channel, not an outsider of a direct conversation', async () => {
  await as('sales', `select chat_post($1, 'Виж това', $2::uuid[])`, [gen, [U.designer]]);
  const n = await as('designer', `select params, link from notifications where kind = 'chat_mention'`);
  eq(n.length, 1, 'told'); eq(n[0].params.channel, 'общи', 'channel');
  await as('sales', `select chat_post($1, 'Тайно', $2::uuid[])`, [dm, [U.admin]]);
  eq((await as('admin', `select id from notifications where kind = 'chat_mention'`)).length, 0, 'not told');
});
await ok('reactions: once each, shown with the count', async () => {
  const m = (await one('sales', `select id from chat_feed($1) order by created_at desc limit 1`, [gen])).id;
  await as('sales', `insert into chat_reactions (message_id, emoji) values ($1, ':capsule:')`, [m]);
  await as('designer', `insert into chat_reactions (message_id, emoji) values ($1, ':capsule:')`, [m]);
  const f = (await as('sales', 'select id, reactions from chat_feed($1)', [gen])).find((x) => x.id === m);
  eq(f.reactions[0].n, 2, 'count'); eq(f.reactions[0].mine, true, 'mine');
});
await fails('no reaction as someone else', () => as('sales', `insert into chat_reactions (message_id, user_id, emoji) select id, $1, 'x' from chat_messages limit 1`, [U.admin]));
await ok('attachments follow the channel', async () => {
  const m = (await one('sales', `select chat_post($1, 'Файл') as id`, [dm])).id;
  const a = (await one('sales', `insert into chat_attachments (message_id, file_name, storage_path) values ($1, 'a.pdf', 'x/y/z') returning id`, [m])).id;
  eq((await as('designer', 'select id from chat_attachments where id = $1', [a])).length, 1, 'member');
  eq((await as('admin', 'select id from chat_attachments where id = $1', [a])).length, 0, 'outsider');
  eq((await as('production', 'select id from chat_attachments where id = $1', [a])).length, 0, 'partner');
});
await ok('only the author edits a message', async () => {
  const m = (await one('sales', `select chat_post($1, 'Първо') as id`, [gen])).id;
  eq((await as('admin', `update chat_messages set body = 'x' where id = $1 returning id`, [m])).length, 0, 'admin');
  eq((await as('sales', `update chat_messages set body = 'Второ', edited_at = now() where id = $1 returning id`, [m])).length, 1, 'author');
});

console.log('\nCatalogue of stock formulas');
async function asAnon(sql, params = []) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  await db.exec('set role anon');
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const catFormula = (await one('sales', `insert into formulas (name, product_format, serving_size, servings_per_pack) values ('Каталожна', 'powder', 5, 30) returning id`)).id;
const catVersion = (await one('sales', 'select id from formula_versions where formula_id = $1', [catFormula])).id;
const catItem = (await one('admin', `select id from items where type = 'raw_material' and is_active limit 1`)).id;
await as('sales', `insert into formula_lines (version_id, item_id, amount, overage_pct) values ($1, $2, 100, 7)`, [catVersion, catItem]);
await fails('Sales does not create catalogue products', () => as('sales', 'select catalog_from_formula($1)', [catFormula]), 'not allowed');
const catProduct = (await one('admin', 'select catalog_from_formula($1) as id', [catFormula])).id;
await ok('a second press opens the same product', async () => {
  eq((await one('admin', 'select catalog_from_formula($1) as id', [catFormula])).id, catProduct, 'id');
});
await fails('no publishing without an approved recipe', () => as('admin', 'update catalog_products set is_published = true where id = $1', [catProduct]), 'catalog_not_approved');
await as('admin', 'update formula_versions set shelf_life_months = 24 where id = $1', [catVersion]);
await as('admin', 'select approve_formula_version($1)', [catVersion]);
await fails('no publishing without a price at the minimum order', () => as('admin', 'update catalog_products set is_published = true where id = $1', [catProduct]), 'catalog_no_minimum_tier');
await fails('no price below the minimum of the product', () => as('admin', 'insert into catalog_price_tiers (product_id, min_qty, unit_price) values ($1, 499, 5)', [catProduct]), 'catalog_below_minimum');
await fails('Sales does not change prices', () => as('sales', 'insert into catalog_price_tiers (product_id, min_qty, unit_price) values ($1, 500, 5)', [catProduct]));
await as('admin', 'insert into catalog_price_tiers (product_id, min_qty, unit_price) values ($1, 500, 5), ($1, 1000, 4)', [catProduct]);
await ok('nobody signed in sees nothing while it is a draft', async () => {
  const d = (await asAnon('select catalog_public() as d'))[0].d;
  eq(d.products.filter((p) => p.name === 'Каталожна').length, 0, 'draft');
});
await as('admin', 'update catalog_products set is_published = true where id = $1', [catProduct]);
const catCode = (await one('admin', 'select code from catalog_products where id = $1', [catProduct])).code;
await ok('Admin sets the picture and the names by language; the open catalog shows them', async () => {
  const img = '/api/catalog-image/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.webp';
  await as('admin', `update catalog_products set image = $2, names = '{"de": "Katalogprodukt"}' where id = $1`, [catProduct, img]);
  const p = (await asAnon('select catalog_public() as d'))[0].d.products.find((x) => x.code === catCode);
  eq(p.image, img, 'picture'); eq(p.names.de, 'Katalogprodukt', 'German name');
  const changed = await as('sales', 'update catalog_products set image = null, names = \'{}\' where id = $1 returning id', [catProduct]);
  eq(changed.length, 0, 'Sales changes nothing');
  await fails('names must be an object', () => as('admin', `update catalog_products set names = '[]' where id = $1`, [catProduct]));
  await as('admin', `update catalog_products set image = null, names = '{}' where id = $1`, [catProduct]);
});
await ok('a recipe of a client can be published and the client does not show', async () => {
  const client = (await one('admin', 'select id, legal_name from clients limit 1'));
  const f = (await one('sales', `insert into formulas (name, product_format, serving_size, client_id) values ('На клиент', 'powder', 5, $1) returning id`, [client.id])).id;
  const v = (await one('sales', 'select id from formula_versions where formula_id = $1', [f])).id;
  await as('sales', 'insert into formula_lines (version_id, item_id, amount) values ($1, $2, 100)', [v, catItem]);
  await as('admin', 'update formula_versions set shelf_life_months = 24 where id = $1', [v]);
  await as('admin', 'select approve_formula_version($1)', [v]);
  const p = (await one('admin', 'select catalog_from_formula($1) as id', [f])).id;
  await as('admin', 'insert into catalog_price_tiers (product_id, min_qty, unit_price) values ($1, 500, 5)', [p]);
  await as('admin', 'update catalog_products set is_published = true where id = $1', [p]);
  const raw = JSON.stringify((await asAnon('select catalog_public() as d'))[0].d);
  if (!raw.includes('На клиент')) throw new Error('not published');
  if (raw.includes(client.legal_name)) throw new Error('client shown');
  await as('admin', 'update catalog_products set is_published = false where id = $1', [p]);
});
await ok('the open catalogue shows only the listed fields, no cost or overage', async () => {
  const d = (await asAnon('select catalog_public() as d'))[0].d;
  const p = d.products.find((x) => x.code === catCode);
  eq(p.tiers.length, 2, 'tiers'); eq(p.ingredients.length, 1, 'ingredients');
  eq(Object.keys(p).sort().join(), 'category_id,claims,code,description,description_bg,extra_category_ids,format,image,ingredients,min_qty,name,name_bg,names,pack,pack_bg,price_on_request,serving_size,serving_unit,servings_per_pack,tiers', 'fields');
  eq(Object.keys(p.ingredients[0]).sort().join(), 'amount,name,name_bg,unit', 'ingredient fields');
});
await fails('nobody signed in reads no table', () => asAnon('select * from catalog_products'), 'denied');
await fails('nobody signed in reads no enquiry', () => asAnon('select * from catalog_enquiries'), 'denied');
await ok('nobody signed in sees no clients, recipes or prices of materials', async () => {
  for (const t of ['clients', 'formulas', 'formula_lines', 'supplier_prices', 'calc_offers']) eq((await asAnon(`select 1 from ${t}`)).length, 0, t);
});
await ok('the catalogue is public with prices and composition; bars from 3000; no price stays a draft', async () => {
  const d = (await asAnon('select catalog_public() as d'))[0].d;
  eq(d.products.filter((p) => !p.price_on_request && /^(NTL-|GP-)/.test(p.code)).length, 98, 'public');
  eq(d.products.filter((p) => p.code === 'NTL-SP101').length, 0, 'no price');
  const th = d.products.find((p) => p.code === 'NTL-TH101');
  eq(th.ingredients[0].name, 'Glucosamine Sulfate', 'name'); eq(th.ingredients[0].amount, '350 mg', 'amount'); eq(th.format, 'capsule', 'format');
  eq(th.tiers.length, 4, 'tiers'); eq(th.tiers[0].unit_price, 6.2, 'price');
  eq(d.products.find((p) => p.code === 'GP-101').min_qty, 3000, 'bar');
});
await ok('Essentials and Mushrooms are capsules, softgels and powders stay what they are', async () => {
  const f = Object.fromEntries((await as('admin', "select code, product_format from catalog_products where code in ('NTL-EN101', 'NTL-M101', 'NTL-EN103', 'NTL-EN104', 'NTL-EN120')")).map((r) => [r.code, r.product_format]));
  eq(f['NTL-EN101'], 'capsule', 'nutrient'); eq(f['NTL-M101'], 'capsule', 'mushroom');
  eq(f['NTL-EN103'], 'softgel', 'D3'); eq(f['NTL-EN104'], 'softgel', 'omega'); eq(f['NTL-EN120'], 'powder', 'colostrum');
});
await ok('the 46 new formulations are public on request, notes and specifications stay private', async () => {
  const rows = await as('admin', "select code, review_status, is_published, internal_notes from catalog_products where price_on_request");
  eq(rows.length, 44, 'count'); eq(rows.filter((r) => r.is_published).length, 44, 'published');
  if (!rows.find((r) => r.code === 'NTL-WH103').internal_notes.includes('evidence_gap')) throw new Error('status lost');
  const d = (await asAnon('select catalog_public() as d'))[0].d;
  const raw = JSON.stringify(d);
  for (const x of ['"spec"', '"basis"', 'internal_notes', 'efsa.onlinelibrary', 'Retinyl acetate', 'Review status', 'Предупреждение за лабораторни']) if (raw.includes(x)) throw new Error('private data: ' + x);
  const p = d.products.find((x) => x.code === 'NTL-C105');
  eq(p.tiers.length, 0, 'no price'); eq(p.price_on_request, true, 'on request'); eq(p.extra_category_ids.length, 3, 'links');
  eq(Object.keys(p.ingredients[0]).sort().join(), 'amount,name,name_bg,unit', 'no specification');
  const no = (await asAnon('select catalog_submit_enquiry($1::jsonb) as no', [JSON.stringify({ company: 'Ц', contact_name: 'Ц', email: 'c@c.test', lines: [{ code: 'NTL-C105', quantity: 500 }] })]))[0].no;
  const e = await one('sales', 'select l.unit_price from catalog_enquiry_lines l join catalog_enquiries e on e.id = l.enquiry_id where e.number = $1', [no]);
  eq(e.unit_price, null, 'no price on the line');
});
await fails('a product put back in review cannot go public again', async () => {
  await as('admin', "update catalog_products set is_published = false, review_status = 'draft_formulation' where code = 'NTL-EN123'");
  await as('admin', "update catalog_products set is_published = true where code = 'NTL-EN123'");
}, 'catalog_in_review');
await fails('a concept marked as an evidence gap cannot go public', async () => {
  await as('admin', "update catalog_products set is_published = false, review_status = 'evidence_gap' where code = 'NTL-LC104'");
  await as('admin', "update catalog_products set is_published = true where code = 'NTL-LC104'");
}, 'catalog_no_formula');
await ok('Production and Design see no review notes or category links; nobody signed in neither', async () => {
  for (const r of ['production', 'designer']) eq((await as(r, 'select product_id from catalog_product_categories')).length, 0, r);
});
await fails('nobody signed in reads no category link', () => asAnon('select * from catalog_product_categories'), 'denied');
await ok('the public ingredient list has names only, and only Admin changes it', async () => {
  const d = (await asAnon('select catalog_public() as d'))[0].d;
  if (d.ingredient_list.length < 120) throw new Error('short ' + d.ingredient_list.length);
  eq(Object.keys(d.ingredient_list[0]).sort().join(), 'grp,name', 'fields');
  eq((await as('sales', "update catalog_ingredient_list set name = 'x' returning id")).length, 0, 'sales');
  eq((await as('production', 'select id from catalog_ingredient_list')).length, 0, 'production');
});
await fails('nobody signed in reads no ingredient table', () => asAnon('select * from catalog_ingredient_list'), 'denied');
await ok('a visitor chats through the functions only; Sales reads it, Production does not', async () => {
  const t = (await asAnon("select catalog_chat_turn(null, 'v1', 'en', 'Hello') as t"))[0].t;
  await asAnon("select catalog_chat_reply($1, 'Hi there')", [t.chat]);
  const n = (await asAnon("select catalog_chat_turn($1, 'v1', 'en', 'More') as t", [t.chat]))[0].t;
  eq(n.chat, t.chat, 'same chat'); eq(n.history.length, 3, 'history'); eq(n.history[1].role, 'assistant', 'order');
  eq((await as('sales', 'select id from catalog_chat_messages where chat_id = $1', [t.chat])).length, 3, 'sales');
  eq((await as('production', 'select id from catalog_chats')).length, 0, 'production');
  eq((await as('designer', 'select id from catalog_chat_messages')).length, 0, 'designer');
});
await ok('a long conversation keeps its last 40 messages in order', async () => {
  let chat = null;
  for (let i = 0; i < 25; i++) { chat = (await asAnon("select catalog_chat_turn($1, $2, 'en', $3) as t", [chat, 'mem' + i, 'Q' + i]))[0].t.chat; await asAnon("select catalog_chat_reply($1, 'A')", [chat]); }
  const t = (await asAnon("select catalog_chat_turn($1, 'mem', 'en', 'Last') as t", [chat]))[0].t;
  eq(t.history.length, 40, 'length'); eq(t.history.at(-1).content, 'Last', 'newest last');
});
await fails('nobody signed in reads a conversation', () => asAnon('select * from catalog_chat_messages'), 'denied');
await fails('Sales does not write in a visitor conversation', () => as('sales', "insert into catalog_chats (visitor_key) values ('x')"), 'denied');
await fails('an empty question is refused', () => asAnon("select catalog_chat_turn(null, 'v1', 'en', '  ')"), 'catalog_invalid');
await fails('a visitor is stopped after 40 questions a day', async () => {
  for (let i = 0; i < 41; i++) await asAnon("select catalog_chat_turn(null, 'v2', 'en', 'Q')");
}, 'catalog_chat_limit');
await ok('old conversations without an enquiry go, those with an enquiry stay', async () => {
  const no = (await asAnon('select catalog_submit_enquiry($1::jsonb) as no', [JSON.stringify({ company: 'Ч', contact_name: 'Ч', email: 'chat@c.test', lines: [], message: 'Въпрос' })]))[0].no;
  const a = (await asAnon("select catalog_chat_turn(null, 'v3', 'en', 'Old') as t"))[0].t.chat;
  const b = (await asAnon("select catalog_chat_turn(null, 'v3', 'en', 'Kept') as t"))[0].t.chat;
  await asAnon('select catalog_chat_link($1, $2)', [b, no]);
  await db.exec("reset role");
  await db.query("update catalog_chats set last_at = now() - interval '13 months' where id = any($1::uuid[])", [[a, b]]);
  await db.query('select catalog_chat_purge()');
  eq((await db.query('select id from catalog_chats where id = any($1::uuid[])', [[a, b]])).rows.length, 1, 'kept');
});
await ok('60/40 is the default and the two capsule products have lower doses', async () => {
  eq(Number((await one('admin', 'select default_deposit_pct from company_settings limit 1')).default_deposit_pct ?? 60), 60, 'deposit');
  if (!(await one('admin', 'select default_payment_terms from calc_settings limit 1')).default_payment_terms.startsWith('60%')) throw new Error('calculator');
  const p = await one('admin', "select pack, ingredients -> 0 ->> 'amount' as a from catalog_products where code = 'NTL-MH102'");
  eq(p.a, '1500 mg', 'citrulline'); eq(p.pack, 'Target: 4 capsules', 'pack');
});
await fails('Sales does not publish everything', () => as('sales', 'select catalog_publish_ready()'), 'not allowed');
await ok('publish all ready takes what is ready and leaves out what has no price', async () => {
  await as('admin', "update catalog_products set is_published = false where code = 'NTL-TH101'");
  await as('admin', 'select catalog_publish_ready()');
  eq((await one('admin', "select is_published from catalog_products where code = 'NTL-TH101'")).is_published, true, 'back up');
  eq((await one('admin', "select is_published from catalog_products where code = 'NTL-SP101'")).is_published, false, 'no price');
});
await fails('no enquiry for a bar below its minimum', async () => {
  await asAnon('select catalog_submit_enquiry($1::jsonb)', [JSON.stringify({ company: 'Б', contact_name: 'Б', email: 'b@b.test', lines: [{ code: 'GP-101', quantity: 2999 }] })]);
}, 'catalog_invalid');
const enquiry = (o = {}) => JSON.stringify({ company: 'Нова фирма', contact_name: 'Иван Иванов', email: 'ivan@nova.test', lines: [{ code: catCode, quantity: 1200, unit_price: 0.01 }], ...o });
await fails('no enquiry below the minimum', () => asAnon('select catalog_submit_enquiry($1::jsonb)', [enquiry({ lines: [{ code: catCode, quantity: 499 }] })]), 'catalog_invalid');
await fails('no enquiry without a valid e-mail', () => asAnon('select catalog_submit_enquiry($1::jsonb)', [enquiry({ email: 'x' })]), 'catalog_invalid');
await fails('no empty enquiry', () => asAnon('select catalog_submit_enquiry($1::jsonb)', [enquiry({ lines: [] })]), 'catalog_invalid');
await ok('a question without products arrives with the enquiries', async () => {
  const no = (await asAnon('select catalog_submit_enquiry($1::jsonb) as no', [enquiry({ email: 'q@nova.test', lines: [], message: 'Do you make gummies?' })]))[0].no;
  const e = await one('sales', 'select message from catalog_enquiries where number = $1', [no]);
  eq(e.message, 'Do you make gummies?', 'message');
});
await ok('Premium Blends are powders in a doypack', async () => {
  const p = await one('admin', "select product_format, pack from catalog_products where code = 'NTL-PB101'");
  eq(p.product_format, 'powder', 'format'); eq(p.pack, 'Powder in a doypack', 'pack');
});
await fails('no enquiry for an unknown product', () => asAnon('select catalog_submit_enquiry($1::jsonb)', [enquiry({ lines: [{ code: 'X', quantity: 500 }] })]), 'catalog_invalid');
let enquiryId;
await ok('an enquiry takes the tier price from the database and tells Sales', async () => {
  const no = (await asAnon('select catalog_submit_enquiry($1::jsonb) as no', [enquiry()]))[0].no;
  const e = await one('sales', 'select id, status from catalog_enquiries where number = $1', [no]);
  enquiryId = e.id; eq(e.status, 'new', 'status');
  eq(Number((await one('sales', 'select unit_price from catalog_enquiry_lines where enquiry_id = $1', [e.id])).unit_price), 4, 'price');
  if (!(await as('sales', `select id from notifications where kind = 'catalog_enquiry'`)).length) throw new Error('not told');
});
await ok('Production and Design see no enquiries and no catalogue', async () => {
  for (const r of ['production', 'designer']) {
    eq((await as(r, 'select id from catalog_enquiries')).length, 0, r);
    eq((await as(r, 'select id from catalog_products')).length, 0, r);
    eq((await as(r, 'select id from catalog_price_tiers')).length, 0, r);
  }
});
await fails('what the client wrote cannot be changed', () => as('sales', `update catalog_enquiries set company = 'x' where id = $1`, [enquiryId]), 'denied');
await fails('Production does not turn an enquiry into a client', () => as('production', 'select catalog_enquiry_to_client($1)', [enquiryId]), 'not allowed');
await ok('an enquiry becomes a lead with a contact and a note; again gives the same client', async () => {
  const c = (await one('sales', 'select catalog_enquiry_to_client($1) as id', [enquiryId])).id;
  const row = await one('sales', 'select status, source from clients where id = $1', [c]);
  eq(row.status, 'lead', 'lead'); eq(row.source, 'catalogue', 'source');
  eq((await as('sales', 'select id from contacts where client_id = $1', [c])).length, 1, 'contact');
  eq((await as('sales', 'select id from activities where client_id = $1', [c])).length, 1, 'note');
  eq((await one('sales', 'select catalog_enquiry_to_client($1) as id', [enquiryId])).id, c, 'same');
});
await ok('a known e-mail finds the same client', async () => {
  const no = (await asAnon('select catalog_submit_enquiry($1::jsonb) as no', [enquiry({ company: 'Друго име' })]))[0].no;
  const id = (await one('sales', 'select id from catalog_enquiries where number = $1', [no])).id;
  const first = (await one('sales', 'select client_id from catalog_enquiries where id = $1', [enquiryId])).client_id;
  eq((await one('sales', 'select catalog_enquiry_to_client($1) as id', [id])).id, first, 'client');
});
await fails('five enquiries an hour from one address, then no more', async () => {
  for (let i = 0; i < 5; i++) await asAnon('select catalog_submit_enquiry($1::jsonb)', [enquiry()]);
}, 'catalog_busy');

console.log('\nCustomer panel');
const portalUser = async (key, id) => {
  U[key] = id;
  await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query(`insert into public.profiles (id, full_name, email, role) values ($1, $2, $3, 'client')`, [id, `Client ${key}`, `${key}@client.test`]);
};
await portalUser('clientA', 'cccccccc-0000-4000-8000-0000000000a1');
await portalUser('clientB', 'cccccccc-0000-4000-8000-0000000000b2');
const portalCo = async (name) => (await one('sales', `insert into clients (legal_name, country_code) values ($1, 'BG') returning id`, [name])).id;
const coA = await portalCo('Портал А'), coB = await portalCo('Портал Б');
await fails('Sales does not connect accounts', () => as('sales', 'select client_user_connect($1, $2)', [U.clientA, coA]), '');
await as('admin', 'select client_user_connect($1, $2)', [U.clientA, coA]);
await as('admin', 'select client_user_connect($1, $2)', [U.clientB, coB]);
await fails('a staff account is not connected to a client', () => as('admin', 'select client_user_connect($1, $2)', [U.sales, coA]), 'Not a client');
const portalOrder = async (code, client, status) => (await db.query(
  `insert into sales_orders (code, client_id, status, currency, notes, confirmed_at) values ($1, $2, $3::order_status, 'EUR', 'ТАЙНА БЕЛЕЖКА', now()) returning id`, [code, client, status])).rows[0].id;
await db.exec('reset role');
const ordA = await portalOrder('PORT-A', coA, 'draft'), ordDraft = await portalOrder('PORT-D', coA, 'draft'), ordB = await portalOrder('PORT-B', coB, 'confirmed');
await db.query(`insert into sales_order_lines (order_id, kind, description, quantity, unit_price) values ($1, 'service', 'Етикет', 2, 10.5)`, [ordA]);
await db.query(`update sales_orders set status = 'confirmed' where id = $1`, [ordA]);
await ok('a client account sees nothing beyond itself in any table or view', async () => {
  await db.exec('reset role');
  const all = (await db.query(`select table_name from information_schema.tables where table_schema = 'public'`)).rows.map((r) => r.table_name);
  const seen = [];
  for (const t of all) {
    let n = 0;
    try { n = (await as('clientA', `select 1 from public."${t}" limit 2`)).length; } catch { n = 0; }
    if (n > 0) seen.push(t);
  }
  eq(seen.filter((t) => t !== 'profiles').join(), '', 'tables');
  eq((await as('clientA', 'select id from profiles')).length, 1, 'only own profile');
});
await fails('a client writes to no table', () => as('clientA', `insert into client_messages (client_id, from_client, body) values ($1, false, 'x')`, [coA]), '');
await ok('a client cannot change its own role', async () => {
  try { await as('clientA', `update profiles set role = 'admin' where id = auth.uid()`); } catch { /* refused */ }
  await db.exec('reset role');
  eq((await db.query('select role::text as r from profiles where id = $1', [U.clientA])).rows[0].r, 'client', 'role');
});
await ok('a client sees its own orders, never a draft or another client', async () => {
  eq((await as('clientA', 'select code from portal_orders()')).map((x) => x.code).join(), 'PORT-A', 'orders');
  eq((await one('clientA', 'select portal_order($1) as d', [ordB])).d, null, 'other client');
  eq((await one('clientA', 'select portal_order($1) as d', [ordDraft])).d, null, 'draft');
  const d = (await one('clientA', 'select portal_order($1) as d', [ordA])).d;
  eq(d.code, 'PORT-A', 'own'); eq(Number(d.value), 21, 'value');
  if (JSON.stringify(d).includes('ТАЙНА')) throw new Error('internal note leaked');
});
await ok('staff get nothing from the portal functions', async () => {
  eq((await as('sales', 'select code from portal_orders()')).length, 0, 'orders');
});
await ok('a stopped account sees nothing', async () => {
  await as('admin', 'select client_user_active($1, false)', [U.clientA]);
  eq((await as('clientA', 'select code from portal_orders()')).length, 0, 'orders');
  await as('admin', 'select client_user_active($1, true)', [U.clientA]);
});
await ok('a file reaches the client only once it is shared', async () => {
  const f = (await one('sales', `insert into client_files (client_id, order_id, file_name, storage_path) values ($1, $2, 'spec.pdf', 'p/spec.pdf') returning id`, [coA, ordA])).id;
  eq((await as('clientA', 'select 1 from portal_documents()')).length, 0, 'not shared');
  eq((await as('clientA', 'select 1 from portal_file($1)', [f])).length, 0, 'no download');
  await as('sales', 'select client_file_share($1, true)', [f]);
  eq((await as('clientA', 'select name from portal_documents()'))[0].name, 'spec.pdf', 'shared');
  eq((await as('clientA', 'select storage_path from portal_file($1)', [f])).length, 1, 'download');
  eq((await as('clientB', 'select 1 from portal_documents()')).length, 0, 'other client');
  eq((await as('clientB', 'select 1 from portal_file($1)', [f])).length, 0, 'other client download');
  await as('sales', 'select client_file_share($1, false)', [f]);
  eq((await as('clientA', 'select 1 from portal_file($1)', [f])).length, 0, 'taken back');
});
await fails('Production does not share files', () => as('production', 'select client_file_share($1, true)', ['00000000-0000-0000-0000-000000000000']), '');
await ok('messages stay within one client and reach the team', async () => {
  await as('clientA', `select portal_post($1, 'Кога е готово?')`, [ordA]);
  eq((await as('admin', `select id from notifications where kind = 'client_message'`)).length > 0, true, 'told');
  eq((await as('sales', 'select body from client_messages where order_id = $1', [ordA]))[0].body, 'Кога е готово?', 'team reads');
  eq((await as('clientB', 'select body from portal_feed($1)', [ordA])).length, 0, 'other client');
  await as('sales', `select client_message_send($1, $2, 'Следващата седмица')`, [coA, ordA]);
  eq((await one('clientA', 'select portal_me() as d')).d.unread, 1, 'unread');
  await as('clientA', 'select portal_mark_read($1)', [ordA]);
  eq((await one('clientA', 'select portal_me() as d')).d.unread, 0, 'read');
  eq((await as('clientA', 'select author from portal_feed($1)', [ordA])).length, 2, 'both sides');
});
await fails('no post on an order of another client', () => as('clientB', `select portal_post($1, 'x')`, [ordA]), 'Not allowed');
await fails('no reply to the wrong client', () => as('sales', `select client_message_send($1, $2, 'x')`, [coB, ordA]), 'another client');
await ok('Production reads no client message', async () => {
  eq((await as('production', 'select id from client_messages')).length, 0, 'none');
});
await ok('a client sees its issued invoices with the open amount, never a draft or another client', async () => {
  await as('admin', `update company_settings set legal_name = 'Nutrikal', vat_number = 'BG123456789'`).catch(() => {});
  const inv = (await one('admin', `select create_client_invoice($1, 20, current_date + 14, 'bank', 'R', null) as id`, [coA])).id;
  await as('admin', `select save_note_line($1, null, 'Дизайн', 2, 100)`, [inv]);
  eq((await as('clientA', 'select id from portal_invoices()')).length, 0, 'draft hidden');
  eq((await one('clientA', 'select portal_invoice($1) as d', [inv])).d, null, 'draft document hidden');
  await as('admin', 'select issue_invoice($1, next_invoice_number(), current_date, true)', [inv]);
  const [row] = await as('clientA', 'select total, open_amount from portal_invoices()');
  eq(Number(row.total), 240, 'total'); eq(Number(row.open_amount), 240, 'open');
  await as('admin', `select add_invoice_payment($1, current_date, 100, 'bank', null)`, [inv]);
  eq(Number((await one('clientA', 'select open_amount from portal_invoices()')).open_amount), 140, 'after a payment');
  const d = (await one('clientA', 'select portal_invoice($1) as d', [inv])).d;
  eq(d.lines.length, 1, 'lines'); eq(d.lines[0].description, 'Дизайн', 'line');
  eq((await as('clientB', 'select id from portal_invoices()')).length, 0, 'other client list');
  eq((await one('clientB', 'select portal_invoice($1) as d', [inv])).d, null, 'other client document');
});
await ok('a certificate reaches the client only once it is shared, and only its own', async () => {
  await db.exec('reset role');
  const item = (await db.query(`select id from items where is_active limit 1`)).rows[0].id;
  const lot = (await db.query(`insert into lots (lot_number, item_id, coa_path) values ('PORT-LOT', $1, 'x/coa.pdf') returning id`, [item])).rows[0].id;
  const line = (await db.query(`select id from sales_order_lines where order_id = $1 limit 1`, [ordA])).rows[0].id;
  const fv = (await db.query(`select id from formula_versions limit 1`)).rows[0].id;
  await db.query(`alter table manufacturing_orders disable trigger user`);
  await db.query(`insert into manufacturing_orders (code, formula_version_id, sales_order_line_id, quantity, status, finished_lot_id, produced_quantity, notes)
                  values ('MO-PORT', $1, $2, 10, 'completed', $3, 10, 'ВЪТРЕШНО')`, [fv, line, lot]);
  await db.query(`alter table manufacturing_orders enable trigger user`);
  eq((await as('clientA', 'select 1 from portal_coa($1)', [lot])).length, 0, 'not shared');
  const before = (await one('clientA', 'select portal_order($1) as d', [ordA])).d;
  eq(before.batches[0].coa, false, 'no link yet');
  if (JSON.stringify(before).includes('ВЪТРЕШНО') || JSON.stringify(before).includes('MO-PORT')) throw new Error('production data leaked');
  await as('sales', 'select lot_coa_share($1, true)', [lot]);
  eq((await as('clientA', 'select coa_path from portal_coa($1)', [lot])).length, 1, 'shared');
  eq((await as('clientB', 'select 1 from portal_coa($1)', [lot])).length, 0, 'other client');
  eq((await as('clientA', `select name from portal_documents() where kind = 'coa'`))[0].name, 'PORT-LOT', 'listed');
});
await ok('the company address is right', async () => {
  eq((await one('admin', 'select company_address as a from calc_settings limit 1')).a, '133 Knyaz Boris I Blvd., 9000 Varna, Bulgaria', 'address');
});
await fails('Production does not share certificates', () => as('production', 'select lot_coa_share($1, true)', ['00000000-0000-0000-0000-000000000000']), '');
await ok('a client is no member of the staff chat', async () => {
  eq((await as('clientA', 'select id from chat_people()')).length, 0, 'people');
  eq((await as('sales', `select id from chat_people() where full_name like 'Client %'`)).length, 0, 'nor listed to staff');
});
await ok('a conversation has a status: the client opens it, the team answers, the team can solve it', async () => {
  const row = async () => (await one('sales', 'select status, assigned_to, unread, last_body from client_inbox() where order_id = $1', [ordA]));
  await as('clientA', `select portal_post($1, 'Още един въпрос')`, [ordA]);
  eq((await row()).status, 'open', 'open'); eq((await row()).unread > 0, true, 'unread');
  await as('sales', `select client_message_send($1, $2, 'Отговор')`, [coA, ordA]);
  eq((await row()).status, 'waiting', 'waiting'); eq((await row()).last_body, 'Отговор', 'last');
  await as('sales', `select client_thread_set($1, $2, 'solved', $3)`, [coA, ordA, U.sales]);
  eq((await row()).status, 'solved', 'solved'); eq((await row()).assigned_to, U.sales, 'assigned');
  eq((await as('clientA', 'select status from portal_threads() where order_id = $1', [ordA]))[0].status, 'solved', 'client sees it');
  eq((await as('clientB', 'select 1 from portal_threads()')).length, 0, 'other client');
  await as('clientA', `select portal_post($1, 'Пак аз')`, [ordA]);
  eq((await row()).status, 'open', 'reopened');
});
await fails('a conversation goes only to someone of the team', () => as('sales', `select client_thread_set($1, $2, 'open', $3)`, [coA, ordA, U.production]), 'team');
await fails('a client has no inbox', () => as('clientA', 'select * from client_inbox()'), '');
await fails('Production has no inbox', () => as('production', 'select * from client_inbox()'), '');
await ok('a client reads its own proforma and delivery note, without internal notes', async () => {
  const d = (await one('clientA', 'select portal_proforma($1) as d', [ordA])).d;
  eq(d.doc.code, 'PORT-A', 'own'); eq(d.lines.length, 1, 'lines');
  if (JSON.stringify(d).includes('ТАЙНА')) throw new Error('internal note leaked');
  eq((await one('clientB', 'select portal_proforma($1) as d', [ordA])).d, null, 'other client');
  eq((await one('clientA', 'select portal_proforma($1) as d', [ordDraft])).d, null, 'draft');
  await db.exec('reset role');
  const did = (await db.query(`insert into dispatches (code, order_id, carrier, notes) values ('D-PORT', $1, 'DHL', 'ВЪТРЕШНО') returning id`, [ordA])).rows[0].id;
  const n = (await one('clientA', 'select portal_delivery($1) as d', [did])).d;
  eq(n.note.carrier, 'DHL', 'own note');
  if (JSON.stringify(n).includes('ВЪТРЕШНО')) throw new Error('note leaked');
  eq((await one('clientB', 'select portal_delivery($1) as d', [did])).d, null, 'other client');
});
await ok('final proforma: the advance base comes from the advance invoice, only for the team and the own client', async () => {
  eq((await one('admin', 'select order_advance_base($1)::text as b', [ordA])).b, null, 'no advance invoice yet');
  await db.exec('reset role');
  const inv = (await db.query(`insert into invoices (kind, purpose, order_id, client_id, currency, vat_pct, seller, buyer)
    values ('invoice', 'advance', $1, $2, 'EUR', 20, '{}', '{}') returning id`, [ordA, coA])).rows[0].id;
  await db.query(`insert into invoice_lines (invoice_id, sort_order, kind, description, quantity, unit_price, amount) values ($1, 0, 'advance', 'Аванс', 1, 1143, 1143)`, [inv]);
  eq((await one('sales', 'select order_advance_base($1)::text as b', [ordA])).b, '1143.00', 'draft: sum of its lines');
  eq((await one('clientA', 'select order_advance_base($1)::text as b', [ordA])).b, '1143.00', 'own client');
  eq((await one('clientB', 'select order_advance_base($1)::text as b', [ordA])).b, null, 'other client');
  eq((await one('production', 'select order_advance_base($1)::text as b', [ordA])).b, null, 'Production');
  await db.exec('reset role');
  await db.query(`update invoices set subtotal = 1142.5 where id = $1`, [inv]);
  eq((await one('admin', 'select order_advance_base($1)::text as b', [ordA])).b, '1142.50', 'subtotal wins');
  await db.exec('reset role');
  await db.query(`delete from invoices where id = $1`, [inv]);
});
await ok('a change of status waits for the e-mail, only for an account of that client', async () => {
  await db.exec('reset role');
  await db.query(`alter table sales_orders disable trigger user`);
  await db.query(`alter table sales_orders enable trigger sales_orders_status_mail`);
  await db.query(`update sales_orders set status = 'ready' where id = $1`, [ordA]);
  await db.query(`alter table sales_orders enable trigger user`);
  const jobs = (await db.query('select * from client_status_jobs()')).rows;
  eq(jobs.filter((j) => j.code === 'PORT-A' && j.status === 'ready').length, 1, 'queued'); eq(jobs.find((j) => j.code === 'PORT-A').email, 'clientA@client.test', 'to the client');
  await db.query('select client_status_done()');
  eq((await db.query('select * from client_status_jobs()')).rows.length, 0, 'sent once');
});
await fails('nobody signed in runs the mail job', () => as('admin', 'select * from client_status_jobs()'), 'permission');
await ok('what is still to pay on an order follows its payments, with VAT', async () => {
  await db.exec('reset role');
  const order = (await db.query(`insert into sales_orders (code, client_id, status, currency, vat_pct, deposit_pct) values ('PORT-P', $1, 'draft', 'EUR', 20, 60) returning id`, [coA])).rows[0].id;
  await db.query(`insert into sales_order_lines (order_id, kind, description, quantity, unit_price) values ($1, 'service', 'Партида', 1, 1000)`, [order]);
  await db.query(`alter table sales_orders disable trigger user`);
  const set = (sql) => db.query(`update sales_orders set ${sql} where id = $1`, [order]);
  await set(`status = 'confirmed'`);
  const due = async () => { await db.exec('reset role'); return Number((await as('clientA', 'select due from portal_orders() where code = $1', ['PORT-P']))[0].due); };
  eq(await due(), 1200, 'nothing paid');
  await set(`deposit_received_on = current_date`);
  eq(await due(), 480, 'deposit paid');
  await set(`balance_received_on = current_date`);
  eq(await due(), 0, 'all paid');
  await set(`status = 'cancelled', balance_received_on = null, deposit_received_on = null`);
  eq(await due(), 0, 'cancelled');
  await db.exec('reset role');
  await db.query(`alter table sales_orders enable trigger user`);
});
await ok('a client reads only its own amounts', async () => {
  eq((await as('clientB', `select 1 from portal_orders() where code = 'PORT-P'`)).length, 0, 'other client');
});
await ok('a client cannot call the helpers of the amounts', async () => {
  let refused = false;
  try { await as('clientA', 'select portal_order_due($1)', [ordA]); } catch { refused = true; }
  eq(refused, true, 'refused');
});

await ok('a client sees nothing of the queue or the threads directly', async () => {
  eq((await as('clientA', 'select 1 from client_threads')).length, 0, 'threads');
  eq((await as('clientA', 'select 1 from client_status_mail')).length, 0, 'queue');
});

console.log('\nScrap and losses');
await ok('material above plan is counted by reason', async () => {
  await db.exec('reset role');
  const item = (await db.query(`select id from items where is_active limit 1`)).rows[0].id;
  const fv = (await db.query(`select id from formula_versions limit 1`)).rows[0].id;
  await db.query(`alter table manufacturing_orders disable trigger user`);
  const mk = async (code, reason, used) => {
    const id = (await db.query(`insert into manufacturing_orders (code, formula_version_id, quantity, status, produced_on) values ($1, $2, 10, 'completed', current_date) returning id`, [code, fv])).rows[0].id;
    await db.query(`insert into mo_material_usage (mo_id, item_id, reserved, used, reason) values ($1, $2, 10, $3, $4)`, [id, item, used, reason]);
  };
  await mk('MO-L1', 'scrap', 12); await mk('MO-L2', 'scrap', 11); await mk('MO-L3', 'Счупена машина', 13); await mk('MO-L4', null, 10);
  await db.query(`alter table manufacturing_orders enable trigger user`);
  const r = await as('admin', `select reason, batches, quantity from mo_loss_report(current_date - 1, current_date)`);
  const scrap = r.find((x) => x.reason === 'scrap');
  eq(scrap.batches, 2, 'scrap batches'); eq(Number(scrap.quantity), 3, 'scrap qty');
  eq(Number(r.find((x) => x.reason === 'other').quantity), 3, 'free text is other');
  eq(r.length, 2, 'nothing above plan stays out');
});
await fails('Sales has no loss report', () => as('sales', 'select * from mo_loss_report(current_date, current_date)'), '');
await fails('the partner has no loss report', () => as('production', 'select * from mo_loss_report(current_date, current_date)'), '');
await fails('a client has no loss report', () => as('clientA', 'select * from mo_loss_report(current_date, current_date)'), '');

console.log('\nProduction calendar');
await db.exec('reset role');
await db.query(`alter table sales_orders disable trigger user`);
const calOrder = (await db.query(`insert into sales_orders (code, client_id, status, currency, requested_date) values ('CAL-1', $1, 'confirmed', 'EUR', current_date + 5) returning id`, [coA])).rows[0].id;
await db.query(`alter table sales_orders enable trigger user`);
await db.query(`alter table sales_order_lines disable trigger user`);
await db.exec('reset role');
const calProject = (await one('sales', `insert into projects (client_id, name, product_format) values ($1, 'Календар', 'capsule') returning id`, [coA])).id;
await db.exec('reset role');
const calLine = (await db.query(`insert into sales_order_lines (order_id, kind, description, quantity, unit_price) values ($1, 'service', 'Партида', 1, 1) returning id`, [calOrder])).rows[0].id;
await db.query(`alter table sales_order_lines enable trigger user`);
await db.query(`alter table manufacturing_orders disable trigger user`);
const calFv = (await db.query(`select id from formula_versions limit 1`)).rows[0].id;
const calMo = (await db.query(`insert into manufacturing_orders (code, formula_version_id, project_id, sales_order_line_id, quantity, status, planned_date)
  values ('MO-CAL', $1, $2, $3, 100, 'scheduled', current_date + 3) returning id`, [calFv, calProject, calLine])).rows[0].id;
await db.query(`alter table manufacturing_orders enable trigger user`);
const calRange = [new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10)];
await ok('the partner sees a scheduled batch without client or order', async () => {
  const r = await as('production', `select * from production_calendar($1, $2) where code = 'MO-CAL'`, calRange);
  eq(r.length, 1, 'seen'); eq(r[0].project_code != null, true, 'code');
  const raw = JSON.stringify(r);
  if (raw.includes('Портал А') || Object.keys(r[0]).some((k) => /client|order|requested|price/.test(k))) throw new Error('client data leaked');
});
await ok('the team sees the client and a date past the requested one', async () => {
  await as('admin', 'select mo_reschedule($1, current_date + 8)', [calMo]);
  const r = (await as('sales', `select * from staff_calendar($1, $2) where code = 'MO-CAL'`, calRange))[0];
  eq(r.client, 'Портал А', 'client'); eq(r.past_requested, true, 'past'); eq(r.late, false, 'not late');
});
await fails('the partner has no team calendar', () => as('production', 'select * from staff_calendar($1, $2)', calRange), '');
await fails('a client has no calendar', () => as('clientA', 'select * from production_calendar($1, $2)', calRange), '');
await fails('Sales does not move a batch', () => as('sales', 'select mo_reschedule($1, current_date + 1)', [calMo]), '');
await fails('the partner does not move a batch', () => as('production', 'select mo_reschedule($1, current_date + 1)', [calMo]), '');
await ok('moving tells the partner and needs a new answer', async () => {
  eq((await as('production', `select id from notifications where kind = 'mo_date_changed'`)).length > 0, true, 'told');
  await as('production', `select mo_date_answer($1, null, 'Добре')`, [calMo]);
  eq((await one('sales', `select date_state from staff_calendar($1, $2) where code = 'MO-CAL'`, calRange)).date_state, 'confirmed', 'confirmed');
  await as('admin', 'select mo_reschedule($1, current_date + 4)', [calMo]);
  eq((await one('sales', `select date_state from staff_calendar($1, $2) where code = 'MO-CAL'`, calRange)).date_state, 'pending', 'asked again');
});
await ok('a proposed date goes through Admin', async () => {
  await as('production', `select mo_date_answer($1, current_date + 10, 'Няма капацитет')`, [calMo]);
  const r = await one('sales', `select date_state, proposed_date, date_note, on_date from staff_calendar($1, $2) where code = 'MO-CAL'`, calRange);
  eq(r.date_state, 'proposed', 'proposed'); eq(r.date_note, 'Няма капацитет', 'note');
  eq((await as('admin', `select id from notifications where kind = 'mo_date_answer'`)).length > 0, true, 'told');
  await as('admin', 'select mo_date_decide($1, true)', [calMo]);
  const a = await one('sales', `select date_state, proposed_date, on_date from staff_calendar($1, $2) where code = 'MO-CAL'`, calRange);
  eq(a.date_state, 'confirmed', 'accepted'); eq(a.proposed_date, null, 'cleared');
});
await fails('the partner does not accept its own date', () => as('production', 'select mo_date_decide($1, true)', [calMo]), '');
await ok('a client sees two weeks once confirmed, never a date', async () => {
  const w = (await one('clientA', 'select portal_order_window($1) as w', [calOrder])).w;
  eq(typeof w.from, 'number', 'week'); eq(Object.keys(w).sort().join(), 'from,to', 'only weeks');
  eq((await one('clientB', 'select portal_order_window($1) as w', [calOrder])).w, null, 'other client');
  await as('admin', 'select mo_reschedule($1, current_date + 12)', [calMo]);
  eq((await one('clientA', 'select portal_order_window($1) as w', [calOrder])).w, null, 'not confirmed, nothing shown');
  if (JSON.stringify((await one('clientA', 'select portal_order($1) as d', [calOrder])).d).includes('planned')) throw new Error('date leaked');
});
await fails('a closed batch does not move', async () => {
  await db.exec('reset role');
  await db.query(`alter table manufacturing_orders disable trigger user`);
  await db.query(`update manufacturing_orders set status = 'completed' where id = $1`, [calMo]);
  await db.query(`alter table manufacturing_orders enable trigger user`);
  await as('admin', 'select mo_reschedule($1, current_date + 1)', [calMo]);
}, 'closed');

console.log('\nEnd to end: offers as the calculator saves them, recipes, order, payment, production, release, dispatch, invoices');
// The offers carry what the calculator form really sends: a catalog offer has no product type, the default
// capsules per dose '1' and may keep rows of an earlier custom formula.
const e2e = {};
const e2eRecipe = async (offerId) => one('sales', `select f.id, f.product_format as fmt, f.serving_size::float as size, f.serving_unit as unit, f.servings_per_pack as per,
    (select sku from items where id = f.shell_item_id) as shell, v.id as version,
    (select string_agg(i.sku, ',' order by i.sku) from formula_packaging p join items i on i.id = p.item_id where p.version_id = v.id) as pack,
    (select count(*)::int from formula_lines where version_id = v.id) as lines,
    (select count(*)::int from formula_pending_lines where version_id = v.id) as pending
  from formulas f join formula_versions v on v.formula_id = f.id where f.calc_offer_id = $1 order by v.version desc limit 1`, [offerId]);
const e2eOffer = async (no, productType, data, price) => (await one('sales',
  `insert into calc_offers (offer_no, receiver_name, receiver_email, client_id, product_name, product_type, data, results)
   values ($1, 'Buyer', 'buyer@e2e.test', $2, $1 || ' product', $3, $4::jsonb, $5::jsonb) returning id`,
  [no, e2e.client, productType, JSON.stringify(data), JSON.stringify({ unitPrice: price })])).id;
await ok('e2e setup: a client without own terms and two raw materials', async () => {
  e2e.client = (await one('sales', `insert into clients (legal_name, country_code) values ('E2E Brands Ltd', 'DE') returning id`)).id;
  for (const [k, sku, name] of [['mg', 'RM-E2E-MG', 'E2E Magnesium'], ['zn', 'RM-E2E-ZN', 'E2E Zinc']]) {
    e2e[k] = (await one('admin', `insert into items (sku, type, name, base_unit, novel_food_status, shelf_life_months)
                                  values ($1, 'raw_material', $2, 'kg', 'not_novel', 24) returning id`, [sku, name])).id;
  }
});
await ok('e2e A: a custom formula in plastic jars: capsules, servings, a matched and a pending ingredient, shell, jar and lid', async () => {
  e2e.offerA = await e2eOffer('NK-E2E-A', 'capsules_plastic', { mode: 'custom', productType: 'capsules_plastic', capsulesPerDose: '2', quantityPerUnit: '60',
    numberOfUnits: '1000', lid: 'plastic', rows: [{ name: 'E2E Magnesium', amount: '300', unit: 'mg' }, { name: 'E2E Unknown herb', amount: '10', unit: 'mg' }] }, 4);
  const r = await e2eRecipe(e2e.offerA);
  eq(`${r.fmt}:${r.size}${r.unit}:${r.per}`, 'capsule:2pcs:30', 'serving');
  eq(`${r.lines}/${r.pending}`, '1/1', 'lines/pending'); eq(r.shell, 'PK-CAPS-00', 'shell'); eq(r.pack, 'PK-JAR-PL,PK-LID-PL', 'jar and lid');
});
await ok('e2e B: a catalog capsule product as the form saves it: the catalog decides serving, servings per jar, composition and packaging', async () => {
  e2e.offerB = await e2eOffer('NK-E2E-B', null, { mode: 'catalog', productType: null, capsulesPerDose: '1', quantityPerUnit: '', numberOfUnits: '500',
    jar: 'glass', catalogCapsules: '90', rows: [{ name: 'Stale row', amount: '5', unit: 'mg' }],
    catalog: { code: 'NTL-E2E', name: 'E2E Catalog Caps', capsules_per_serving: 2, capsules_per_container: 60, servings_per_container: 30, serving_g: null,
      tiers: [{ min_qty: 500, price: 5 }], composition: [{ name: 'E2E Magnesium', amount: 200, unit: 'mg', note: null }, { name: 'E2E Zinc', amount: 10, unit: 'mg', note: null }] } }, 7.9);
  const r = await e2eRecipe(e2e.offerB);
  eq(`${r.fmt}:${r.size}${r.unit}:${r.per}`, 'capsule:2pcs:45', '90 capsules a jar, 2 a serving');
  eq(`${r.lines}/${r.pending}`, '2/0', 'catalog composition, no stale row'); eq(r.shell, 'PK-CAPS-00', 'shell'); eq(r.pack, 'PK-JAR-GL,PK-LID-AL', 'glass jar, aluminium lid');
});
await ok('e2e C: a catalog powder: grams per serving from the catalog, no capsule, jar or lid', async () => {
  e2e.offerC = await e2eOffer('NK-E2E-C', null, { mode: 'catalog', productType: null, capsulesPerDose: '1', numberOfUnits: '500', rows: [],
    catalog: { code: 'NTL-E2EP', name: 'E2E Catalog Powder', capsules_per_serving: null, capsules_per_container: null, serving_g: 10, servings_per_container: 30,
      tiers: [{ min_qty: 500, price: 6 }], composition: [{ name: 'E2E Magnesium', amount: 2, unit: 'g', note: null }] } }, 6);
  const r = await e2eRecipe(e2e.offerC);
  eq(`${r.fmt}:${r.size}${r.unit}:${r.per}`, 'powder:10g:30', 'serving'); eq(`${r.shell}:${r.pack}`, 'null:null', 'no packaging');
});
await fails('e2e: a recipe with an ingredient still to link is not approved', async () => {
  await as('admin', 'select approve_formula_version($1)', [(await e2eRecipe(e2e.offerA)).version]);
}, 'Link every ingredient');
await ok('e2e: a discarded draft and a new version keep the ingredient to link; linked, it is approved', async () => {
  const a = await e2eRecipe(e2e.offerA);
  await as('sales', `update formula_versions set status = 'archived' where id = $1`, [a.version]);
  await as('sales', 'select new_formula_version($1)', [a.id]);
  const v2 = await e2eRecipe(e2e.offerA);
  eq(`${v2.lines}/${v2.pending}`, '1/1', 'copied with the pending line');
  const p = await one('sales', 'select id from formula_pending_lines where version_id = $1', [v2.version]);
  await as('sales', 'select link_recipe_pending_line($1, $2)', [p.id, e2e.zn]);
  await as('admin', 'select approve_formula_version($1)', [v2.version]);
  for (const o of [e2e.offerB, e2e.offerC]) await as('admin', 'select approve_formula_version($1)', [(await e2eRecipe(o)).version]);
  eq((await as('sales', `select v.status from formula_versions v join formulas f on f.id = v.formula_id
                          where f.calc_offer_id = any($1) and v.status = 'approved'`, [[e2e.offerA, e2e.offerB, e2e.offerC]])).length, 3, 'three approved');
});
await ok('e2e: the order takes the company terms: 60 % deposit, balance before dispatch', async () => {
  e2e.order = (await one('sales', 'select create_order_from_calc_offers($1, $2) as id', [e2e.client, [e2e.offerA, e2e.offerB, e2e.offerC]])).id;
  const o = await one('sales', 'select status, deposit_pct::float as d, balance_terms from sales_orders where id = $1', [e2e.order]);
  eq(`${o.status}:${o.d}:${o.balance_terms}`, 'unpaid:60:before_dispatch', 'terms');
  const l = await as('sales', 'select quantity, unit_price::float as p from sales_order_lines where order_id = $1 order by sort_order', [e2e.order]);
  eq(l.map((x) => `${x.quantity}x${x.p}`).join(), '1000x4,500x7.9,500x6', 'lines');
});
await ok('e2e: the bookkeeper confirms the advance; admin prepares production for all three products', async () => {
  await as('bookkeeper', `select confirm_order_payment($1, 'advance', 1000)`, [e2e.order]);
  eq((await one('sales', 'select status from sales_orders where id = $1', [e2e.order])).status, 'confirmed', 'confirmed');
  const r = (await one('admin', 'select prepare_order_production($1) as r', [e2e.order])).r;
  eq(`${r.created}:${r.no_recipe.length}:${r.no_servings.length}`, '3:0:0', 'three batches');
  e2e.mos = (await as('admin', `select m.id, m.code from manufacturing_orders m join sales_order_lines l on l.id = m.sales_order_line_id
                                 where l.order_id = $1 order by l.sort_order`, [e2e.order]));
});
await ok('e2e: materials arrive at the partner; each batch is scheduled, reserved and sent to production', async () => {
  for (const m of e2e.mos) {
    m.lots = {};
    for (const x of await as('admin', 'select item_id, required::float as q from mo_material_requirements($1)', [m.id])) {
      m.lots[x.item_id] = await recv(x.item_id, Math.ceil(x.q * 1000) / 1000 + 0.001, 'NK-WH');
    }
    await as('admin', 'select schedule_mo($1, current_date + 3)', [m.id]);
    // the stock waits in the Nutrikal warehouse: Admin moves it to the partner
    eq((await one('admin', 'select move_mo_materials_to_production($1) as n', [m.id])).n > 0, true, 'moved');
    eq((await one('admin', 'select move_mo_materials_to_production($1) as n', [m.id])).n, 0, 'nothing left to move');
    await as('admin', 'select release_mo($1)', [m.id]);
  }
  eq((await one('sales', 'select status from sales_orders where id = $1', [e2e.order])).status, 'in_production', 'order in production');
});
await fails('e2e: only Admin moves materials to production', () => as('production', 'select move_mo_materials_to_production($1)', [e2e.mos[0].id]), 'not allowed');
await ok('e2e: the partner confirms the dates, starts and reports each batch; batches wait in quarantine', async () => {
  e2e.lots = [];
  for (const [i, m] of e2e.mos.entries()) {
    await as('production', 'select mo_date_answer($1, null, null)', [m.id]);
    await as('production', 'select start_production($1)', [m.id]);
    // The partner names the lots it used: lots at its locations, as much as was reserved
    const usage = [];
    for (const r of await as('admin', `select item_id, sum(quantity)::float as quantity from stock_reservations
                                        where manufacturing_order_id = $1 and status = 'active' group by item_id`, [m.id])) {
      let left = r.quantity;
      for (const s of await as('admin', `select lot_id, location_id, quantity::float as q from stock_balances
                                          where item_id = $1 and qc_status = 'released' and is_production_location(location_id) and quantity > 0
                                          order by expires_on nulls last, lot_number`, [r.item_id])) {
        if (left <= 1e-9) break;
        const take = Math.min(left, s.q);
        usage.push({ lot_id: s.lot_id, location_id: s.location_id, quantity: Math.round(take * 10000) / 10000 });
        left -= take;
      }
    }
    const qty = (await one('admin', 'select quantity from manufacturing_orders where id = $1', [m.id])).quantity;
    const lot = (await one('production', `select complete_production($1, $2, $3, current_date, $4::jsonb, '[]'::jsonb, current_date + 700) as lot`,
      [m.id, `E2E-B${i + 1}`, qty, JSON.stringify(usage)])).lot;
    eq((await one('admin', 'select qc_status from lots where id = $1', [lot])).qc_status, 'quarantine', 'quarantine');
    e2e.lots.push({ lot, qty });
  }
});
await ok('e2e: Admin releases the batches; the order is ready; the final payment is confirmed', async () => {
  for (const x of e2e.lots) await as('admin', `select set_lot_qc_status($1, 'released')`, [x.lot]);
  await as('admin', `update sales_orders set status = 'ready' where id = $1`, [e2e.order]);
  await as('bookkeeper', 'select confirm_final_payment($1)', [e2e.order]);
});
await ok('e2e: advance invoice, dispatch with a delivery note, final invoice, order closed', async () => {
  const adv = (await one('sales', `select create_order_invoice($1, 'advance') as id`, [e2e.order])).id;
  await as('sales', 'select issue_invoice($1, next_invoice_number(), current_date)', [adv]);
  const lines = JSON.stringify(e2e.lots.map((x) => ({ lot_id: x.lot, location_id: L['FG'], quantity: x.qty })));
  await as('bookkeeper', 'select dispatch_order($1, current_date, $2::jsonb)', [e2e.order, lines]);
  eq((await one('sales', 'select status from sales_orders where id = $1', [e2e.order])).status, 'dispatched', 'dispatched');
  const fin = (await one('sales', 'select create_order_invoice($1) as id', [e2e.order])).id;
  eq((await one('sales', 'select purpose from invoices where id = $1', [fin])).purpose, 'final', 'final invoice');
  await as('sales', 'select issue_invoice($1, next_invoice_number(), current_date)', [fin]);
  await as('sales', `update sales_orders set status = 'closed' where id = $1`, [e2e.order]);
  eq((await one('sales', 'select status from sales_orders where id = $1', [e2e.order])).status, 'closed', 'closed');
});
await ok('e2e: a recipe without servings per pack is named by prepare production instead of stopping the order', async () => {
  const off = await e2eOffer('NK-E2E-D', 'capsules_plastic', { mode: 'custom', productType: 'capsules_plastic', capsulesPerDose: '1', quantityPerUnit: '',
    numberOfUnits: '100', rows: [{ name: 'E2E Zinc', amount: '5', unit: 'mg' }] }, 3);
  const r = await e2eRecipe(off);
  eq(r.per, null, 'no servings per pack');
  await as('admin', 'select approve_formula_version($1)', [r.version]);
  const o = (await one('sales', 'select create_order_from_calc_offers($1, $2) as id', [e2e.client, [off]])).id;
  await as('admin', `select confirm_order_payment($1, 'full')`, [o]);
  const p = (await one('admin', 'select prepare_order_production($1) as r', [o])).r;
  eq(`${p.created}:${p.no_servings.join()}`, '0:NK-E2E-D product', 'named');
  await as('sales', 'update formulas set servings_per_pack = 100 where id = $1', [r.id]);
  eq((await one('admin', 'select prepare_order_production($1) as r', [o])).r.created, 1, 'prepared once set');
});

// --- Approve with risk: a not authorised Novel Food ingredient (owner, Nov 2026) ---
const risk = {};
await ok('risk: a recipe with a not authorised Novel Food ingredient', async () => {
  risk.f = (await one('sales', `insert into formulas (name, product_format, serving_size) values ('Risk recipe', 'capsule', 1) returning id`)).id;
  risk.v = (await one('sales', 'select id from formula_versions where formula_id = $1', [risk.f])).id;
  await as('sales', `insert into formula_lines (version_id, item_id, amount) values ($1, $2, 100), ($1, $3, 10)`, [risk.v, mcc.id, novelBlocked.id]);
});
await fails('risk: without a reason the approval is still refused', () =>
  as('admin', 'select approve_formula_version($1)', [risk.v]), 'not authorised novel food');
await fails('risk: a blank reason is no reason', () =>
  as('admin', `select approve_formula_version($1, '   ')`, [risk.v]), 'not authorised novel food');
await fails('risk: sales cannot approve with risk', () =>
  as('sales', `select approve_formula_version($1, 'client insists')`, [risk.v]), 'not allowed');
await ok('risk: a reason a draft carries does not count until Admin approves', async () => {
  await as('sales', `update formula_versions set novel_risk_note = 'set by sales' where id = $1`, [risk.v]);
  const v = await one('admin', 'select novel_risk_note, novel_risk_by from formula_versions where id = $1', [risk.v]);
  eq(v.novel_risk_note, null, 'note cleared on a draft'); eq(v.novel_risk_by, null, 'nobody');
});
await ok('risk: Admin approves with a reason; reason, who and when are kept', async () => {
  await as('admin', `select approve_formula_version($1, '  Export outside the EU  ')`, [risk.v]);
  const v = await one('admin', 'select status, novel_risk_note, novel_risk_by, novel_risk_at from formula_versions where id = $1', [risk.v]);
  eq(v.status, 'approved', 'approved'); eq(v.novel_risk_note, 'Export outside the EU', 'reason trimmed');
  eq(v.novel_risk_by, U.admin, 'accepted by admin'); eq(!!v.novel_risk_at, true, 'when');
});
await fails('risk: the accepted risk is locked with the approved version', () =>
  as('admin', `update formula_versions set novel_risk_note = 'changed' where id = $1`, [risk.v]), 'locked');
await ok('risk: a reason is not kept when nothing is blocked', async () => {
  const f = (await one('sales', `insert into formulas (name, product_format, serving_size) values ('No risk recipe', 'capsule', 1) returning id`)).id;
  const v = (await one('sales', 'select id from formula_versions where formula_id = $1', [f])).id;
  await as('sales', `insert into formula_lines (version_id, item_id, amount) values ($1, $2, 100)`, [v, mcc.id]);
  await as('admin', `select approve_formula_version($1, 'not needed')`, [v]);
  eq((await one('admin', 'select novel_risk_note from formula_versions where id = $1', [v])).novel_risk_note, null, 'no note');
});
await fails('risk: production does not see recipe versions', async () => {
  const rows = await as('production', 'select id from formula_versions where id = $1', [risk.v]);
  if (rows.length === 0) throw new Error('not visible');
}, 'not visible');

console.log('\nCorrections of an order until it goes to production (owner, Nov 2026)');
const cor = {};
const corLines = async (o) => as('sales', 'select kind, description, quantity, unit_price::float as price from sales_order_lines where order_id = $1 order by sort_order', [o]);
await ok('corrections: an unpaid order from two offers of a client', async () => {
  cor.client = (await one('sales', `insert into clients (legal_name, country_code) values ('Correct Me Ltd', 'BG') returning id`)).id;
  cor.other = (await one('sales', `insert into clients (legal_name, country_code) values ('Right Client Ltd', 'BG') returning id`)).id;
  const offer = async (no) => (await one('sales',
    `insert into calc_offers (offer_no, receiver_name, receiver_email, client_id, product_name, data, results)
     values ($1, 'Buyer', '', $2, $1 || ' product', '{"numberOfUnits": "1000"}'::jsonb, '{"unitPrice": 4}'::jsonb) returning id`, [no, cor.client])).id;
  cor.offer1 = await offer('NK-COR-1'); cor.offer2 = await offer('NK-COR-2');
  cor.order = (await one('sales', 'select create_order_from_calc_offers($1, $2) as id', [cor.client, [cor.offer1]])).id;
  eq((await one('sales', 'select status from sales_orders where id = $1', [cor.order])).status, 'unpaid', 'unpaid');
  cor.line = (await one('sales', 'select id from sales_order_lines where order_id = $1', [cor.order])).id;
});
await fails('corrections: a reason is required', () =>
  as('sales', `select correct_order_line($1, 2000, 3.5, ' ')`, [cor.line]), 'reason');
await fails('corrections: production cannot correct an order', () =>
  as('production', `select correct_order_line($1, 2000, 3.5, 'x')`, [cor.line]), 'not allowed');
await fails('corrections: lines stay locked outside a correction', () =>
  as('sales', 'delete from sales_order_lines where id = $1', [cor.line]), 'only change on a draft');
await ok('corrections: Sales changes quantity and price; the log keeps before, after, reason and who', async () => {
  await as('sales', `select correct_order_line($1, 2000, 3.5, 'Client wants more at a lower price')`, [cor.line]);
  eq((await corLines(cor.order)).map((l) => `${l.quantity}x${l.price}`).join(), '2000x3.5', 'line');
  const c = await one('admin', 'select kind, detail, reason, created_by from order_corrections where order_id = $1', [cor.order]);
  eq(`${c.kind}:${JSON.stringify(c.detail.quantity)}:${JSON.stringify(c.detail.unit_price)}`, 'line:[1000,2000]:[4,3.5]', 'before and after');
  eq(`${c.reason}:${c.created_by}`, `Client wants more at a lower price:${U.sales}`, 'reason and who');
});
await fails('corrections: nothing changed is not a correction', () =>
  as('sales', `select correct_order_line($1, 2000, 3.5, 'again')`, [cor.line]), 'nothing to correct');
await ok('corrections: another offer of the client and a service are added, the service removed', async () => {
  await as('sales', `select correct_order_add_offer($1, $2, 'Second product')`, [cor.order, cor.offer2]);
  const s = (await one('sales', `select correct_order_add_service($1, 'Label design', 1, 150, 'Forgotten') as id`, [cor.order])).id;
  eq((await corLines(cor.order)).map((l) => `${l.kind}:${l.quantity}x${l.price}`).join(), 'calc_offer:2000x3.5,calc_offer:1000x4,service:1x150', 'lines');
  await as('sales', `select correct_order_remove_line($1, 'Client designs the label')`, [s]);
  eq((await corLines(cor.order)).length, 2, 'service removed');
});
await fails('corrections: an offer already in the order is not added twice', () =>
  as('sales', `select correct_order_add_offer($1, $2, 'again')`, [cor.order, cor.offer2]), 'already in an order');
await ok('corrections: VAT and the terms of the balance', async () => {
  await as('sales', `select correct_order_terms($1, 9, 'net_days', 30, 'Reduced rate, 30 days')`, [cor.order]);
  const o = await one('sales', 'select vat_pct::float as vat, balance_terms, balance_net_days from sales_orders where id = $1', [cor.order]);
  eq(`${o.vat}:${o.balance_terms}:${o.balance_net_days}`, '9:net_days:30', 'terms');
});
await ok('corrections: client and currency; the offers and their recipes go with the order', async () => {
  await as('sales', `select correct_order_client($1, $2, 'eur', 'Ordered for the sister company')`, [cor.order, cor.other]);
  eq((await one('sales', 'select client_id from sales_orders where id = $1', [cor.order])).client_id, cor.other, 'order client');
  const offers = await as('sales', 'select distinct client_id from calc_offers where id = any($1::uuid[])', [[cor.offer1, cor.offer2]]);
  eq(offers.map((x) => x.client_id).join(), cor.other, 'offers moved');
  const recipes = await as('sales', 'select distinct client_id from formulas where calc_offer_id = any($1::uuid[])', [[cor.offer1, cor.offer2]]);
  eq(recipes.every((x) => x.client_id === cor.other), true, 'recipes moved');
});
await fails('corrections: the offer of the order stays locked for anything else', () =>
  as('sales', `update calc_offers set product_name = 'changed' where id = $1`, [cor.offer1]), 'in an order');
await ok('corrections: one product is removed; the last one is not', async () => {
  const l2 = (await one('sales', 'select id from sales_order_lines where order_id = $1 and calc_offer_id = $2', [cor.order, cor.offer2])).id;
  await as('sales', `select correct_order_remove_line($1, 'Not this time')`, [l2]);
  let refused = '';
  try { await as('sales', `select correct_order_remove_line($1, 'all')`, [cor.line]); } catch (e) { refused = e.message; }
  eq(/last product/.test(refused), true, 'last product kept');
  eq((await one('admin', 'select count(*)::int as n from order_corrections where order_id = $1', [cor.order])).n, 7, 'seven corrections logged');
});
await fails('corrections: production does not see the corrections', async () => {
  const rows = await as('production', 'select id from order_corrections where order_id = $1', [cor.order]);
  if (rows.length === 0) throw new Error('not visible');
}, 'not visible');
await ok('corrections: a planned batch not yet sent is cancelled when its quantity changes; prepared again at the new quantity', async () => {
  const off = await e2eOffer('NK-COR-P', 'capsules_plastic', { mode: 'custom', productType: 'capsules_plastic', capsulesPerDose: '1', quantityPerUnit: '60',
    numberOfUnits: '100', rows: [{ name: 'E2E Zinc', amount: '5', unit: 'mg' }] }, 3);
  const r = await e2eRecipe(off);
  await as('admin', 'select approve_formula_version($1)', [r.version]);
  cor.p = (await one('sales', 'select create_order_from_calc_offers($1, $2) as id', [e2e.client, [off]])).id;
  await as('admin', `select confirm_order_payment($1, 'full')`, [cor.p]);
  eq((await one('admin', 'select prepare_order_production($1) as r', [cor.p])).r.created, 1, 'prepared');
  const line = (await one('sales', 'select id from sales_order_lines where order_id = $1', [cor.p])).id;
  const mo = await one('admin', 'select id, status from manufacturing_orders where sales_order_line_id = $1', [line]);
  await as('sales', `select correct_order_line($1, 150, 3, 'Client adds 50 jars')`, [line]);
  eq((await one('admin', 'select status from manufacturing_orders where id = $1', [mo.id])).status, 'cancelled', 'old batch cancelled');
  eq((await one('admin', `select count(*)::int as n from stock_reservations where manufacturing_order_id = $1 and status = 'active'`, [mo.id])).n, 0, 'reservations released');
  eq((await one('admin', 'select prepare_order_production($1) as r', [cor.p])).r.created, 1, 'prepared again');
  eq((await one('admin', `select quantity from manufacturing_orders where sales_order_line_id = $1 and status <> 'cancelled'`, [line])).quantity, 150, 'new quantity');
});
await fails('corrections: a product tied to a recipe keeps its client', () =>
  as('sales', `select correct_order_client($1, $2, 'EUR', 'x')`, [cor.p, cor.other]), 'tied to recipes');
await ok('corrections: with an issued invoice VAT no longer changes, quantities still do', async () => {
  const inv = (await one('sales', `select create_order_invoice($1, 'full') as id`, [cor.p])).id;
  await as('sales', 'select issue_invoice($1, next_invoice_number(), current_date)', [inv]);
  let refused = '';
  try { await as('sales', `select correct_order_terms($1, 9, 'before_dispatch', null, 'x')`, [cor.p]); } catch (e) { refused = e.message; }
  eq(/issued/.test(refused), true, 'VAT locked by the issued invoice');
  const line = (await one('sales', 'select id from sales_order_lines where order_id = $1', [cor.p])).id;
  await as('sales', `select correct_order_line($1, 150, 2.9, 'Price agreed again')`, [line]);
  eq((await one('sales', 'select status from invoices where id = $1', [inv])).status, 'issued', 'issued invoice untouched');
});
await fails('corrections: an order sent to production is no longer corrected', async () => {
  await db.query('alter table manufacturing_orders disable trigger user');
  await db.query(`update manufacturing_orders set status = 'released' where sales_order_line_id in (select id from sales_order_lines where order_id = $1) and status <> 'cancelled'`, [cor.p]);
  await db.query('alter table manufacturing_orders enable trigger user');
  const line = (await one('sales', 'select id from sales_order_lines where order_id = $1', [cor.p])).id;
  await as('sales', `select correct_order_line($1, 200, 2.9, 'too late')`, [line]);
}, 'not yet sent to production');
// "Correct the order" (the order form filled in) runs several corrections in one transaction
const corForm = {};
await ok('correct the order: offer added at another level, the first one taken out, a service, VAT and the reference at once', async () => {
  const client = (await one('sales', `insert into clients (legal_name, country_code) values ('Form Fix Ltd', 'BG') returning id`)).id;
  const offer = async (no) => (await one('sales',
    `insert into calc_offers (offer_no, receiver_name, receiver_email, client_id, product_name, data, results)
     values ($1, 'Buyer', '', $2, $1 || ' product', '{"numberOfUnits": "1000"}'::jsonb, '{"unitPrice": 4}'::jsonb) returning id`, [no, client])).id;
  corForm.a = await offer('NK-FORM-1'); corForm.b = await offer('NK-FORM-2');
  corForm.order = (await one('sales', 'select create_order_from_calc_offers($1, $2) as id', [client, [corForm.a]])).id;
  const lineA = (await one('sales', 'select id from sales_order_lines where order_id = $1', [corForm.order])).id;
  await as('sales', `do $$ declare v uuid; begin
      v := correct_order_add_offer('${corForm.order}', '${corForm.b}', 'Client adds a product');
      perform correct_order_line(v, 2000, 3.8, 'Client adds a product');
      perform correct_order_add_service('${corForm.order}', 'Label design', 1, 150, 'Client adds a product');
      perform correct_order_remove_line('${lineA}', 'Client adds a product');
      perform correct_order_terms('${corForm.order}', 0, (select balance_terms from sales_orders where id = '${corForm.order}'),
                                  (select balance_net_days from sales_orders where id = '${corForm.order}'), 'Client adds a product');
      update sales_orders set customer_ref = 'PO-55' where id = '${corForm.order}';
    end $$`);
  eq((await corLines(corForm.order)).map((l) => `${l.kind}:${l.quantity}x${l.price}`).join(), 'calc_offer:2000x3.8,service:1x150', 'lines');
  const o = await one('sales', 'select vat_pct::float as vat, customer_ref from sales_orders where id = $1', [corForm.order]);
  eq(`${o.vat}:${o.customer_ref}`, '0:PO-55', 'VAT and reference');
  eq((await one('admin', `select count(*)::int as n from order_corrections where order_id = $1 and reason = 'Client adds a product'`, [corForm.order])).n, 5, 'five corrections, one reason');
  eq((await one('sales', 'select count(*)::int as n from sales_order_lines where calc_offer_id = $1', [corForm.a])).n, 0, 'the first offer is free again');
});
await ok('correct the order: one step refused, nothing is saved', async () => {
  let refused = '';
  try {
    await as('sales', `do $$ begin
        perform correct_order_add_service('${corForm.order}', 'Extra samples', 2, 20, 'More');
        perform correct_order_add_offer('${corForm.order}', '${corForm.b}', 'More');
      end $$`);
  } catch (e) { refused = e.message; }
  eq(/already in an order/.test(refused), true, 'refused');
  eq((await corLines(corForm.order)).length, 2, 'the service was not added either');
});

console.log('\nPackaging per pack: a powder gets only scoops and desiccants');
await ok('powder: scoops and desiccants only; capsules: everything', async () => {
  const fits = async (name, bg, sku, fmt) =>
    (await as('admin', 'select packaging_fits_format($1, $2, $3, $4) as ok', [name, bg, sku, fmt]))[0].ok;
  eq(await fits('Capsule size 00', 'Капсула размер 00', 'PK-CAPS-00', 'powder'), false, 'capsule shell');
  eq(await fits('Plastic jar', 'Пластмасово бурканче', 'PK-JAR-PL', 'powder'), false, 'capsule jar');
  eq(await fits('Measuring scoop 5 g', null, 'PK-SC-5', 'powder'), true, 'scoop');
  eq(await fits('Мерителна лъжичка', 'Мерителна лъжичка', 'PK-X', 'powder'), true, 'scoop in Bulgarian');
  eq(await fits('Desiccant 1 g', 'Дисикант 1 g', 'PK-DES', 'powder'), true, 'desiccant');
  eq(await fits('Capsule size 00', null, 'PK-CAPS-00', 'capsule'), true, 'capsule recipe sees all');
});

console.log('\nMaterial shortage: one rule everywhere');
// missing = max(0, needed - reserved for the batch - free - requested - ordered)
const sh = {};
const near = (a, b, what) => eq(Math.abs(Number(a) - Number(b)) < 0.0002, true, `${what}: ${a} vs ${b}`);
const shReq = async () => Object.fromEntries((await as('admin', 'select * from mo_material_requirements($1)', [sh.mo])).map(r => [r.sku, r]));
await ok('shortage: a batch of five materials, needs read from the recipe', async () => {
  sh.items = {};
  for (const [sku, type] of [['SH-A', 'raw_material'], ['SH-B', 'raw_material'], ['SH-C', 'excipient'], ['SH-D', 'raw_material'], ['SH-E', 'raw_material']]) {
    sh.items[sku] = (await one('admin', `insert into items (sku, type, name, base_unit, novel_food_status, shelf_life_months)
                                         values ($1, $2, $1, 'kg', 'not_novel', 24) returning id`, [sku, type])).id;
  }
  const p = await one('sales', `insert into projects (client_id, name) values ($1, 'Shortage test') returning id`, [client2.id]);
  const f = await one('sales', `insert into formulas (name, product_format, serving_size, servings_per_pack) values ('Shortage test', 'capsule', 1, 30) returning id`);
  sh.v = (await one('sales', 'select id from formula_versions where formula_id = $1', [f.id])).id;
  for (const [i, sku] of Object.keys(sh.items).entries()) {
    await as('sales', 'insert into formula_lines (version_id, item_id, amount) values ($1, $2, $3)', [sh.v, sh.items[sku], 100 * (i + 1)]);
  }
  await as('admin', 'select approve_formula_version($1)', [sh.v]);
  sh.mo = (await one('sales', 'insert into manufacturing_orders (formula_version_id, project_id, quantity) values ($1, $2, 1000) returning id', [sh.v, p.id])).id;
  const r = await shReq();
  sh.need = Object.fromEntries(Object.keys(sh.items).map(k => [k, Number(r[k].required)]));
  eq(Object.values(sh.need).every(n => n > 0), true, 'every material is needed');
  // A: twice the need free; B: half; C: nothing; D: nothing, a quarter requested and a quarter ordered; E: 30 % free
  await recv(sh.items['SH-A'], sh.need['SH-A'] * 2, 'NK-WH');
  await recv(sh.items['SH-B'], sh.need['SH-B'] / 2, 'NK-WH');
  await recv(sh.items['SH-E'], sh.need['SH-E'] * 0.3, 'NK-WH');
  await as('sales', 'insert into purchase_requests (item_id, quantity, manufacturing_order_id) values ($1, $2, $3)', [sh.items['SH-D'], sh.need['SH-D'] / 4, sh.mo]);
  const ordered = await one('sales', 'insert into purchase_requests (item_id, quantity, manufacturing_order_id) values ($1, $2, $3) returning id', [sh.items['SH-D'], sh.need['SH-D'] / 4, sh.mo]);
  await as('admin', 'select create_expected_delivery(null, null, null, current_date + 7, null, null, $1, $2)', [L['NK-WH'], ordered.id]);
});
await ok('shortage: free stock covers it fully, nothing is missing although nothing is reserved', async () => {
  const r = (await shReq())['SH-A'];
  eq(Number(r.reserved), 0, 'nothing reserved'); eq(Number(r.short), 0, 'nothing missing');
});
await ok('shortage: free stock covers part of it, the rest is missing', async () =>
  near((await shReq())['SH-B'].short, sh.need['SH-B'] / 2, 'half missing'));
await ok('shortage: nothing free, everything is missing', async () =>
  near((await shReq())['SH-C'].short, sh.need['SH-C'], 'all missing'));
await ok('shortage: what is requested or ordered is not missing; an ordered request counts once', async () => {
  const r = (await shReq())['SH-D'];
  near(r.requested, sh.need['SH-D'] / 4, 'requested (open only)'); near(r.ordered, sh.need['SH-D'] / 4, 'ordered');
  near(r.short, sh.need['SH-D'] / 2, 'half missing');
});
await ok('shortage: the recipe block "Stock for N packs" uses the same rule (no batch, nothing reserved)', async () => {
  const v = Object.fromEntries((await as('sales', 'select * from version_material_stock($1, 1000)', [sh.v])).map(x => [x.item_id, x]));
  near(v[sh.items['SH-A']].short, 0, 'A'); near(v[sh.items['SH-B']].short, sh.need['SH-B'] / 2, 'B');
  near(v[sh.items['SH-C']].required, sh.need['SH-C'], 'same need as the batch');
  eq((await as('production', 'select * from version_material_stock($1, 1000)', [sh.v])).length, 0, 'production sees nothing');
});
await ok('shortage: "Reserve free stock" reserves min(need, free); part reserved, the rest is missing', async () => {
  await as('sales', 'select reserve_mo_materials($1)', [sh.mo]);
  const r = await shReq();
  near(r['SH-A'].reserved, sh.need['SH-A'], 'A: the need, not all the free stock'); near(r['SH-A'].short, 0, 'A missing');
  near(r['SH-B'].reserved, sh.need['SH-B'] / 2, 'B reserved'); near(r['SH-B'].short, sh.need['SH-B'] / 2, 'B still missing');
  near(r['SH-E'].reserved, sh.need['SH-E'] * 0.3, 'E reserved'); near(r['SH-E'].short, sh.need['SH-E'] * 0.7, 'E missing');
});
await ok('shortage: "Request what is missing" requests only the real shortage, never twice', async () => {
  eq((await one('sales', 'select create_purchase_requests($1) as n', [sh.mo])).n, 4, 'B, C, D and E');
  const q = Object.fromEntries((await as('admin', `select i.sku, sum(pr.quantity) as q from purchase_requests pr join items i on i.id = pr.item_id
      where pr.manufacturing_order_id = $1 and pr.status = 'open' group by i.sku`, [sh.mo])).map(x => [x.sku, Number(x.q)]));
  eq(q['SH-A'], undefined, 'A not requested');
  near(q['SH-B'], sh.need['SH-B'] / 2, 'B'); near(q['SH-C'], sh.need['SH-C'], 'C');
  near(q['SH-D'], sh.need['SH-D'] * 0.75, 'D: the earlier open quarter plus the missing half');
  near(q['SH-E'], sh.need['SH-E'] * 0.7, 'E');
  eq((await one('sales', 'select create_purchase_requests($1) as n', [sh.mo])).n, 0, 'nothing twice');
  eq(Object.values(await shReq()).every(r => Number(r.short) === 0), true, 'nothing missing any more');
});
await ok('shortage: Доставки counts a request only up to the real shortage of its batch', async () => {
  const extra = await one('sales', 'insert into purchase_requests (item_id, quantity, manufacturing_order_id) values ($1, 5, $2) returning id', [sh.items['SH-A'], sh.mo]);
  eq((await as('admin', 'select * from purchase_shortages where purchase_request_id = $1', [extra.id])).length, 0, 'A is covered: not listed');
  const c = await as('admin', `select s.quantity from purchase_shortages s join purchase_requests pr on pr.id = s.purchase_request_id
                                where pr.manufacturing_order_id = $1 and s.item_id = $2`, [sh.mo, sh.items['SH-C']]);
  near(c[0].quantity, sh.need['SH-C'], 'C listed in full');
  eq(Number((await one('admin', 'select purchase_request_still_short($1) as q', [extra.id])).q), 0, 'still short');
  eq((await one('production', 'select purchase_request_still_short($1) as q', [extra.id])).q, null, 'production gets nothing');
});

console.log('\nE-mail signatures');
const meId = async (who) => (await one(who, 'select auth.uid() as id')).id;
await ok('signature: the designer saves their own; only they and Admin read it', async () => {
  const designer = await meId('designer');
  await as('designer', 'select mail_signature_set($1, $2)', [designer, '<p>Teo</p>']);
  eq((await one('designer', 'select html from mail_signatures where user_id = $1', [designer])).html, '<p>Teo</p>', 'own');
  eq((await as('admin', 'select 1 from mail_signatures where user_id = $1', [designer])).length, 1, 'admin reads');
  eq((await as('sales', 'select 1 from mail_signatures where user_id = $1', [designer])).length, 0, 'sales does not');
  eq((await as('production', 'select 1 from mail_signatures')).length, 0, 'production does not');
  eq((await as('clientA', 'select 1 from mail_signatures')).length, 0, 'client does not');
});
await ok("signature: Admin saves anyone's; an empty one removes it", async () => {
  const sales = await meId('sales');
  await as('admin', 'select mail_signature_set($1, $2)', [sales, '<b>Sales</b>']);
  eq((await one('sales', 'select html from mail_signatures where user_id = $1', [sales])).html, '<b>Sales</b>', 'set by admin');
  await as('sales', 'select mail_signature_set($1, $2)', [sales, '  ']);
  eq((await as('admin', 'select 1 from mail_signatures where user_id = $1', [sales])).length, 0, 'removed');
});
await fails("signature: sales cannot set someone else's", async () =>
  as('sales', 'select mail_signature_set($1, $2)', [await meId('admin'), '<p>x</p>']), 'not allowed');
await fails('signature: production cannot set one', async () =>
  as('production', 'select mail_signature_set($1, $2)', [await meId('production'), '<p>x</p>']), 'not allowed');
await fails('signature: a client cannot set one', async () =>
  as('clientA', 'select mail_signature_set($1, $2)', [await meId('clientA'), '<p>x</p>']), 'not allowed');
await fails('signature: nobody writes the table directly', async () =>
  as('admin', `insert into mail_signatures (user_id, html) values (auth.uid(), 'x')`), 'permission denied');

// ---------------------------------------------------------------- Production screen (Admin works as the production account)
await ok('production screen: Admin gets the production accounts only, and the opening is logged', async () => {
  const rows = await as('admin', 'select id, role::text from production_screen_targets()');
  eq(rows.length > 0 && rows.every((r) => r.role === 'production'), true, 'production only');
  eq(rows.some((r) => r.id === U.production), true, 'the partner account');
  await db.exec('reset role');
  const before = Number((await db.query('select count(*) as n from impersonation_log where target_id = $1', [U.production])).rows[0].n);
  await as('admin', 'select start_production_screen($1)', [U.production]);
  await db.exec('reset role');
  const after = Number((await db.query('select count(*) as n from impersonation_log where target_id = $1', [U.production])).rows[0].n);
  eq(after, before + 1, 'logged');
});
await fails('production screen: Sales cannot open it', () => as('sales', 'select * from production_screen_targets()'), 'Only Admin');
await fails('production screen: Production cannot open it', () => as('production', 'select * from production_screen_targets()'), 'Only Admin');
await fails('production screen: Admin cannot act as a non-production account', () => as('admin', 'select start_production_screen($1)', [U.sales]), 'Not a production account');

console.log('\nAI assistant links');
// The fixed queries of web/src/lib/ai/tools.ts, read from the file so the test follows the code
const aiQueries = Object.fromEntries([...readFileSync(join(here, '..', 'web', 'src', 'lib', 'ai', 'tools.ts'), 'utf8').replace(/\r\n/g, '\n')
  .matchAll(/^  (\w+): \(a?\) => \[\s*`([\s\S]*?)`/gm)].map(([, name, sql]) => [name, sql.replace(/\$\{LIMIT\}/g, '25')]));
await ok('every query of the assistant runs for Admin', async () => {
  eq(Object.keys(aiQueries).length > 10, true, 'queries found');
  for (const [name, sql] of Object.entries(aiQueries)) {
    const n = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1])));
    try { await as('admin', sql, Array.from({ length: n }, (_, i) => (name === 'eu_health_claims' && i === 1 ? 'authorised' : ''))); }
    catch (e) { throw new Error(`${name}: ${e.message}`); }
  }
});
await ok('an order gives the links of its next steps, by its own payments', async () => {
  const rows = await as('admin', `select so.code, order_paid_in_two(so.id) as two, so.deposit_received_on, so.balance_received_on, so.status
                                    from sales_orders so where so.status not in ('draft', 'unpaid', 'cancelled') and so.deposit_received_on is not null`);
  eq(rows.length > 0, true, 'a paid order exists');
  for (const r of rows) {
    const d = await one('admin', aiQueries.order_details, [r.code]);
    eq(d.link.startsWith('/orders/'), true, 'order link');
    eq(!!d.links.advance_invoice, r.two, `${r.code} advance`);
    eq(!!d.links.invoice, !r.two, `${r.code} full`);
    eq(!!d.links.final_invoice, r.two && !!r.balance_received_on, `${r.code} final`);
    eq(d.links.advance_invoice ?? d.links.invoice, `${d.link}/invoice?purpose=${r.two ? 'advance' : 'full'}`, 'invoice link');
  }
  const unpaid = await as('admin', `select code from sales_orders where status = 'unpaid' limit 1`);
  if (unpaid[0]) {
    const d = await one('admin', aiQueries.order_details, [unpaid[0].code]);
    eq(d.links.advance_invoice ?? d.links.invoice ?? null, null, 'no invoice link before the payment');
  }
});

console.log('\nCalculator price list in the database (no Google Sheet)');
const plMat = (await one('admin', `select calc_add_raw_material('PL Test Material', 10) as id`)).id;
await fails('sales does not write the price list directly, only through the functions', () =>
  as('sales', 'update calc_raw_materials set price_eur_per_kg = 1 where id = $1', [plMat]), 'permission denied');
await ok('the regulatory note stays Admin only; production does not see the price list', async () => {
  eq((await as('sales', `update calc_raw_materials set regulatory_note = 'x' where id = $1 returning id`, [plMat])).length, 0, 'sales: no row');
  eq((await one('admin', `update calc_raw_materials set regulatory_note = 'Novel Food' where id = $1 returning regulatory_note`, [plMat])).regulatory_note, 'Novel Food', 'admin');
  eq((await as('production', 'select id from calc_raw_materials')).length, 0, 'production');
});
await fails('nobody deletes a raw material directly', () => as('admin', 'delete from calc_raw_materials where id = $1', [plMat]));
await ok('the delete function of raw materials is gone', async () => {
  eq((await db.query(`select 1 from pg_proc where proname = 'calc_delete_raw_material'`)).rows.length, 0, 'gone');
});
let plProd;
await ok('admin adds and edits a catalog product', async () => {
  plProd = (await one('admin', `insert into calc_catalog_products (code, name, tiers, composition, capsules_per_serving, capsules_per_container)
      values ('PL-T1', 'PL Test', '[{"min_qty": 500, "price": 5}]', '[{"name": "MSM", "amount": 200, "unit": "mg", "note": null}]', 2, 60)
      returning id`)).id;
  const r = await one('admin', `update calc_catalog_products set tiers = '[{"min_qty": 500, "price": 4.5}, {"min_qty": 1000, "price": 4}]', active = false
                                 where id = $1 returning jsonb_array_length(tiers) as n, active`, [plProd]);
  eq(r.n, 2, 'tiers'); eq(r.active, false, 'inactive');
});
await fails('sales cannot add a catalog product', () =>
  as('sales', `insert into calc_catalog_products (code, name, tiers) values ('PL-T2', 'x', '[{"min_qty": 1, "price": 1}]')`));
await ok('sales cannot change a catalog product; production sees none', async () => {
  eq((await as('sales', `update calc_catalog_products set name = 'x' where id = $1 returning id`, [plProd])).length, 0, 'sales');
  eq((await as('production', 'select id from calc_catalog_products')).length, 0, 'production');
});
await fails('a catalog product needs at least one price step', () =>
  as('admin', `update calc_catalog_products set tiers = '[]' where id = $1`, [plProd]));
await ok('the Google Sheet sync functions are gone', async () => {
  eq((await db.query(`select proname from pg_proc where proname in ('calc_record_sync', 'calc_record_scheduled_sync', 'calc_apply_sync',
      'calc_record_catalog_sync', 'calc_record_scheduled_catalog_sync', 'calc_apply_catalog_sync')`)).rows.length, 0, 'functions');
});

console.log('\nExpiry date and batch number of a lot (Admin, under Stock)');
const ldLot = await one('admin', `select l.id, l.expires_on::text as e, l.supplier_lot as b, (select sum(quantity) from stock_movements where lot_id = l.id)::text as q
                                    from lots l where l.manufactured_on is null order by l.lot_number limit 1`);
await ok('admin adds an expiry date and a batch number to a lot; the stock does not change', async () => {
  await as('admin', `select set_lot_details($1, '2028-03-31', '  B-77  12 ')`, [ldLot.id]);
  const r = await one('admin', `select expires_on::text as e, supplier_lot as b from lots where id = $1`, [ldLot.id]);
  eq(r.e, '2028-03-31', 'expiry'); eq(r.b, 'B-77 12', 'batch tidied');
  eq((await one('admin', `select sum(quantity)::text as q from stock_movements where lot_id = $1`, [ldLot.id])).q, ldLot.q, 'quantity unchanged');
  eq((await as('admin', `select 1 from audit_log where table_name = 'lots' and row_id = $1::text and new_data->>'supplier_lot' = 'B-77 12'`, [ldLot.id])).length > 0, true, 'audited');
});
await ok('both are optional: empty values clear them', async () => {
  await as('admin', `select set_lot_details($1, null, '   ')`, [ldLot.id]);
  const r = await one('admin', `select expires_on, supplier_lot from lots where id = $1`, [ldLot.id]);
  eq(r.expires_on, null, 'no expiry'); eq(r.supplier_lot, null, 'no batch');
  await as('admin', `select set_lot_details($1, $2::date, $3)`, [ldLot.id, ldLot.e, ldLot.b]);
});
await fails('the expiry date must be after the manufacturing date', async () => {
  const m = await one('admin', `select id from lots where manufactured_on is not null limit 1`);
  await as('admin', `select set_lot_details($1, '2000-01-01', null)`, [m.id]);
}, 'after the manufacturing date');
for (const who of ['sales', 'bookkeeper', 'production', 'designer', 'clientA']) {
  await fails(`${who} cannot change the expiry date or batch number of a lot`, () =>
    as(who, `select set_lot_details($1, '2029-01-01', 'X')`, [ldLot.id]));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
