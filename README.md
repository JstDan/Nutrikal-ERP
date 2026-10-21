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
- **Two modes.** With the Supabase values in `web/.env.local` filled in (see `web/.env.example`), the app uses the Supabase database, Storage and sign-in (email + password). With them empty it runs on the local database for development, signed in as the demo Developer.
- **Developer: acting as.** Only a developer gets the selector in the top bar; it switches to any active non-developer user (checked and logged in the database).
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
| Quality control | Admin releases or rejects quarantined lots (with the waybill photos of the delivery they came from); older correction requests can still be decided |
| Formulas | Formula per serving (capsules, tablets, powders…), linked to a project or kept as a stock formula; versions (draft → approved → archived); ingredients with overage, input per unit and per 1000 packs; checks for Novel Food, shelf life, allergens, vegan/vegetarian and capsule fill; vitamins and minerals with % NRV; health claims with their conditions; Admin approves |
| Offers | Offer for a client on an approved formula version; packaging per pack; quantities priced from a margin or a fixed price; cost per pack from purchase prices (with price breaks), capsule shells, production costs of the format and set-up spread over the quantity; cost breakdown for users who may see purchase prices; status; offer document in the offer's language (print or save as PDF from the browser) |
| Sales orders | One client, several products: each line comes from a sent or accepted offer at one of its quantities (the offer becomes accepted); status from draft to closed; deposit and balance dates; "Plan production" per product |
| Production | Schedule of manufacturing orders with material status. Simulate a run (from an order line or on its own): materials needed (formula with overage and loss, packaging), reserved, free, requested, ordered, at production; reserve what is free; raise purchase requests, or order a material from a supplier in one step (request + expected delivery); put in the schedule (reserves); send to production (only when everything is reserved); start or report on behalf of production, or move back one step with a reason; after the batch: reserved vs used per material with reason and value of the difference; cancel (releases reservations) |
| Costs | Packaging (jars, caps, labels) per formula version, copied into new offers and production orders. Every lot has a cost per unit (current purchase price on receipt, or the actual landed cost entered at receipt). Production orders show the planned cost, and after the batch the actual cost: lots consumed at their cost + production invoices, total and per pack; the finished-goods lot carries the cost per pack. Visible only to users who may see purchase prices |
| Purchasing | Purchase requests from production, with status (open, ordered, received, cancelled); "Order" turns an open request into an expected delivery |
| Incoming deliveries | What is ordered from suppliers and when it should arrive: several items at once with supplier, date, order number, arrival location and price; grouped as overdue / next 7 days / later; receive in parts (each part is a new lot in quarantine at the delivery price; more than expected is allowed and reported), close short, change date, quantity or price, cancel. Visible to users who may see purchase prices |
| Inventory additions (from Nutrikal Inventory) | Incoming and projected (available + incoming) per item; "Short" when stock falls below what is reserved; stock count per lot (the difference is posted as a correction); new item and item editing (names, Novel Food, shelf life, reorder level, allergens, vegan/vegetarian) |
| Pick list | Printable list of materials for a production order sent to production, lots suggested first-expiry-first from released stock at the facility; Admin and Production |
| Accounting export | Admin: movements, production consumption, stock value and open deliveries for a period, on screen and as an Excel workbook in the user's language |
| Change history | Admin: every change to key records with who and when, filters, CSV download |
| Production costs | Admin keeps per-format fees (per pack, per 1000 units, per kg), set-up per batch, material loss and default margin |
| Developer | A developer has no data rights of their own. A second dropdown in the top bar lists every other active user (name and role); the app then runs every page and action as the chosen user, so that user's role and row-level security apply unchanged. Each switch is logged in `impersonation_log` (readable by Admin and the developer) |
| Production portal (/factory) | Orders sent by Nutrikal by project code: Waiting → In production → Ready to ship. Per material: supplier, quantity, purchase price and date (read only). Report: used per lot next to the reserved quantity (pre-filled first-expiry-first), reason when the difference is over the tolerance (5 %, company setting), batch number and quantity; the finished goods go to quarantine in PF-QUAR. Stock at its locations with direct corrections (reason required, Admin notified). Deliveries: Ordered → Received with waybill photos from the phone (compressed in the browser), quantity, supplier batch and expiry. Invoice per batch |
| Notifications | Bell with unread count for every user. Admin: stock corrected by production, delivery received (+ photos), order ready to ship (with materials over the tolerance). Production: new order sent, delivery ordered. Admin notifications are also e-mailed (Edge Function `notify-admins`, Resend) |
| Corrections by production | Admin: every stock correction made by production, from the stock ledger |

Invoices, purchasing and production orders are shown in the menu with the phase they arrive in.

## How the app talks to the database

All reads and writes run **as the signed-in user** (`web/src/lib/db/engine.ts` → `withUser`), so the row-level security and role checks in the migrations decide what each person sees and can do. The app has no separate permission logic to keep in sync.

