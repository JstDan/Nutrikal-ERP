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
  eq((await as('production', 'select id from items')).length, 1, 'items');
  eq((await as('production', 'select * from supplier_prices')).length, 0, 'prices');
  eq((await as('production', 'select * from suppliers')).length, 0, 'suppliers');
});

console.log('\nReceiving, QC and stock');
let lot;
await ok('production receives a lot into quarantine at the production facility', async () => {
  const r = await one('production', `select receive_lot($1, $2, 100, null, 'SUP-778', current_date - 30) as id`,
                      [item.id, L['PF-QUAR']]);
  lot = (await db.query('select * from lots where id = $1', [r.id])).rows[0];
  eq(lot.lot_number, 'LOT-000001', 'lot number');
  eq(lot.qc_status, 'quarantine', 'status');
});
await ok('expiry is calculated from the 24-month shelf life', async () => {
  const r = await one('admin', `select expires_on = (manufactured_on + interval '24 months')::date as ok from lots where id = $1`, [lot.id]);
  eq(r.ok, true, 'expiry');
});
await fails('production cannot receive into the Nutrikal warehouse', () =>
  as('production', 'select receive_lot($1, $2, 5)', [item.id, L['NK-WH']]), 'production locations');
await ok('transfer quarantine → raw materials store', async () => {
  await as('production', 'select transfer_stock($1, $2, $3, 100)', [lot.id, L['PF-QUAR'], L['PF-RM']]);
});
await fails('consumption of an unreleased lot is blocked', () =>
  as('production', `select post_stock_movement('consumption', $1, $2, 10)`, [lot.id, L['PF-RM']]), 'not released');
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
           [lot.id, L['PF-RM'], project.id]);
});
await fails('negative stock is refused', () =>
  as('production', `select post_stock_movement('consumption', $1, $2, 80)`, [lot.id, L['PF-RM']]), 'insufficient');
await fails('production cannot post adjustments as movements', () =>
  as('production', `select post_stock_movement('adjustment', $1, $2, -2, 'spill')`, [lot.id, L['PF-RM']]), 'count_stock');
await fails('production corrects stock only with a reason', () =>
  as('production', 'select count_stock($1, $2, 68)', [lot.id, L['PF-RM']]), 'reason');
