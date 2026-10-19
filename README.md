# Nutrikal ERP + CRM — Phases 1–2, Phase 3 (orders, production, costing)

Sales, inventory and production for the contract manufacturing business in one app (app.nutrikal.com), in Bulgarian and English.

```
nutrikal-erp/
  supabase/migrations/   database schema (Supabase / Postgres)
  web/                   the app (Next.js 16 + TypeScript + Tailwind)
  test/                  database rule tests + browser tests
```

## Run the app locally

Needs Node.js 20 or newer.

```
cd web
npm install
npm run dev
```

Open http://localhost:3000.

- On first start the app creates a local database in `web/.data/`, runs every migration from `supabase/migrations`, and loads sample data (4 clients, 6 projects, 11 items, lots, reservations, 3 formulas, 2 offers, 1 sales order, 2 manufacturing orders). Delete `web/.data/` to start over.
- **Demo sign-in.** The selector in the top bar switches between the four roles (Admin, Sales, Inventory, Partner facility), so you can see what each one sees. It is replaced by Supabase Auth when we go live.
- **Language.** The БГ / EN switch changes the whole interface. The choice is saved on the user's profile, so it follows them to other devices.

### What works now

| Screen | What you can do |
| --- | --- |
| Dashboard | Clients, open projects, production, stock alerts, sales pipeline, my tasks (tick to complete) |
| Clients | List with search and status filter; create a client with VAT clean-up and payment terms |
| Client page | Company and terms, contacts (first one becomes primary), projects with 8-stage tracker and reserved materials, change project stage, new project, activity log and tasks |
| Projects | All projects with stage filter |
| Inventory | Stock per item: on hand, quarantine, reserved, available, next expiry and status; expand an item for lots and reservations; filter by type, search |
| Receive goods | New lot into quarantine, lot number assigned, expiry from shelf life if left empty |
| Quality control | Admin releases or rejects quarantined lots; Admin or Inventory approves or rejects stock corrections |
| Formulas | Formula per serving (capsules, tablets, powders…), linked to a project or kept as a stock formula; versions (draft → approved → archived); ingredients with overage, input per unit and per 1000 packs; checks for Novel Food, shelf life, allergens, vegan/vegetarian and capsule fill; vitamins and minerals with % NRV; health claims with their conditions; Admin approves |
| Offers | Offer for a client on an approved formula version; packaging per pack; quantities priced from a margin or a fixed price; cost per pack from purchase prices (with price breaks), capsule shells, production costs of the format and set-up spread over the quantity; cost breakdown for users who may see purchase prices; status; offer document in the offer's language (print or save as PDF from the browser) |
| Sales orders | One client, several products: each line comes from a sent or accepted offer at one of its quantities (the offer becomes accepted); status from draft to closed; deposit and balance dates; "Plan production" per product. Inventory sees orders without prices |
| Production | Schedule of manufacturing orders with material status. Simulate a run (from an order line or on its own): materials needed (formula with overage and loss, packaging), reserved, free, at the partner, requested; reserve what is free; raise purchase requests for what is missing; put in the schedule (reserves); send to the partner (only when everything is reserved); cancel (releases reservations) |
| Costs | Packaging (jars, caps, labels) per formula version, copied into new offers and production orders. Every lot has a cost per unit (current purchase price on receipt, or the actual landed cost entered at receipt). Production orders show the planned cost, and after the batch the actual cost: lots consumed at their cost + partner invoices, total and per pack; the finished-goods lot carries the cost per pack. Visible only to users who may see purchase prices |
| Purchasing | Purchase requests from production, with status (open, ordered, received, cancelled) |
| Production costs | Admin keeps per-format fees (per pack, per 1000 units, per kg), set-up per batch, material loss and default margin |
| Partner portal | Production orders sent by Nutrikal (by project code), materials needed against stock at the facility; start production; report the batch (lots used, pre-filled first-expiry-first; quantity made; their batch number); finished goods go to quarantine for QC; enter their invoice per batch. Stock at the facility, receive goods, stock correction requests |

Invoices, purchasing and production orders are shown in the menu with the phase they arrive in.

## How the app talks to the database

All reads and writes run **as the signed-in user** (`web/src/lib/db/engine.ts` → `withUser`), so the row-level security and role checks in the migrations decide what each person sees and can do. The app has no separate permission logic to keep in sync.