With `DATABASE_URL` set, `withUser` opens a transaction on the Supabase database and sets `request.jwt.claim.sub` and role `authenticated`, exactly like Supabase's own API. Without it (local development) the database is PGlite (Postgres compiled to WebAssembly) with Supabase's `auth.uid()` stubbed. Sign-in is Supabase Auth (`web/src/lib/supabase/server.ts`, `web/src/proxy.ts`); the signed-in user's id is the one every query runs as.

## Migrations

| File | Contents |
| --- | --- |
| `20261019000100_core.sql` | Roles, user profiles, company settings, audit log, number series |
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
| `20261021000100_deliveries_counts.sql` | Expected deliveries (ED-00001) with partial receipts linked to lots and purchase requests, incoming and projected stock per item, stock count |
| `20261022000100_developer_role.sql` | Developer role: list of users to act as, logged switching |
| `20261023000100_roles_restructure.sql` | Inventory merged into Admin (existing profiles moved, value refused), Partner renamed Production; functions, views and policies rewritten |
| `20261023000200_notifications.sql` | Notifications per user, production settings (usage tolerance, waybill-photo rule) |
| `20261023000300_production_flow.sql` | Direct stock corrections by production, status steps and admin step back, batch report with reserved vs used, material sources, ordering from the order screen, delivery terms after receipt, delivery attachments, receipts by production |
| `20261023000400_delivery_docs_storage.sql` | Private bucket `delivery-docs` and its rules (Supabase only) |
| `20261024000100_calc_scheduled_sync.sql` | Daily 17:00 price-list sync run by the server (`calc_record_scheduled_sync`, not callable by users) |
| `20261019000900_formulation.sql` | Formulas (NK-F-0001), versions, lines, nutrients with NRV (Reg. 1169/2011 Annex XIII), item nutrient content, health claims, checks and access rules |

## Rules the database enforces

- **Stock is a ledger.** Balances are always summed from `stock_movements`. Rows cannot be edited or deleted; corrections are new movements.
- **Writes go through functions** that check the caller's role: `receive_lot`, `transfer_stock`, `post_stock_movement`, `reserve_stock`, `close_reservation`, `set_lot_qc_status`, `request_stock_adjustment`, `decide_stock_adjustment`.
- **No negative stock** per lot and location (locked per lot/location against concurrent writes).
- **QC gate.** New lots start in quarantine. Only Admin releases or rejects. Unreleased or expired lots cannot be consumed or dispatched.
- **Shelf life.** Lot expiry defaults to manufacture (or receipt) date + the item's shelf life. `expiring_lots` lists stock inside the warning window (90 days by default).
- **Reservations** cannot exceed available stock (released, not expired, minus active reservations).
- **Production user** works only in partner-visible locations (PF-…). They see projects by code only (`production_projects`), never clients, sales prices, offers or invoices. They correct raw materials and packaging directly (ledger adjustment, reason required, every admin notified). They see supplier and purchase price only for the materials of their own orders. They receive deliveries to their locations into PF-QUAR with at least one waybill photo, and delete their own files only within 24 hours.
- **Purchase prices** are visible to Admin, and to Sales users only if `can_see_purchase_prices` is on.
- **Raw materials and excipients** must have a Novel Food status.
- **Number series.** Invoices, credit and debit notes share one 10-digit series. Admin can set the next number (for example to continue from the current invoicing tool). Every change is audited.
- **Audit log** on all key tables, readable by Admin only.
- **Formulas.** Admin and Sales write drafts; only Admin approves. An approved version is locked (even for the database owner); changes go into a new version, and approving it archives the old one. Approval is refused without ingredients, without a shelf life, or with a Novel Food ingredient that is not authorised. Ingredients must be raw materials, excipients or semi-finished goods.
- **Label values.** Amount per serving and % NRV are calculated from the declared amounts (without overage) and each item's nutrient content. A health claim is marked as not met below its minimum (15 % NRV by default).
- **Production user** sees no formulas, nutrients or claims (production instructions come in Phase 3).
- **Offers.** Only on an approved formula version, of the same client or a stock formula. Cost and price of each quantity are recalculated on every change while the offer is a draft and frozen once it is sent; only draft offers can be edited. Admin and Sales work with offers; Production sees none. Production costs: Admin writes, Sales reads.
- **Sales orders.** Only from offers of the same client; lines change only on a draft. Status order: draft → confirmed → in production → ready → dispatched → closed (cancel before dispatch). Production starts only after the deposit is received; with "balance before dispatch" the order is dispatched only after the balance is received; Admin may override both. The projects of the lines follow the order. Production sees none.
- **Manufacturing.** Status changes only through the production functions. Simulation: anyone on staff; scheduling, sending to production and cancelling: Admin. Production moves its orders only forward (start, report); Admin can do both for them and move an order one step back with a reason; Ready to ship is final. Quantity, formula and project change only in simulation. Scheduling reserves free stock; sending needs every material fully reserved. Production sees only orders sent to it, by project code, and the materials without Nutrikal's free stock; it uses only lots at its locations and only materials of the order; a used quantity more than the tolerance away from the reserved one needs a reason; the finished lot gets its batch number and starts in quarantine in PF-QUAR. Reporting consumes the used part of the reservations and releases the rest. Production enters its own invoice per batch; Sales cannot see production invoices.
- **Costs.** Lot costs live in their own table, readable only by users who may see purchase prices (Production only through the materials of its orders); Admin sets them, also by changing the price of a received delivery. Batch cost = consumed lots × lot cost (current purchase price, marked as estimated, when a lot has no cost) + production invoices; recalculated when an invoice is added. Valuation is by actual lot cost (specific identification).
- **Purchase prices on offers.** The cost breakdown per item is shown only to users who may see purchase prices; Sales see cost and margin per quantity.

