-- =====================================================================
-- AI formulator, first step (owner, Oct 2026): the assistant proposes a
-- recipe from stock items. The figures come from the database, never from
-- the model. A person saves the proposal as a draft; approval stays as it is.
-- This is no regulatory check.
-- =====================================================================

create table public.ai_recipe_proposals (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.ai_conversations (id) on delete cascade,
  recipe           jsonb not null,
  estimate         jsonb not null,
  formula_id       uuid references public.formulas (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index ai_recipe_proposals_conversation_idx on public.ai_recipe_proposals (conversation_id, created_at);

-- Only the author of the conversation. Production has no access.
alter table public.ai_recipe_proposals enable row level security;
create policy ai_recipe_proposals_select on public.ai_recipe_proposals for select to authenticated
  using (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid())
         and public.has_role('admin', 'sales'));

/**
 * Amounts, cost per pack, capsule fill and stock of a recipe.
 * p_recipe: {product_format, serving_size, serving_unit, servings_per_pack, shell_sku, lines: [{sku, amount, unit}]}.
 * Prices only for those allowed to see purchase prices.
 */
create or replace function public.recipe_estimate(p_recipe jsonb, p_max_fill_mg numeric)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_size     numeric := (p_recipe ->> 'serving_size')::numeric;
  v_unit     text := coalesce(p_recipe ->> 'serving_unit', 'pcs');
  v_servings numeric := (p_recipe ->> 'servings_per_pack')::numeric;
  v_prices   boolean := public.can_see_purchase_prices();
  v_lines    jsonb;
  v_unknown  text[];
  v_mg       numeric;
  v_cost     numeric;
  v_missing  integer;
  v_shell    public.items;
  v_shell_cost numeric;
begin
  perform public.require_role('admin', 'sales');
  if coalesce(v_size, 0) <= 0 or coalesce(v_servings, 0) <= 0 then
    raise exception 'Enter the serving size and the servings per pack';
  end if;

  with input as (
    select x.sku, x.amount, coalesce(x.unit, 'mg') as unit, x.n
      from rows from (jsonb_to_recordset(coalesce(p_recipe -> 'lines', '[]'::jsonb)) as (sku text, amount numeric, unit text))
           with ordinality as x(sku, amount, unit, n)
  ), resolved as (
    select v.*, i.id as item_id, i.name, i.name_bg, i.base_unit, i.novel_food_status::text as novel_food,
           v.amount * case v.unit when 'mcg' then 0.001 when 'g' then 1000 else 1 end as mg
      from input v
      left join public.items i on lower(i.sku) = lower(v.sku) and i.is_active
           and i.type in ('raw_material', 'excipient') and i.base_unit in ('kg', 'g')
  ), priced as (
    select r.*, r.mg * v_servings / case r.base_unit when 'kg' then 1000000 else 1000 end as qty_per_pack,
           case when v_prices then coalesce(public.item_unit_price(r.item_id, 0),
             (select m.price_eur_per_kg / case r.base_unit when 'kg' then 1 else 1000 end
                from public.calc_material_items c join public.calc_raw_materials m on m.id = c.material_id
               where c.item_id = r.item_id limit 1)) end as price,
           (select s.available from public.item_stock_summary s where s.item_id = r.item_id) as available
      from resolved r
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', p.sku, 'name', p.name, 'name_bg', p.name_bg, 'amount', p.amount, 'unit', p.unit, 'base_unit', p.base_unit,
           'qty_per_pack', round(p.qty_per_pack, 6), 'cost_per_pack', round(p.qty_per_pack * p.price, 4),
           'available', p.available, 'novel_food', p.novel_food) order by p.n) filter (where p.item_id is not null), '[]'::jsonb),
         array_agg(p.sku) filter (where p.item_id is null),
         coalesce(sum(p.mg), 0),
         sum(p.qty_per_pack * p.price),
         count(*) filter (where p.item_id is not null and p.price is null)
    into v_lines, v_unknown, v_mg, v_cost, v_missing
    from priced p;

  if p_recipe ->> 'shell_sku' is not null then
    select * into v_shell from public.items where lower(sku) = lower(p_recipe ->> 'shell_sku') and is_active;
    if found and v_prices then
      v_shell_cost := public.item_unit_price(v_shell.id, 0) * v_size * v_servings;
    end if;
    if not found then
      v_unknown := coalesce(v_unknown, '{}') || (p_recipe ->> 'shell_sku');
    end if;
  end if;

  return jsonb_build_object(
    'lines', v_lines,
    'unknown', to_jsonb(coalesce(v_unknown, '{}')),
    'mg_per_serving', round(v_mg, 3),
    'mg_per_capsule', case when v_unit = 'pcs' then round(v_mg / v_size, 3) end,
    'max_fill_mg', case when v_unit = 'pcs' then p_max_fill_mg end,
    'fits', case when v_unit = 'pcs' then v_mg / v_size <= p_max_fill_mg end,
    'materials_cost_per_pack', round(v_cost, 4),
    'shell_cost_per_pack', round(v_shell_cost, 4),
    'prices_hidden', not v_prices,
    'lines_without_price', v_missing);
