# Nutrikal ERP + CRM — instructions for Claude Code

Read this before every task. README.md has run/test commands and the full rule list.

## What this is
One app (app.nutrikal.com) that runs Nutrikal's **contract manufacturing / private label** business: CRM, offers, formulation, inventory, production, QC and invoicing. Own brands (CollagenLab, GutExpert) are OUT of scope — they move to a separate company and separate software later.

Production is outsourced to ONE partner facility but run as if in-house. The facility has one user in this app with the restricted role `production`.

Talk to the owner in the language they write in (usually Bulgarian).

## Decisions already made (do not reopen without asking)
- ERP and CRM are ONE system on ONE database; clients, projects, stock, batches and invoices link to each other.
- Nutrikal owns all raw materials, packaging and finished goods at every location.
- Partner invoices Nutrikal per batch (record against the batch for actual cost).
- Client-supplied materials: not in v1.
- Offers are costed per unit and priced by product format.
- Payment terms: usually deposit + balance before dispatch; editable per client and per order.
- The ERP issues FINAL invoices. Invoice numbers: one 10-digit series shared by invoices, credit and debit notes; editable on a draft before issue with duplicate/gap warnings and audit log; locked after issue; corrections only via credit/debit notes. Design the invoice data to map to EN 16931 (Bulgaria plans mandatory structured e-invoicing from 2028).
- Shelf life is tracked per raw material. Recipes have none (owner, Oct 2026): the expiry date of a finished batch is entered when it is reported.
- Materials are released on receipt; finished batches need Admin release before dispatch; the COA is optional and can be attached later. Any lot can be blocked (owner, Oct 2026).
- Documents are e-mailed through the Resend HTTP API (the host, Cloudflare Workers, has no SMTP); every send is logged in `document_sends` (owner, Oct 2026).
- New offers are made only in the calculator; older ERP offers stay readable and usable but cannot be created. Production of an order is planned with Prepare production (owner, Oct 2026).
- AI: OpenAI API directly, not Kie.ai (owner, Oct 2026): Responses API with `store: false` (AI_BASE_URL, AI_API_KEY, AI_MODELS; `web/src/lib/ai/gateway.ts`). The assistant only reads, through fixed queries run as the signed-in user (`web/src/lib/ai/tools.ts`); AI proposes and a person approves: recipes proposed in the chat become drafts only when a person saves them; figures come from `recipe_estimate`, never from the model; purchase prices follow `can_see_purchase_prices`. Health claims and Novel Food status come from `eu_health_claims` and `eu_novel_food_status` (public EU lists, refreshed with `web/scripts/eu-lists.mjs` into a new migration). There are no harmonised EU maximum doses. Production has no AI access (owner, Oct 2026).
- Gmail: one shared mailbox connected once by Admin with `gmail.readonly` (owner, Oct 2026). Gmail is searched only for client addresses (domains, full addresses on public mail services); a changed list starts over from 12 months back. Only mail to and from known clients is kept (`client_emails`); Production has no access; the token is encrypted (`gmail_connection`, no policies). Mail reaches the AI only with AI_READ_MAIL=on; the data processing agreement with OpenAI is signed (owner, Oct 2026).
- Invoices can be issued without an order, directly to a client, with free lines, due date, way of payment and recorded payments (`invoice_payments`, Admin writes); same number series; issued invoices stay locked. A proforma is made from such a draft on its own series (PF-); 0 % VAT needs a printed basis; invoices of orders count as paid from the order; copying an invoice and payment reminders are by hand only (owner, Oct 2026).
- Production contract (planned, not built; owner, Oct 2026): optional per order, sent with the proforma, never blocks an order. The owner provides the template later. Planned: client accepts through a link (time, address, PDF copy kept) or Admin marks it signed by hand.
- Chat is in the side menu (/chat, the full view) and in the header (`chat-drawer.tsx`, a panel over any page) (owner, Oct 2026): channels, direct messages, files, mentions, reactions, Nutrikal emoji (`web/public/emoji`). Production sees only channels of kind external, no direct messages. Admin creates channels; new messages come by polling, not realtime (owner, Oct 2026). The accountant writes in it through `qChat` (no read-only transaction): has_role() is false there, so only the chat rules apply; never use qChat for anything else. Client files (`client_files`, bucket client-files, up to 24 MB) sit on a client and optionally an order.
- All settings live under Settings and are Admin only (owner, Oct 2026). New settings go there.
- Catalogue of stock formulas (owner, Oct 2026): any recipe, also one of a client, can become a product (`catalog_products`) and be published; Admin manages it, Sales reads it and handles enquiries. Prices by quantity tiers, minimum order 500 packs. catalog.nutrikal.com is the same app: the middleware sends that address only to /public-catalog, open to everyone, with a basket and one enquiry. The open page runs as anon (`qPublic`) and reaches only `catalog_public()` and `catalog_submit_enquiry()`. Categories are by kind of product, not by health benefit. Health claims on the page come only from the approved recipe.
- Languages: Bulgarian and English only (UI and documents).
- Roles: admin, sales, production (+ developer, who acts as another user), bookkeeper (works like Sales, and payments, dispatch, invoice numbers, admin dashboard, accounting export), accountant (sees everything, changes nothing except writing in the chat, AI panel without saved conversations), designer (clients, projects and orders without prices, uploads client files). The accountant runs in read-only transactions (`app_session_start`), so the database refuses their writes; the accountant has reading rights only inside such a transaction. Accounts are made under Settings > Users (owner, Oct 2026). Inventory was merged into Admin and Partner renamed Production (Oct 2026). Formulation and QC rights sit with admin for now.
- Stack: Next.js (web/) + Supabase (Postgres, Auth, Storage). Hosted at app.nutrikal.com.
- Everything is in Supabase except the calculator's price list, whose source is the Google Sheet (GOOGLE_SHEET_URL): synced daily at 17:00 Sofia time and with the Sync button (Oct 2026).

