-- The designer gets wider access (owner, Nov 2026). Besides clients, projects, orders without prices, client files,
-- label approvals, the chat and boards, the designer now:
--   - reads recipes and their composition (for label texts), changes none;
--   - reads offers and the prices of orders;
--   - edits the look of catalogue products: picture, names, descriptions, site names, category and pack text.
--     Not prices, minimum order, composition, review, internal notes, publishing or the recipe link.
-- Nothing here reaches Production or clients (has_role('designer') is false for them).

-- Reading: one policy per table, for the designer only
do $$
declare
  t text;
begin
  foreach t in array array[
    'formulas', 'formula_versions', 'formula_lines', 'formula_packaging', 'formula_pending_lines',
    'items', 'nutrients', 'health_claims', 'formula_version_claims', 'formula_version_nutrients',
    'calc_offers', 'sales_orders', 'sales_order_lines',
    'catalog_products', 'catalog_price_tiers', 'catalog_categories', 'catalog_product_categories'
  ] loop
    if to_regclass('public.' || t) is not null
       and (select relkind from pg_class where oid = ('public.' || t)::regclass) = 'r' then
      execute format('create policy %I on public.%I for select to authenticated using (public.has_role(''designer''))', t || '_designer_read', t);
    end if;
  end loop;
end $$;

-- The catalogue's look: the designer may update a product, but only these columns
create policy catalog_products_designer_update on public.catalog_products for update to authenticated
  using (public.has_role('designer')) with check (public.has_role('designer'));

create or replace function public.catalog_products_designer_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  look constant text[] := array['name', 'name_bg', 'description', 'description_bg', 'names', 'category_id', 'pack', 'pack_bg', 'image', 'updated_at'];
begin
  if public.current_app_role() = 'designer'
     and (to_jsonb(new) - look) is distinct from (to_jsonb(old) - look) then
    raise exception 'The designer changes only the picture, names, descriptions, category and pack text' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger catalog_products_designer_guard before update on public.catalog_products
  for each row execute function public.catalog_products_designer_guard();

-- The categories a product sits in
create policy catalog_product_categories_designer_write on public.catalog_product_categories for all to authenticated
  using (public.has_role('designer')) with check (public.has_role('designer'));