end
$$;

/** Materials a recipe can use, with stock; prices only for those allowed to see purchase prices. */
create or replace function public.recipe_materials(p_term text)
returns table (sku text, name text, name_bg text, type public.item_type, base_unit public.base_unit, novel_food_status public.novel_food_status,
               regulatory_notes text, available numeric, price_per_base_unit numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  return query
    select i.sku, i.name, i.name_bg, i.type, i.base_unit, i.novel_food_status, i.regulatory_notes, s.available,
           case when public.can_see_purchase_prices() then coalesce(public.item_unit_price(i.id, 0),
             (select m.price_eur_per_kg / case i.base_unit when 'kg' then 1 when 'g' then 1000 end
                from public.calc_material_items c join public.calc_raw_materials m on m.id = c.material_id
               where c.item_id = i.id limit 1)) end
      from public.items i left join public.item_stock_summary s on s.item_id = i.id
     where i.is_active and i.type in ('raw_material', 'excipient', 'packaging')
       and (coalesce(p_term, '') = '' or i.name ilike '%' || p_term || '%' or i.name_bg ilike '%' || p_term || '%' or i.sku ilike '%' || p_term || '%')
     order by i.name limit 40;
end
$$;

/** The model's proposal, with the figures of the database. Saved only when every item exists. */
create or replace function public.add_recipe_proposal(p_conversation uuid, p_recipe jsonb, p_max_fill_mg numeric)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_estimate jsonb;
  v_id       uuid;
begin
  perform public.require_role('admin', 'sales');
  if not exists (select 1 from public.ai_conversations where id = p_conversation and user_id = auth.uid()) then
    raise exception 'Conversation not found';
  end if;
  if nullif(btrim(coalesce(p_recipe ->> 'name', '')), '') is null then
    raise exception 'Enter the name of the recipe';
  end if;
  perform (p_recipe ->> 'product_format')::public.product_format;
  v_estimate := public.recipe_estimate(p_recipe, p_max_fill_mg);
  if jsonb_array_length(v_estimate -> 'lines') = 0 or jsonb_array_length(v_estimate -> 'unknown') > 0 then
    return v_estimate;
  end if;
  insert into public.ai_recipe_proposals (conversation_id, recipe, estimate)
  values (p_conversation, p_recipe, v_estimate) returning id into v_id;
  return v_estimate || jsonb_build_object('saved_for_review', true, 'proposal_id', v_id);
end
$$;

/** A person saves the proposal: a new recipe with a draft version, to review and approve as usual. */
create or replace function public.recipe_from_proposal(p_proposal uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  p       public.ai_recipe_proposals;
  r       jsonb;
  v_id    uuid;
  v_ver   uuid;
  v_shell uuid;
begin
  perform public.require_role('admin', 'sales');
  select * into p from public.ai_recipe_proposals where id = p_proposal for update;
  if not found or not exists (select 1 from public.ai_conversations c where c.id = p.conversation_id and c.user_id = auth.uid()) then
    raise exception 'Proposal not found';
  end if;
  if p.formula_id is not null then
    return p.formula_id;
  end if;
  r := p.recipe;
  select id into v_shell from public.items where lower(sku) = lower(r ->> 'shell_sku') and is_active;
  insert into public.formulas (name, name_bg, product_format, serving_size, serving_unit, servings_per_pack, shell_item_id, description)
  values (btrim(r ->> 'name'), nullif(btrim(coalesce(r ->> 'name_bg', '')), ''), (r ->> 'product_format')::public.product_format,
          (r ->> 'serving_size')::numeric, coalesce(r ->> 'serving_unit', 'pcs')::public.serving_unit, (r ->> 'servings_per_pack')::integer,
          v_shell, nullif(btrim(coalesce(r ->> 'description', '')), ''))
  returning id into v_id;
  select id into v_ver from public.formula_versions where formula_id = v_id order by version desc limit 1;
  insert into public.formula_lines (version_id, item_id, amount, unit, sort_order)
  select v_ver, i.id, x.amount, coalesce(x.unit, 'mg')::public.dose_unit, x.n
    from rows from (jsonb_to_recordset(r -> 'lines') as (sku text, amount numeric, unit text)) with ordinality as x(sku, amount, unit, n)
    join public.items i on lower(i.sku) = lower(x.sku) and i.is_active;
  update public.ai_recipe_proposals set formula_id = v_id where id = p.id;
  return v_id;
end
$$;

revoke execute on function public.recipe_estimate(jsonb, numeric) from public, anon;
revoke execute on function public.recipe_materials(text) from public, anon;
revoke execute on function public.add_recipe_proposal(uuid, jsonb, numeric) from public, anon;
revoke execute on function public.recipe_from_proposal(uuid) from public, anon;
grant execute on function public.recipe_estimate(jsonb, numeric) to authenticated;
grant execute on function public.recipe_materials(text) to authenticated;
grant execute on function public.add_recipe_proposal(uuid, jsonb, numeric) to authenticated;
grant execute on function public.recipe_from_proposal(uuid) to authenticated;
