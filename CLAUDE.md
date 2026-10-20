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
- Shelf life is tracked per formula version and per raw material.
- Languages: Bulgarian and English only (UI and documents).
- Roles: admin, sales, production (+ developer, who acts as another user). Inventory was merged into Admin and Partner renamed Production (Oct 2026). Formulation and QC rights sit with admin for now.
- Stack: Next.js (web/) + Supabase (Postgres, Auth, Storage). Hosted at app.nutrikal.com.

## Architecture rules
- **All data access runs as the signed-in user** through `withUser()` / `q()` in `web/src/lib/db/engine.ts`. Row-level security and role checks live in the database (`supabase/migrations`). Never bypass them and never duplicate permission logic in the UI beyond hiding buttons.
- **Stock is a ledger** (`stock_movements`): never update stock numbers; write through the SQL functions (`receive_lot`, `transfer_stock`, `post_stock_movement`, `reserve_stock`, …).
- **Production must never see** client names, sales prices, offers or Nutrikal's invoices. Projects appear to them by code only (`production_projects`). Exception decided by the owner (Oct 2026): supplier, ordered quantity, purchase price and date of the materials of their own orders (`mo_material_sources`, read only), and the supplier of deliveries to their locations. Any new table or view needs an explicit RLS decision for the production role, and a test.
- **Schema changes** = a NEW migration file in `supabase/migrations` (timestamped name). Once a migration has been applied to Supabase, never edit it.
- Locally the database is PGlite in `web/.data/` (created from the migrations + `web/src/lib/db/demo-seed.ts`). Delete `web/.data/` after changing migrations or the seed.
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
