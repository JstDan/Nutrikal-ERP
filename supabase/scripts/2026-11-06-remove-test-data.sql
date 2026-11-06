-- =====================================================================
-- Nutrikal ERP — remove the test data (owner, 06/11/2026). ONE-OFF, not a migration.
-- Run with:  cd web && node --env-file=.env.local scripts/run-sql-once.mjs ../supabase/scripts/2026-11-06-remove-test-data.sql [--commit]
-- Without --commit it runs and rolls back (dry run). Backup before: D:\Nutrikal Backups\2026-11-06_1213.
--
-- The owner decided that every business record so far is a test: clients, offers, recipes, sales
-- and manufacturing orders, purchase requests and orders, expected deliveries, received lots,
-- reservations, tasks, dispatches, proformas and invoices, and every stock movement after the
-- opening-stock import (27/10/2026). Kept:
--   * the opening-stock import (144 opening_balance movements and their lots): stock goes back
--     exactly to it, checked at the end;
--   * four clients with saved Gmail mail (NK-C-0005, NK-C-0008, NK-C-0012, NK-C-0013), only with
--     their contacts and mail (client_emails); nothing tied to Gmail is touched;
--   * items, suppliers, prices, the calculator price list, the catalogue (no product uses a recipe),
--     catalogue enquiries and chats (unlinked from deleted clients), users, chat, AI, settings,
--     the log of sent documents, the audit log (the deletes below are written to it).
-- Number series start again at 1 (SO, MO, PO, PR, ED, LOT, DN, PF, OF, invoices, projects, recipes,
-- calculator offers). Clients keep their series (the four kept clients hold NK-C-0005..0013).
-- Storage files of deleted records are removed by the runner after the commit.
-- =====================================================================

-- Guards that forbid deleting ledger rows, issued invoices, sent purchase orders, recipe versions, lines
-- of orders in progress, and the triggers that refresh other rows when a line is deleted: off only
-- inside this transaction (named one by one; the foreign-key cascades stay on).
create temp table guards (tbl text, trg text) on commit drop;
insert into guards values
  ('stock_movements', 'stock_movements_immutable'), ('invoices', 'invoices_guard'), ('invoice_lines', 'invoice_lines_guard'),
  ('formula_versions', 'formula_versions_no_delete'), ('formula_lines', 'formula_lines_guard'), ('formula_lines', 'formula_lines_offer_edited'),
  ('formula_packaging', 'formula_packaging_guard'), ('formula_pending_lines', 'formula_pending_lines_guard'),
  ('formula_pending_lines', 'formula_pending_lines_offer_edited'), ('formula_version_claims', 'formula_version_claims_guard'),
  ('calc_offers', 'calc_offers_in_order_guard'), ('mo_packaging', 'mo_packaging_guard'), ('mo_packaging', 'order_tasks_on_mo_packaging'),
  ('offer_packaging', 'offer_packaging_guard'), ('offer_packaging', 'offer_packaging_refresh'), ('offer_tiers', 'offer_tiers_guard_delete'),
  ('purchase_order_lines', 'purchase_order_lines_guard'), ('purchase_orders', 'purchase_orders_guard'),
  ('sales_order_lines', 'sales_order_lines_guard');
do $$ declare g record; begin
  for g in select * from guards loop execute format('alter table public.%I disable trigger %I', g.tbl, g.trg); end loop;
end $$;

create temp table keep_clients on commit drop as
  select id from public.clients where code in ('NK-C-0005', 'NK-C-0008', 'NK-C-0012', 'NK-C-0013');
create temp table opening on commit drop as
  select item_id, lot_id, location_id, sum(quantity) as qty
    from public.stock_movements where type = 'opening_balance' group by 1, 2, 3;
create temp table test_lots on commit drop as
  select id from public.lots l where not exists (select 1 from public.stock_movements m where m.lot_id = l.id and m.type = 'opening_balance');

