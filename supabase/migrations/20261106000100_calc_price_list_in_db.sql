-- =====================================================================
-- Nutrikal ERP + CRM — the calculator's price list lives in the database
-- The Google Sheet sync is stopped completely (owner, Nov 2026): raw
-- materials and catalog products are kept and edited in the app only.
-- Raw materials (Offers > Raw materials): Admin and Sales add one
-- (calc_add_raw_material), change its name and price per kg
-- (calc_update_raw_material) and set it active or inactive
-- (calc_set_raw_material_active). Nothing is deleted any more: an inactive
-- material is hidden from the calculator; saved offers keep their data.
-- The regulatory note stays Admin only (calc_raw_materials_update policy).
-- Catalog products: Admin adds and edits every field; Sales reads them.
-- The sync functions are removed; the history of earlier runs stays in
-- calc_sync_runs and calc_catalog_sync_runs.
--
--                         admin               sales                 production
-- calc_raw_materials      read, add, edit,    read, add, edit,      —
--                         status, note        status (functions)
-- calc_catalog_products   read, add, edit     read                  —
-- =====================================================================

-- ------------------------------------------------------ raw materials
alter table public.calc_raw_materials
  add constraint calc_raw_materials_name_filled check (btrim(name) <> '');

comment on column public.calc_raw_materials.manual is
  'Added from the formula search in the calculator (before Nov 2026: not in the Google Sheet). No effect since the sync stopped.';

-- Admin, sales: set a raw material active or inactive (instead of deleting it)
create or replace function public.calc_set_raw_material_active(p_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  update public.calc_raw_materials set active = coalesce(p_active, true) where id = p_id;
  if not found then
    raise exception 'Raw material not found';
  end if;
end
$$;
revoke execute on function public.calc_set_raw_material_active(uuid, boolean) from public, anon;
grant execute on function public.calc_set_raw_material_active(uuid, boolean) to authenticated;

-- Raw materials are no longer deleted (owner, Nov 2026)
drop function if exists public.calc_delete_raw_material(uuid);

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