Locally the database is PGlite (Postgres compiled to WebAssembly) with Supabase's `auth.uid()` stubbed. Moving to Supabase means replacing `getDb`/`withUser` with a connection to the Supabase database that sets the same two settings per transaction (`request.jwt.claim.sub` and role `authenticated`); queries stay the same.

## Migrations

| File | Contents |
| --- | --- |
| `20261019000100_core.sql` | Roles (admin, sales, inventory, partner), user profiles, company settings, audit log, number series |
| `20261019000200_crm.sql` | Clients (NK-C-0001), contacts, projects (NK-P-0001), activities, client files |
| `20261019000300_items_suppliers.sql` | Item master (raw materials, excipients, packaging, semi-finished, finished goods) with Novel Food status, EU allergens and shelf life; suppliers, supplier items, purchase prices with validity |
| `20261019000400_inventory.sql` | Locations, lots, stock ledger, reservations, adjustment requests, stock views and the stock functions |
| `20261019000500_access.sql` | Row-level security for every table, per role |
| `20261019000600_seed.sql` | Company settings row, number series, locations (Nutrikal warehouse + partner facility areas) |
| `20261019000700_storage.sql` | Private storage buckets `client-files` and `lot-documents` with access rules (Supabase only) |
| `20261019000800_user_prefs.sql` | Users can save their own interface language |
| `20261019001000_offers.sql` | Production costs per format, offers (OF-00001), packaging, quantity tiers, costing functions and access rules |
| `20261019001100_sales_orders.sql` | Sales orders (SO-00001) with lines from offers, status rules, overviews without prices |
| `20261019001200_manufacturing.sql` | Manufacturing orders (MO-00001), packaging, material requirements, reservations per manufacturing order, purchase requests (PR-00001), partner batch reporting, production invoices, partner view |
| `20261019001300_costing.sql` | Packaging per formula version, lot costs, consumption linked to the manufacturing order, batch cost functions |
| `20261019000900_formulation.sql` | Formulas (NK-F-0001), versions, lines, nutrients with NRV (Reg. 1169/2011 Annex XIII), item nutrient content, health claims, checks and access rules |

## Rules the database enforces

- **Stock is a ledger.** Balances are always summed from `stock_movements`. Rows cannot be edited or deleted; corrections are new movements.
- **Writes go through functions** that check the caller's role: `receive_lot`, `transfer_stock`, `post_stock_movement`, `reserve_stock`, `close_reservation`, `set_lot_qc_status`, `request_stock_adjustment`, `decide_stock_adjustment`.
- **No negative stock** per lot and location (locked per lot/location against concurrent writes).
- **QC gate.** New lots start in quarantine. Only Admin releases or rejects. Unreleased or expired lots cannot be consumed or dispatched.
- **Shelf life.** Lot expiry defaults to manufacture (or receipt) date + the item's shelf life. `expiring_lots` lists stock inside the warning window (90 days by default).
- **Reservations** cannot exceed available stock (released, not expired, minus active reservations).
- **Partner user** works only in partner-visible locations. They see projects by code only (`partner_projects`), never clients, prices, suppliers or invoices. They cannot adjust stock directly: they file a request that Admin or Inventory approves.
- **Purchase prices** are visible to Admin and Inventory, and to Sales users only if `can_see_purchase_prices` is on.
- **Raw materials and excipients** must have a Novel Food status.
- **Number series.** Invoices, credit and debit notes share one 10-digit series. Admin can set the next number (for example to continue from the current invoicing tool). Every change is audited.
- **Audit log** on all key tables, readable by Admin only.
- **Formulas.** Admin and Sales write drafts; only Admin approves. An approved version is locked (even for the database owner); changes go into a new version, and approving it archives the old one. Approval is refused without ingredients, without a shelf life, or with a Novel Food ingredient that is not authorised. Ingredients must be raw materials, excipients or semi-finished goods.
- **Label values.** Amount per serving and % NRV are calculated from the declared amounts (without overage) and each item's nutrient content. A health claim is marked as not met below its minimum (15 % NRV by default).
- **Partner user** sees no formulas, nutrients or claims (production instructions come in Phase 3).
- **Offers.** Only on an approved formula version, of the same client or a stock formula. Cost and price of each quantity are recalculated on every change while the offer is a draft and frozen once it is sent; only draft offers can be edited. Admin and Sales work with offers; Inventory and the partner see none. Production costs: Admin writes, Sales reads.
- **Sales orders.** Only from offers of the same client; lines change only on a draft. Status order: draft → confirmed → in production → ready → dispatched → closed (cancel before dispatch). Production starts only after the deposit is received; with "balance before dispatch" the order is dispatched only after the balance is received; Admin may override both. The projects of the lines follow the order. Inventory sees orders without prices; the partner sees none.
- **Manufacturing.** Status changes only through the production functions. Simulation: anyone on staff; scheduling, sending to the partner and cancelling: Admin or Inventory. Quantity, formula and project change only in simulation. Scheduling reserves free stock; sending needs every material fully reserved. The partner sees only orders sent to it, by project code, and the materials without Nutrikal's free stock; it consumes only lots at partner locations and only materials of the order; the finished lot gets the partner's batch number and starts in quarantine. Completing closes the reservations as consumed. The partner enters its own invoice per batch; Sales cannot see production invoices.
- **Costs.** Lot costs live in their own table, readable only by users who may see purchase prices (never the partner); Admin or Inventory set them. Batch cost = consumed lots × lot cost (current purchase price, marked as estimated, when a lot has no cost) + partner invoices; recalculated when an invoice is added. Valuation is by actual lot cost (specific identification).
- **Purchase prices on offers.** The cost breakdown per item is shown only to users who may see purchase prices; Sales see cost and margin per quantity.