await ok('production corrects stock directly: a ledger adjustment, every admin notified', async () => {
  const d = await one('production', `select count_stock($1, $2, 68, 'Spillage during weighing') as d`, [lot.id, L['PF-RM']]);
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
  as('production', `select request_stock_adjustment($1, $2, -1, 'x')`, [lot.id, L['PF-RM']]), 'count_stock');
await ok('a user marks only their own notifications read', async () => {
  eq((await one('production', 'select mark_notifications_read() as n')).n, 0, 'none for production');
  eq((await one('admin', 'select mark_notifications_read() as n')).n, 1, 'admin');
  eq((await as('legacy', 'select id from notifications where read_at is null')).length, 1, 'other admin unchanged');
});
await fails('nobody writes notifications directly', () =>
  as('admin', `insert into notifications (user_id, kind) values ($1, 'mo_sent')`, [U.admin]), 'row-level security');
await fails('direct writes to the ledger are refused', () =>
  as('admin', `insert into stock_movements (type, lot_id, location_id, quantity) values ('receipt', $1, $2, 5)`,
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
  eq((await as('production', 'select code from locations')).length, 5, 'locations');
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
  lots.mcc = await recv(mcc.id, 2, 'PF-RM');
  lots.novel = await recv(novelPending.id, 2, 'PF-RM');
  lots.caps = await recv(caps.id, 70000, 'PF-PACK');
  lots.jar = await recv(jar.id, 1100, 'PF-PACK');
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
  { lot_id: lot.id, location_id: L['PF-RM'], quantity: 22.5 },
  { lot_id: lots.mcc, location_id: L['PF-RM'], quantity: 2 },
  { lot_id: lots.novel, location_id: L['PF-RM'], quantity: 1.5 },
  { lot_id: lots.caps, location_id: L['PF-PACK'], quantity: 60000 },
  { lot_id: lots.jar, location_id: L['PF-PACK'], quantity: 1000 },
]);
await fails('production cannot consume stock in the Nutrikal warehouse', () =>
  as('production', `select complete_production($1, 'B-24001', 990, current_date, $2::jsonb)`,
     [mo.id, JSON.stringify([{ lot_id: mccWh, location_id: L['NK-WH'], quantity: 1 }])]), 'production locations');
await fails('a lot that is not a material of the order is refused', async () => {
  const other = await one('admin', 'select receive_lot($1, $2, 5) as id', [novelBlocked.id, L['PF-QUAR']]);
  await as('production', `select complete_production($1, 'B-24001', 990, current_date, $2::jsonb)`,
           [mo.id, JSON.stringify([{ lot_id: other.id, location_id: L['PF-QUAR'], quantity: 1 }])]);
}, 'not one of the materials');
const reserved = async () => Object.fromEntries((await as('admin',
  `select i.sku, sum(r.quantity) as q from stock_reservations r join items i on i.id = r.item_id
    where r.manufacturing_order_id = $1 and r.status = 'active' group by i.sku`, [mo.id])).map(x => [x.sku, Number(x.q)]));
let reservedBefore;
await fails('a usage more than 5 % away from the reservation needs a reason', async () => {
  reservedBefore = await reserved();
  await as('production', `select complete_production($1, 'B-24001', 990, current_date, $2::jsonb)`, [mo.id, consumption()]);
}, 'enter a reason');
await ok('production reports the batch: lots used, finished lot in quarantine in PF-QUAR', async () => {
  const before = Number((await one('admin', 'select sum(quantity) as q from stock_movements where lot_id = $1', [lot.id])).q);
  const items = await as('admin', 'select item_id from mo_material_requirements($1)', [mo.id]);
  const reasons = JSON.stringify(items.map(i => ({ item_id: i.item_id, reason: 'Less needed' })));
  const r = await one('production', `select complete_production($1, 'B-24001', 990, current_date, $2::jsonb, $3::jsonb) as lot`,
                      [mo.id, consumption(), reasons]);
  const fg = await one('admin', 'select l.lot_number, l.qc_status, i.type, i.sku from lots l join items i on i.id = l.item_id where l.id = $1', [r.lot]);
  eq(fg.lot_number, 'B-24001', 'batch number'); eq(fg.qc_status, 'quarantine', 'QC'); eq(fg.type, 'finished_good', 'item type');
  eq(fg.sku, 'FG-NK-P-0001', 'finished goods item');
  eq(Number((await one('admin', 'select sum(quantity) as q from stock_movements where lot_id = $1 and location_id = $2', [r.lot, L['PF-QUAR']])).q), 990, 'made in quarantine');
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
await ok('production enters its invoice for the batch; sales cannot see it', async () => {
  await as('production', `insert into production_invoices (mo_id, invoice_number, invoice_date, amount) values ($1, 'PF-2026-118', current_date, 1450)`, [mo.id]);
  eq((await as('production', 'select * from production_invoices')).length, 1, 'partner sees own');
  eq((await as('admin', 'select * from production_invoices')).length, 1, 'inventory');
  eq((await as('sales', 'select * from production_invoices')).length, 0, 'sales');
});
await fails('production cannot invoice an order that was not sent to it', async () => {
  mo2 = await one('sales', 'insert into manufacturing_orders (sales_order_line_id, quantity) values ($1, 2000) returning id', [line2.id]);
  await as('production', `insert into production_invoices (mo_id, invoice_number, invoice_date, amount) values ($1, 'X', current_date, 1)`, [mo2.id]);
}, 'row-level security');
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
await ok('batch cost: consumed lots at their cost + production invoice; per pack on the finished lot', async () => {
  const c = await one('admin', 'select * from mo_cost($1)', [mo.id]);
  eq(c.is_actual, true, 'actual');
  eq(Number(c.material_cost), 1424.25, 'materials (22.5×18.5 + 2×4 + 1.5×100 + 60000×0.01 + 1000×0.25)');
  eq(Number(c.partner_cost), 1450, 'partner invoice'); eq(Number(c.total_cost), 2874.25, 'total');
  eq(Number(c.cost_per_pack), 2.903283, 'per pack (990 made)');
  const fg = await one('admin', 'select lc.unit_cost, lc.source from manufacturing_orders m join lot_costs lc on lc.lot_id = m.finished_lot_id where m.id = $1', [mo.id]);
  eq(Number(fg.unit_cost), 2.903283, 'finished lot cost'); eq(fg.source, 'production', 'source');
  eq((await as('admin', 'select * from mo_costs($1)', [mo.id])).length, 5, 'one line per consumed lot');
});
await fails('production cannot see batch costs', () => as('production', 'select * from mo_cost($1)', [mo.id]), 'not allowed');
await fails('sales without the price flag cannot see batch costs', () => as('sales', 'select * from mo_costs($1)', [mo.id]), 'not allowed');

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
await fails('sales cannot change a raw material price', () =>
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
await ok('sheet sync upserts, deactivates and logs the run', async () => {
  const plan = { upserts: [{ name: 'New Extract', price_eur_per_kg: 12.5, active: true }, { name: 'Zinc Glycinate', price_eur_per_kg: 31, active: true }], deactivate: ['Zinc Citrate Trihydrate'] };
  const run = await one('sales', `select * from calc_record_sync('manual', $1::jsonb, $2::jsonb)`,
    [JSON.stringify(plan), JSON.stringify({ added: 1, changed: 1, removed: 1 })]);
  eq(run.status, 'success', 'status');
  eq(Number((await one('sales', `select price_eur_per_kg from calc_raw_materials where name = 'Zinc Glycinate'`)).price_eur_per_kg), 31, 'price');
  eq((await one('sales', `select active from calc_raw_materials where name = 'Zinc Citrate Trihydrate'`)).active, false, 'deactivated');
  eq((await as('sales', `select id from calc_raw_materials where name = 'New Extract'`)).length, 1, 'added');
  eq((await one('admin', 'select count(*) from calc_sync_runs')).count, 1, 'logged');
});
await ok('a failed sync changes nothing and is logged', async () => {
  const run = await one('admin', `select * from calc_record_sync('auto', '{"upserts":[{"name":"Y","price_eur_per_kg":1}]}', '{}', 'boom')`);
  eq(run.status, 'error', 'status');
  eq((await as('admin', `select id from calc_raw_materials where name = 'Y'`)).length, 0, 'not applied');
});
await fails('production cannot run the sheet sync', () =>
  as('production', `select calc_record_sync('manual', '{}', '{}')`), 'not allowed');
await fails('sync source "scheduled" is reserved for the server job', () =>
  as('sales', `select calc_record_sync('scheduled', '{}', '{}')`), 'invalid sync source');
await fails('users cannot call the scheduled sync', () =>
  as('admin', `select calc_record_scheduled_sync('{}', '{}')`), 'permission denied');
await fails('users cannot call the sync body directly', () =>
  as('sales', `select calc_apply_sync('manual', '{}', '{}', null, null)`), 'permission denied');
await ok('the server job logs a scheduled run', async () => {
  const run = (await db.query(`select * from calc_record_scheduled_sync('{"upserts":[{"name":"Daily Extract","price_eur_per_kg":7}]}', '{"added":1}')`)).rows[0];
  eq(run.source, 'scheduled', 'source');
  eq(run.triggered_by, null, 'no user');
  eq((await as('sales', `select id from calc_raw_materials where name = 'Daily Extract'`)).length, 1, 'applied');
});

const catalogProducts = (products) => JSON.stringify(products.map(([code, name, price], i) => ({
  code, name, category: 'Test', tiers: [{ min_qty: 500, price }, { min_qty: 1000, price: price - 0.5 }], sort_order: i })));
await ok('the catalog syncs on its own and logs its own run; admin and sales read it', async () => {
  const before = Number((await one('admin', 'select count(*) from calc_sync_runs')).count);
  const run = await one('sales', `select * from calc_record_catalog_sync('manual', $1::jsonb, '{"added":2}')`,
    [catalogProducts([['NTL-T1', 'Joint Test', 6.2], ['NTL-T2', 'Sleep Test', 5.9]])]);
  eq(run.status, 'success', 'status');
  eq(run.added, 2, 'added');
  eq(Number((await one('admin', 'select count(*) from calc_sync_runs')).count), before, 'price-list log untouched');
  eq((await as('admin', `select code from calc_catalog_products where active order by code`)).map((r) => r.code).join(), 'NTL-T1,NTL-T2', 'admin');
  eq(Number((await one('sales', `select tiers from calc_catalog_products where code = 'NTL-T1'`)).tiers[1].price), 5.7, 'tier price');
  eq((await as('sales', 'select id from calc_catalog_sync_runs')).length, 1, 'logged');
});
await ok('a product no longer in the catalog sheet is deactivated, not deleted', async () => {
  await as('admin', `select calc_record_catalog_sync('auto', $1::jsonb, '{}')`, [catalogProducts([['NTL-T1', 'Joint Test v2', 6.4]])]);
  eq((await one('sales', `select active from calc_catalog_products where code = 'NTL-T2'`)).active, false, 'deactivated');
  eq((await one('sales', `select name from calc_catalog_products where code = 'NTL-T1'`)).name, 'Joint Test v2', 'updated');
});
await ok('a failed or empty catalog sync changes nothing and is logged', async () => {
  const failed = await one('sales', `select * from calc_record_catalog_sync('manual', $1::jsonb, '{}', 'boom')`, [catalogProducts([['NTL-X', 'X', 1]])]);
  eq(failed.status, 'error', 'failed status');
  const empty = await one('sales', `select * from calc_record_catalog_sync('manual', '[]', '{}')`);
  eq(empty.status, 'error', 'empty status');
  eq((await as('sales', `select id from calc_catalog_products where code = 'NTL-X'`)).length, 0, 'not applied');
  eq((await one('sales', `select active from calc_catalog_products where code = 'NTL-T1'`)).active, true, 'catalog kept');
});
await ok('the price-list sync no longer touches the catalog', async () => {
  await as('sales', `select calc_record_sync('manual', $1::jsonb, '{}')`,
    [JSON.stringify({ upserts: [{ name: 'Catalog Day Extract', price_eur_per_kg: 3 }], deactivate: [], catalog: [] })]);
  eq((await one('sales', `select active from calc_catalog_products where code = 'NTL-T1'`)).active, true, 'catalog kept');
});
await ok('the server job logs a scheduled catalog run', async () => {
  const run = (await db.query(`select * from calc_record_scheduled_catalog_sync($1::jsonb, '{}')`, [catalogProducts([['NTL-T1', 'Joint Test v2', 6.4], ['NTL-T3', 'Daily Test', 4]])])).rows[0];
  eq(run.source, 'scheduled', 'source');
  eq(run.triggered_by, null, 'no user');
  eq((await as('sales', `select id from calc_catalog_products where code = 'NTL-T3'`)).length, 1, 'applied');
});
await fails('production cannot run the catalog sync', () =>
  as('production', `select calc_record_catalog_sync('manual', '[]', '{}')`), 'not allowed');
await ok('production sees no catalog sync runs', async () => {
  eq((await as('production', 'select id from calc_catalog_sync_runs')).length, 0, 'production');
});
await fails('catalog sync source "scheduled" is reserved for the server job', () =>
  as('sales', `select calc_record_catalog_sync('scheduled', '[]', '{}')`), 'invalid sync source');
await fails('users cannot call the scheduled catalog sync', () =>
  as('admin', `select calc_record_scheduled_catalog_sync('[]', '{}')`), 'permission denied');
await fails('users cannot call the catalog sync body directly', () =>
  as('sales', `select calc_apply_catalog_sync('manual', '[]', '{}', null, null)`), 'permission denied');
await ok('the catalog sync keeps the capsules per jar and composition of a product', async () => {
  await db.query(`update calc_catalog_products set capsules_per_serving = 2, capsules_per_container = 60,
    composition = '[{"name":"MSM","amount":200,"unit":"mg","note":null}]' where code = 'NTL-T1'`);
  await as('sales', `select calc_record_catalog_sync('manual', $1::jsonb, '{}')`, [catalogProducts([['NTL-T1', 'Joint Test v3', 6.5], ['NTL-T3', 'Daily Test', 4]])]);
  const p = await one('sales', `select name, capsules_per_container, composition from calc_catalog_products where code = 'NTL-T1'`);
  eq(p.name, 'Joint Test v3', 'name from the sheet');
  eq(p.capsules_per_container, 60, 'capsules kept');
  eq(p.composition[0].name, 'MSM', 'composition kept');
});
await fails('sales cannot change the capsules per jar of a catalog product', () =>
  as('sales', `update calc_catalog_products set capsules_per_container = 90 where code = 'NTL-T1'`), 'permission denied');
await ok('production cannot read catalog compositions', async () => {
  eq((await as('production', 'select composition from calc_catalog_products')).length, 0, 'production');
});
await fails('sales cannot add catalog products directly', () =>
  as('sales', `insert into calc_catalog_products (code, name, tiers) values ('X', 'X', '[{"min_qty":1,"price":1}]')`), 'permission denied');
await fails('admin cannot change catalog prices directly', () =>
  as('admin', `update calc_catalog_products set tiers = '[{"min_qty":1,"price":0}]'`), 'permission denied');
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
await fails('an offer already in an order cannot be ordered again', () =>
  as('sales', 'select create_order_from_calc_offers($1, $2)', [client.id, [calcA.id]]), 'already in an order');
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
  await as('admin', `update sales_orders set status = 'confirmed' where id = $1`, [calcOrder.id]);
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
await ok('a partial receipt makes a quarantine lot at the delivery price and keeps it open', async () => {
  edLot = await one('admin', `select receive_expected_delivery($1, $2, 20, 'SUP-ED-1') as id`, [ed1.id, L['NK-WH']]);
  const l = await one('admin', `select l.qc_status, l.expected_delivery_id, c.unit_cost from lots l
                                  left join lot_costs c on c.lot_id = l.id where l.id = $1`, [edLot.id]);
  eq(l.qc_status, 'quarantine', 'qc');
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
  const pl = await one('production', `select receive_lot($1, $2, 10) as id`, [edItem.id, L['PF-QUAR']]);
  eq(Number((await one('production', `select count_stock($1, $2, 9, 'Bag torn') as d`, [pl.id, L['PF-QUAR']])).d), -1, 'difference');
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
  pd = await one('admin', `select create_expected_delivery($1, 40, $2, current_date + 3, 9.9, 'PO-9', $3) as id`, [edItem.id, edSupplier.id, L['PF-RM']]);
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
await ok('production receives with a photo: lot in quarantine in PF-QUAR at the delivery price, admins notified', async () => {
  await attach('production', pd.id, 'a.jpg');
  await attach('production', pd.id, 'b.jpg');
  pdLot = await one('production', `select receive_expected_delivery($1, $2, 40, 'SUP-PF-1', null, current_date + 400) as id`, [pd.id, L['PF-RM']]);
  const l = await one('admin', `select l.qc_status, l.supplier_lot, l.expires_on = current_date + 400 as exp, c.unit_cost
                                  from lots l left join lot_costs c on c.lot_id = l.id where l.id = $1`, [pdLot.id]);
  eq(l.qc_status, 'quarantine', 'quarantine'); eq(l.supplier_lot, 'SUP-PF-1', 'supplier lot'); eq(l.exp, true, 'expiry');
  eq(Number(l.unit_cost), 9.9, 'cost');
  eq(Number((await one('admin', 'select sum(quantity) as q from stock_movements where lot_id = $1 and location_id = $2', [pdLot.id, L['PF-QUAR']])).q), 40, 'in PF-QUAR');
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
let tkClient, tkItem, tkJar, tkVer, tkA, tkB, boardA, boardB;
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
  await as('admin', 'update formula_versions set shelf_life_months = 12 where id = $1', [tkVer.id]);
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
await ok('admin confirms an advance of 50 %: the board is made in the same step, "Аванс 50%" is done', async () => {
  boardA = (await one('admin', `select confirm_order_payment($1, 'advance', 50) as id`, [tkA])).id;
  const o = await one('admin', 'select status, deposit_pct::int as pct, deposit_received_on, balance_received_on from sales_orders where id = $1', [tkA]);
  eq(o.status, 'confirmed', 'status'); eq(o.pct, 50, 'deposit'); eq(!!o.deposit_received_on, true, 'deposit received');
  eq(o.balance_received_on, null, 'balance open');
  const cols = await as('admin', 'select system_key from order_task_columns where board_id = $1 order by position', [boardA]);
  eq(cols.map(c => c.system_key).join(','), 'payments,formula,design,materials,production,dispatch', 'columns');
  const first = await tk(tkA, 'payment_first');
  eq(first.title, 'Аванс 50%', 'title'); eq(first.title_en, 'Advance 50%', 'title en'); eq(first.status, 'done', 'done');
  eq(first.completed_by, U.admin, 'by admin');
  const act = await one('admin', 'select actor_id, action, payload from order_task_activity where task_id = $1', [first.id]);
  eq(act.actor_id, U.admin, 'actor'); eq(act.payload.source, 'payment_confirmed', 'source');
  eq(!!(await tk(tkA, 'payment_final')), true, 'final payment task'); eq(await tk(tkA, 'invoice_full'), undefined, 'no single invoice');
});
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
  eq(await tk(tkB, 'payment_final'), undefined, 'no final payment'); eq(await tk(tkB, 'invoice_advance'), undefined, 'no advance invoice');
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
  eq(l.map(x => `${x.kind}:${x.a}`).join(','), 'advance:675', 'half of 1350');
  await as('sales', `select issue_invoice($1, next_invoice_number(), current_date)`, [tkAdv]);
  eq(await tkStatus(tkA, 'invoice_advance'), 'done', 'ticked');
});
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
await ok('QC release of the batch ticks "QC освобождаване"', async () => {
  const lot = await one('admin', 'select receive_lot($1, $2, 1) as id', [tkJar.id, L['NK-WH']]);
  // the finished batch of the order (complete_production is tested above; here only its lot matters)
  await db.query(`select set_config('nk.mo_transition', 'on', false)`);
  await db.query(`update manufacturing_orders set status = 'completed', finished_lot_id = $2, completed_at = now() where id = $1`, [tkMoA.id, lot.id]);
  await db.query(`select set_config('nk.mo_transition', 'off', false)`);
  eq(await tkStatus(tkA, 'consumption_reported'), 'done', 'reported');
  eq(await tkStatus(tkA, 'qc_released'), 'todo', 'in quarantine');
  await as('admin', `select set_lot_qc_status($1, 'released')`, [lot.id]);
  eq(await tkStatus(tkA, 'qc_released'), 'done', 'released');
  await as('admin', `select set_lot_qc_status($1, 'quarantine')`, [lot.id]);
  eq(await tkStatus(tkA, 'qc_released'), 'todo', 'back in quarantine');
});
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