## Architecture rules
- **All data access runs as the signed-in user** through `withUser()` / `q()` in `web/src/lib/db/engine.ts`. Row-level security and role checks live in the database (`supabase/migrations`). Never bypass them and never duplicate permission logic in the UI beyond hiding buttons.
- **Stock is a ledger** (`stock_movements`): never update stock numbers; write through the SQL functions (`receive_lot`, `transfer_stock`, `post_stock_movement`, `reserve_stock`, …).
- **Production must never see** client names, sales prices, offers, delivery notes or Nutrikal's invoices. Projects appear to them by code only (`production_projects`). Exception decided by the owner (Oct 2026): supplier, ordered quantity, purchase price and date of the materials of their own orders (`mo_material_sources`, read only), and the supplier of deliveries to their locations. Any new table or view needs an explicit RLS decision for the production role, and a test.
- **Schema changes** = a NEW migration file in `supabase/migrations` (timestamped name). Once a migration has been applied to Supabase, never edit it.
- With the Supabase values in `web/.env.local` the app uses Supabase (database via `DATABASE_URL`, Auth email + password, Storage); new migrations go there with `cd web && npm run db:migrate`. Users are created in Supabase Auth + a `profiles` row (README). Without those values (development) the database is PGlite in `web/.data/` (created from the migrations + `web/src/lib/db/demo-seed.ts`). Delete `web/.data/` after changing migrations or the seed.
- Next.js 16 with `cacheComponents: false` (every page is per-user and dynamic). Read `web/node_modules/next/dist/docs/` before using unfamiliar Next.js APIs — this version differs from older ones.

## UI rules
- **Every user-visible string goes in BOTH `web/src/lib/i18n/en.ts` and `bg.ts`.** No hard-coded text in components. Use `fmt()`, `formatNumber/Qty/Money/Date` from `web/src/lib/i18n`.
- **NEVER horizontal scrolling** on any page or width (owner's strong rule). Data lists use CSS grid rows (`.row`) and drop columns on narrow screens with `hide-md` (<1024px) / `hide-sm` (<768px) — no `<table>` with overflow.
- Design tokens from nutrikal.com live in `web/src/app/globals.css`: Poppins (Montserrat for Cyrillic), ink #222831, white, light grey #EBEBEB, border #C6CDD9, green #7BC74D only for positive states, red #D72C0D for critical. Buttons: `.btn .btn-primary` / `.btn-outline` (uppercase, 12px, 600, wide tracking, 2px radius).
- Touch targets ≥ 44px; real `<button>`, `<a>`, `<label>`; text contrast ≥ 4.5:1.
- Items show `name_bg` in the Bulgarian interface when present.

## EU / regulatory context (food supplements)
Flag ingredients with Novel Food status (Reg. 2015/2283); health claims only from the EU Register under Reg. 1924/2006 at the right conditions of use; labelling per Reg. 1169/2011 and Dir. 2002/46/EC (NRV %); batch traceability per Reg. 178/2002 art. 18.

## Before you finish a task
1. `cd test && node run-tests.mjs` — database rules (must stay green; add tests for new rules).
2. `cd web && npx tsc --noEmit && npm run build`.
3. For UI changes: check the page in both languages and at phone width; no sideways scroll.
4. Commit on a branch with a clear message; open a Pull Request for the owner to review.

## Roadmap
- Phase 1 (done): foundation — roles, CRM, items, suppliers, lots, stock ledger, reservations, QC release, partner portal.
- Phase 2: formulation (formula builder per serving, versions, shelf life, regulatory flags, label/NRV data) + offers (per-unit costing by format, tiers, PDF) — replaces the existing Formula Calculator (Supabase project "nutrikal-calculator"; its price list syncs from a Google Drive file).
- Phase 3: sales orders, purchasing, manufacturing orders, partner production flow, traceability report.
- Phase 4: invoicing and documents (proforma, invoice, credit/debit notes, accountant export, delivery notes, COAs).
- Phase 5: reporting, client portal, EN 16931 structured invoices.
