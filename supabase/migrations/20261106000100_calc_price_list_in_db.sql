-- =====================================================================
-- Nutrikal ERP + CRM — the calculator's price list lives in the database
-- The Google Sheet sync is stopped (owner, Nov 2026): raw materials and
-- catalog products are kept and edited in the app only. Admin changes the
-- name, price and status of a raw material and every field of a catalog
-- product; nothing is deleted, a product or material is set inactive
-- (hidden from the calculator; saved offers keep their data). Sales still
-- adds a missing raw material from the formula search
-- (calc_add_raw_material). The sync functions are removed; the history of
-- earlier runs stays in calc_sync_runs and calc_catalog_sync_runs.
--
--                         admin          sales                 production
-- calc_raw_materials      read, edit     read, add (function)  —
-- calc_catalog_products   read, add,     read                  —
--                         edit
-- =====================================================================

-- ------------------------------------------------------ raw materials
grant update (name, price_eur_per_kg, active, regulatory_note) on public.calc_raw_materials to authenticated;
-- (the update policy calc_raw_materials_update already allows Admin only)

alter table public.calc_raw_materials
  add constraint calc_raw_materials_name_filled check (btrim(name) <> '');

comment on column public.calc_raw_materials.manual is
  'Added from the formula search in the calculator (before Nov 2026: not in the Google Sheet). No effect since the sync stopped.';

-- --------------------------------------------------- catalog products
create policy calc_catalog_products_insert on public.calc_catalog_products for insert to authenticated
  with check (public.has_role('admin'));
create policy calc_catalog_products_update on public.calc_catalog_products for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
grant insert (code, name, category, tiers, sort_order, active, capsules_per_serving, capsules_per_container,
              serving_g, servings_per_container, composition)
   on public.calc_catalog_products to authenticated;
grant update (code, name, category, tiers, sort_order, active, capsules_per_serving, capsules_per_container,
              serving_g, servings_per_container, composition)
   on public.calc_catalog_products to authenticated;

alter table public.calc_catalog_products
  add constraint calc_catalog_products_filled check (btrim(code) <> '' and btrim(name) <> '');

-- ------------------------------------------------------- sync removed
drop function if exists public.calc_record_sync(text, jsonb, jsonb, text);
drop function if exists public.calc_record_scheduled_sync(jsonb, jsonb, text);
drop function if exists public.calc_apply_sync(text, jsonb, jsonb, text, uuid);
drop function if exists public.calc_record_catalog_sync(text, jsonb, jsonb, text);
drop function if exists public.calc_record_scheduled_catalog_sync(jsonb, jsonb, text);
drop function if exists public.calc_apply_catalog_sync(text, jsonb, jsonb, text, uuid);
