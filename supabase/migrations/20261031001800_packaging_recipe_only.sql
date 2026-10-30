-- =====================================================================
-- Nutrikal ERP + CRM — the basic packaging items are shown in recipes only
-- Owner, 30 Oct 2026: the capsule 00, jars and lids added by
-- 20261031001700 are shown in the recipe, but for now they are not
-- purchased, reserved or costed: no supplier or price is needed for them.
-- items.in_planning = false keeps an item out of the materials a recipe
-- or a manufacturing order needs (so out of availability, reservations,
-- purchase requests, consumption and batch costs). Set it back to true
-- when they are to be planned.
-- =====================================================================

alter table public.items add column in_planning boolean not null default true;
comment on column public.items.in_planning is
  'false: shown in recipes, but not needed by recipes or manufacturing orders (not purchased, reserved or costed)';

update public.items set in_planning = false
 where sku in ('PK-CAPS-00', 'PK-JAR-PL', 'PK-LID-PL', 'PK-JAR-GL', 'PK-LID-AL');

create or replace function public.mo_required_materials(p_mo uuid)
returns table (item_id uuid, kind text, required numeric)
language sql stable security definer set search_path = public
as $$
  with m as (
    select mo.id, mo.quantity, mo.formula_version_id, f.serving_size, f.serving_unit, f.servings_per_pack,
           f.shell_item_id, coalesce(fc.loss_pct, 0) as loss_pct
      from public.manufacturing_orders mo
      join public.formula_versions v on v.id = mo.formula_version_id
      join public.formulas f on f.id = v.formula_id
      left join public.format_costing fc on fc.product_format = f.product_format
     where mo.id = p_mo
  ),
  lines as (
    select i.id as item_id, 'ingredient'::text as kind,
           l.amount_mg * (1 + l.overage_pct / 100) * m.servings_per_pack * (1 + m.loss_pct / 100) * m.quantity
             / case i.base_unit when 'kg' then 1000000 when 'g' then 1000 end as required
      from m join public.formula_lines l on l.version_id = m.formula_version_id
      join public.items i on i.id = l.item_id
    union all
    select m.shell_item_id, 'shell', m.serving_size * m.servings_per_pack * (1 + m.loss_pct / 100) * m.quantity
      from m where m.serving_unit = 'pcs' and m.shell_item_id is not null
    union all
    select p.item_id, 'packaging', p.qty_per_pack * m.quantity
      from m join public.mo_packaging p on p.mo_id = m.id
  )
  select l.item_id, min(l.kind), round(sum(l.required), 4)
    from lines l join public.items i on i.id = l.item_id
   where l.required is not null and i.in_planning
   group by l.item_id
$$;

create or replace function public.version_required_materials(p_version uuid, p_qty numeric)
returns table (item_id uuid, kind text, required numeric)
language sql stable security definer set search_path = public
as $$
  with m as (
    select v.id, f.serving_size, f.serving_unit, f.servings_per_pack, f.shell_item_id, coalesce(fc.loss_pct, 0) as loss_pct
      from public.formula_versions v
      join public.formulas f on f.id = v.formula_id
      left join public.format_costing fc on fc.product_format = f.product_format
     where v.id = p_version
  ),
  lines as (
    select i.id as item_id, 'ingredient'::text as kind,
           l.amount_mg * (1 + l.overage_pct / 100) * m.servings_per_pack * (1 + m.loss_pct / 100) * p_qty
             / case i.base_unit when 'kg' then 1000000 when 'g' then 1000 end as required
      from m join public.formula_lines l on l.version_id = m.id
      join public.items i on i.id = l.item_id
    union all
    select m.shell_item_id, 'shell', m.serving_size * m.servings_per_pack * (1 + m.loss_pct / 100) * p_qty
      from m where m.serving_unit = 'pcs' and m.shell_item_id is not null
    union all
    select p.item_id, 'packaging', p.qty_per_pack * p_qty
      from m join public.formula_packaging p on p.version_id = m.id
  )
  select l.item_id, min(l.kind), round(sum(l.required), 4)
    from lines l join public.items i on i.id = l.item_id
   where l.required is not null and i.in_planning
   group by l.item_id
$$;
revoke execute on function public.version_required_materials(uuid, numeric) from public, anon, authenticated;
