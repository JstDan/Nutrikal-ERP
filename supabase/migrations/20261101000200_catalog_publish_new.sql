-- =====================================================================
-- The owner published all 46 new formulations (1 Nov 2026), knowing the
-- open reviews. They have no prices yet: "price on request". The review
-- status they had stays in the internal notes.
-- =====================================================================

alter table public.catalog_products add column price_on_request boolean not null default false;
alter table public.catalog_enquiry_lines alter column unit_price drop not null;

create or replace function public.catalog_publish_problem(p_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when p.review_status = 'evidence_gap' then 'no_formula'
    when p.review_status is not null then 'in_review'
    when p.formula_id is not null and not f.is_active then 'inactive_recipe'
    when p.formula_id is not null and not exists (select 1 from formula_versions v where v.formula_id = f.id and v.status = 'approved') then 'not_approved'
    when not p.price_on_request and not exists (select 1 from catalog_price_tiers t where t.product_id = p.id and t.min_qty = p.min_qty) then 'no_minimum_tier'
  end
  from catalog_products p left join formulas f on f.id = p.formula_id
  where p.id = p_id
$$;

create or replace function public.catalog_public()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'name_bg', c.name_bg) order by c.sort_order, c.name)
        from catalog_categories c
       where exists (select 1 from catalog_products p
                      where (p.category_id = c.id or exists (select 1 from catalog_product_categories x where x.product_id = p.id and x.category_id = c.id))
                        and p.is_published and catalog_publish_problem(p.id) is null)), '[]'),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', p.code, 'name', p.name, 'name_bg', p.name_bg,
               'description', p.description, 'description_bg', p.description_bg,
               'category_id', p.category_id,
               'extra_category_ids', (select coalesce(jsonb_agg(x.category_id), '[]') from catalog_product_categories x where x.product_id = p.id),
               'format', coalesce(f.product_format, p.product_format), 'min_qty', p.min_qty, 'image', p.image,
               'pack', p.pack, 'pack_bg', p.pack_bg,
               'serving_size', f.serving_size, 'serving_unit', f.serving_unit, 'servings_per_pack', f.servings_per_pack,
               'tiers', (select coalesce(jsonb_agg(jsonb_build_object('min_qty', t.min_qty, 'unit_price', t.unit_price) order by t.min_qty), '[]')
                           from catalog_price_tiers t where t.product_id = p.id),
               'price_on_request', p.price_on_request,
               'ingredients', case when p.formula_id is null then
                                (select coalesce(jsonb_agg(jsonb_build_object('name', x ->> 'name', 'name_bg', null, 'amount', x ->> 'amount', 'unit', null)), '[]')
                                   from jsonb_array_elements(p.ingredients) x)
                              else
                                (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'name_bg', i.name_bg, 'amount', l.amount, 'unit', l.unit)
                                                           order by l.sort_order, l.amount_mg desc), '[]')
                                   from formula_lines l join items i on i.id = l.item_id where l.version_id = v.id)
                              end,
               'claims', (select coalesce(jsonb_agg(jsonb_build_object('en', h.claim_en, 'bg', h.claim_bg)), '[]')
                            from formula_version_claims c join health_claims h on h.id = c.claim_id
                           where c.version_id = v.id and h.is_active)
             ) order by p.sort_order, p.name)
        from catalog_products p
        left join formulas f on f.id = p.formula_id
        left join formula_versions v on v.formula_id = f.id and v.status = 'approved'
       where p.is_published and catalog_publish_problem(p.id) is null), '[]'))
$$;

update public.catalog_products
   set internal_notes = concat_ws(E'\n', 'Review status when published by the owner on 2026-11-01: ' || review_status, internal_notes),
       review_status = null,
       price_on_request = true,
       image = '/catalog/' || code || '.webp'
 where code like 'NEW-%';

update public.catalog_products set is_published = true where code like 'NEW-%';