## Tests

```
cd test && npm install
node run-tests.mjs          # 206 database rule checks across the roles
python3 ui_test.py http://localhost:3000   # 18 browser checks (needs Python Playwright + Chromium)
```

The browser tests create a client, contact, project and task, receive and release a lot, correct stock as production, switch languages, and check every page in both languages at 375, 768, 1024 and 1440 px for sideways scrolling. Run them on a fresh `web/.data`.

## Connect to Supabase

1. Create a Supabase project in a Nutrikal-owned organization (paid plan for daily backups).
2. Fill in `web/.env.local` (`web/.env.example` says where each value is in the Supabase dashboard). Restart the app after changing it.
3. `cd web && npm run db:migrate` applies every migration to the Supabase database (recorded like `supabase db push`, so the Supabase CLI can be used too). To also load the opening stock from the old Nutrikal Inventory app once: check `supabase/import/REVIEW.md`, set the location at the top of `supabase/import/opening_stock.sql` (`NK-WH` or `PF-RM`), then run `npm run db:migrate -- --with-opening-stock`.
4. Authentication → Sign In / Providers: keep Email on and turn **off** "Allow new users to sign up" (only the administrator creates accounts).
5. Users: Authentication → Users → Add user → Create new user (email, password, "Auto Confirm User"). Then give the user a profile and role in the SQL editor — without it they cannot sign in:
   ```sql
   insert into profiles (id, full_name, email, role, locale)
   select id, 'Full Name', email, 'admin', 'bg' from auth.users where email = 'name@nutrikal.com';
   ```
   Roles: `admin`, `sales`, `production`, `developer` (sees and does everything any user can, by acting as them). To block a user: `update profiles set is_active = false where email = '…'`. To set a new password: `update auth.users set encrypted_password = extensions.crypt('new password', extensions.gen_salt('bf')) where email = '…';`
6. Calculator price list: `GOOGLE_SHEET_URL` (shared "Anyone with the link – Viewer"). It syncs every day at 17:00 Sofia time and with the Sync button. On a long-running server (`next start`) a built-in timer does it; on Vercel the cron jobs in `web/vercel.json` call `/api/cron/price-sync` with `CRON_SECRET` (any other scheduler can call it hourly with the header `Authorization: Bearer <CRON_SECRET>`). If 17:00 was missed, it syncs when the calculator is next opened.
7. Fill `company_settings` (legal name, VAT, EIK, bank details) and set `number_series.next_number` for invoices.

## Points to review

- Bulgarian text: Poppins has no Cyrillic letters, so Bulgarian falls back to Montserrat, a similar geometric typeface. Latin text stays in Poppins.
- `NK-WH` (Nutrikal warehouse) is seeded as a location. Deactivate it if all stock is kept at the partner.
- Location names, item names and project names are data, so they show as entered. Items have a Bulgarian name field used in the Bulgarian interface.
- Production can read item names, including finished goods. If a product name reveals the client's brand, use neutral names.
- Reservations are per item or per lot. Linking them to manufacturing orders and consuming them automatically comes with production in Phase 3.
- Logo: the NUTRIKAL wordmark (`web/public/nutrikal-wordmark.webp`) is in the menu and on the offer document. The browser icon (`web/src/app/icon.svg`) is a vector redraw of the "n" icon; replace it with the original artwork if you have it.
- The accounting export covers movements, consumption, stock value and open deliveries. Cost of goods sold comes with invoicing.
- Expected deliveries stand in for purchase orders to suppliers; there is no purchase order document yet.
- Imported ingredients (142, codes RM-1001… and EX-…) have Novel Food status "unknown", no shelf life and no Bulgarian name. Complete them on the item page before using them in an approved formula. Items that had no supplier in the old app get a lot cost but no purchase price until a supplier and price are added.
- The local demo database loads the same opening stock (into the Nutrikal warehouse) next to the demo data.
- The partner enters its invoice per batch (owner decision, to be reviewed after trying it).
- Admin can start production before the deposit and dispatch before the balance (override). Remove the override in `sales_orders_guard` if it should be blocked for everyone.
- Sales users see cost and margin per quantity on offers (not the purchase price of each item). Change `offer_tiers` access if Sales should see prices only.
- Health claims in the demo data are examples. Copy the wording from the EU Register (Reg. 432/2012) in both languages before using claims on real labels.
- Nutrient content (e.g. 14 % magnesium in magnesium bisglycinate) is entered per item; check it against the supplier specification or COA.
- Lot numbers use `LOT-000001`. Change the prefix in `number_series` before the first real receipt if you prefer another format.