-- 1. notifications about deleted records (catalogue enquiries and chat mentions stay)
delete from public.notifications where kind::text in ('mo_sent', 'mo_completed', 'delivery_ordered', 'delivery_received', 'client_message');

-- 2. order task boards (columns, tasks, checklists, comments, files, links, activity go with them)
delete from public.order_task_boards;

-- 3. invoices, proformas, credit and debit notes (lines and payments go with them); notes first
delete from public.invoices where corrects_invoice_id is not null;
delete from public.invoices;

-- 4. stock: every movement after the import, every reservation, dispatches
delete from public.stock_adjustment_requests;
delete from public.stock_movements where type <> 'opening_balance';
delete from public.stock_reservations;
delete from public.dispatches;

-- 5. purchasing and production
delete from public.delivery_attachments;
delete from public.purchase_order_lines;
delete from public.purchase_orders;
update public.lots set expected_delivery_id = null where expected_delivery_id is not null;
delete from public.expected_deliveries;
delete from public.mo_material_usage;
delete from public.production_invoices;
delete from public.purchase_requests;
delete from public.manufacturing_orders;
delete from public.lots where id in (select id from test_lots);

-- 6. sales orders (lines, corrections, pending proformas, portal messages go with them)
delete from public.sales_orders;

-- 7. offers and recipes
delete from public.offers;
delete from public.calc_offers;
delete from public.formulas;          -- versions, lines, packaging, claims go with them

-- 8. items made for client projects (finished goods FG-NK-P-...), projects
delete from public.items where client_id is not null or project_id is not null;
delete from public.projects;

-- 9. clients: portal messages, files, CRM notes of all; then every client except the four with Gmail mail
delete from public.client_status_mail;
delete from public.client_messages;
delete from public.client_threads;
delete from public.client_files;
delete from public.activities;
update public.catalog_enquiries set client_id = null where client_id is not null and client_id not in (select id from keep_clients);
delete from public.clients where id not in (select id from keep_clients);   -- portal accounts' links and contacts go with them

-- 10. number series
update public.number_series set next_number = 1, updated_at = now()
 where key in ('sales_order', 'production', 'purchase_order', 'purchase_request', 'delivery', 'lot', 'delivery_note',
               'proforma', 'offer', 'invoice', 'project', 'formula');
update public.calc_offer_counters set last_no = 0;

do $$ declare g record; begin
  for g in select * from guards loop execute format('alter table public.%I enable trigger %I', g.tbl, g.trg); end loop;
end $$;

-- 11. checks: stock is exactly the opening import; nothing left that should be gone
do $$
declare v_diff int; v_left text;
begin
  select count(*) into v_diff from (
    select item_id, lot_id, location_id, sum(quantity) as qty from public.stock_movements group by 1, 2, 3
  ) b full join opening o using (item_id, lot_id, location_id)
  where coalesce(b.qty, 0) <> coalesce(o.qty, 0);
  if v_diff > 0 then
    raise exception 'Stock differs from the opening import in % lot/location rows', v_diff;
  end if;
  select string_agg(t || '=' || n, ', ') into v_left from (
    select 'sales_orders' t, count(*) n from public.sales_orders union all
    select 'manufacturing_orders', count(*) from public.manufacturing_orders union all
    select 'invoices', count(*) from public.invoices union all
    select 'formulas', count(*) from public.formulas union all
    select 'calc_offers', count(*) from public.calc_offers union all
    select 'stock_reservations', count(*) from public.stock_reservations union all
    select 'order_tasks', count(*) from public.order_tasks union all
    select 'projects', count(*) from public.projects
  ) x where n > 0;
  if v_left is not null then
    raise exception 'Left over: %', v_left;
  end if;
  if (select count(*) from public.clients) <> 4 then
    raise exception 'Expected 4 clients, found %', (select count(*) from public.clients);
  end if;
end
$$;