## Tests

```
cd test && npm install
node run-tests.mjs          # 124 database rule checks across the four roles
python3 ui_test.py http://localhost:3000   # 20 browser checks (needs Python Playwright + Chromium)
```

The browser tests create a client, contact, project and task, receive and release a lot, send and approve a partner correction, switch languages, and check every page in both languages at 375, 768, 1024 and 1440 px for sideways scrolling. Run them on a fresh `web/.data`.

## Apply to Supabase (later)

1. Create a Supabase project in a Nutrikal-owned organization (paid plan for daily backups), e.g. `nutrikal-erp`.
2. `supabase link --project-ref <ref>` and `supabase db push` from this folder.
3. Invite users in Supabase Auth, then add one `profiles` row per user with their role.
4. Fill `company_settings` (legal name, VAT, EIK, bank details) and set `number_series.next_number` for invoices.

## Points to review

- Bulgarian text: Poppins has no Cyrillic letters, so Bulgarian falls back to Montserrat, a similar geometric typeface. Latin text stays in Poppins.
- `NK-WH` (Nutrikal warehouse) is seeded as a location. Deactivate it if all stock is kept at the partner.
- Location names, item names and project names are data, so they show as entered. Items have a Bulgarian name field used in the Bulgarian interface.
- The partner can read item names, including finished goods. If a product name reveals the client's brand, use neutral names.
- Reservations are per item or per lot. Linking them to manufacturing orders and consuming them automatically comes with production in Phase 3.
- Logo: the NUTRIKAL wordmark (`web/public/nutrikal-wordmark.webp`) is in the menu and on the offer document. The browser icon (`web/src/app/icon.svg`) is a vector redraw of the "n" icon; replace it with the original artwork if you have it.
- Reports for the accountant (stock valuation, materials consumed, cost of batches and of goods sold) come as a separate module and build on lot and batch costs.
- Purchase requests are a list for now; purchase orders to suppliers (and receiving against them) come next.
- The partner enters its invoice per batch (owner decision, to be reviewed after trying it).
- Admin can start production before the deposit and dispatch before the balance (override). Remove the override in `sales_orders_guard` if it should be blocked for everyone.
- Sales users see cost and margin per quantity on offers (not the purchase price of each item). Change `offer_tiers` access if Sales should see prices only.
- Health claims in the demo data are examples. Copy the wording from the EU Register (Reg. 432/2012) in both languages before using claims on real labels.
- Nutrient content (e.g. 14 % magnesium in magnesium bisglycinate) is entered per item; check it against the supplier specification or COA.
- Lot numbers use `LOT-000001`. Change the prefix in `number_series` before the first real receipt if you prefer another format.
