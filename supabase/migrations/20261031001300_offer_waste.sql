-- =====================================================================
-- Nutrikal ERP + CRM — the waste of a recipe comes from its offer
-- The calculator no longer adds 5 % waste (owner, 29 Oct 2026): the extra
-- raw material is filled into extra units, which the client pays on the
-- final proforma (20261031001400). New offers save data.waste = '' (no
-- waste), and the recipe made from them has 0 % overage. Offers saved
-- before keep their 5 %, so their prices and recipes do not change.
-- =====================================================================

-- The waste % typed on an offer (data of calc_offers): 5 for offers from before the field, 0 when empty
create or replace function public.calc_offer_waste(p_data jsonb)
returns numeric
language sql immutable
as $$
  select case when not (coalesce(p_data, '{}'::jsonb) ? 'waste') then 5
              else least(greatest(coalesce(public.calc_num(p_data ->> 'waste'), 0), 0), 100) end
$$;

/**
 * Creates the recipe of a calculator offer, or rebuilds it while it is untouched (only version 1,
 * still a draft, not edited by hand). Internal: called by the calc_offers triggers.
 */
create or replace function public.calc_offer_recipe_sync(p_offer uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  o         public.calc_offers;
  f         public.formulas;
  v_version uuid;
  v_rows    jsonb;
  v_pt      text;
  v_format  public.product_format;
  v_sunit   public.serving_unit;
  v_size    numeric;
  v_per     integer;
  v_caps    numeric;
  v_qty     numeric;
  v_dose_g  numeric := 0;
  r         jsonb;
  v_amount  numeric;
  v_unit    public.dose_unit;
  v_mat     uuid;
  v_item    uuid;
  v_n       integer := 0;
  v_code    text;
  v_waste   numeric;
  num       constant text := '^\s*[0-9]+([.,][0-9]+)?\s*$';
begin
  select * into o from public.calc_offers where id = p_offer;
  if not found then
    return null;
  end if;
  select * into f from public.formulas where calc_offer_id = p_offer;
  if found then
    if f.offer_edited
       or (select count(*) from public.formula_versions where formula_id = f.id) <> 1
       or not exists (select 1 from public.formula_versions where formula_id = f.id and version = 1 and status = 'draft') then
      if f.client_id is null and o.client_id is not null then
        update public.formulas set client_id = o.client_id where id = f.id;
      end if;
      return f.id;
    end if;
  end if;

  -- Ingredients: the custom rows, else the composition of a catalog product
  v_rows := case when jsonb_typeof(o.data -> 'rows') = 'array' and jsonb_array_length(o.data -> 'rows') > 0 then o.data -> 'rows'
                 when jsonb_typeof(o.data #> '{catalog,composition}') = 'array' then o.data #> '{catalog,composition}'
                 else '[]'::jsonb end;
  for r in select * from jsonb_array_elements(v_rows) loop
    if coalesce(r ->> 'amount', '') ~ num then
      v_dose_g := v_dose_g + replace(btrim(r ->> 'amount'), ',', '.')::numeric
                  * case r ->> 'unit' when 'g' then 1 when 'mcg' then 0.000001 else 0.001 end;
    end if;
  end loop;

  v_pt := coalesce(o.product_type, o.data ->> 'productType', '');
  v_caps := case when coalesce(o.data ->> 'capsulesPerDose', '') ~ num then replace(o.data ->> 'capsulesPerDose', ',', '.')::numeric
                 when coalesce(o.data #>> '{catalog,capsules_per_serving}', '') ~ num then (o.data #>> '{catalog,capsules_per_serving}')::numeric end;
  v_qty := case when coalesce(o.data ->> 'quantityPerUnit', '') ~ num then replace(o.data ->> 'quantityPerUnit', ',', '.')::numeric end;
  if v_pt = 'powder' then
    v_format := 'powder';
    v_sunit := 'g';
    v_size := case when v_dose_g > 0 then round(v_dose_g, 3)
                   when coalesce(o.data #>> '{catalog,serving_g}', '') ~ num then (o.data #>> '{catalog,serving_g}')::numeric
                   else 1 end;
    v_per := coalesce(floor(v_qty)::int,
                      case when coalesce(o.data #>> '{catalog,servings_per_container}', '') ~ num
                           then floor((o.data #>> '{catalog,servings_per_container}')::numeric)::int end);
  else
    v_format := 'capsule';
    v_sunit := 'pcs';
    v_size := coalesce(nullif(v_caps, 0), 1);
    v_per := coalesce(case when v_qty > 0 then floor(v_qty / v_size)::int end,
                      case when coalesce(o.data #>> '{catalog,servings_per_container}', '') ~ num
                           then floor((o.data #>> '{catalog,servings_per_container}')::numeric)::int end);
  end if;
  if v_per is not null and v_per <= 0 then
    v_per := null;
  end if;

  v_waste := public.calc_offer_waste(o.data);

  perform set_config('nk.recipe_sync', 'on', true);
  if f.id is null then
    -- The code is drawn here: the offer trigger may run without a signed-in user (this migration)
    update public.number_series set next_number = next_number + 1 where key = 'formula'
    returning prefix || lpad((next_number - 1)::text, pad_length, '0') into v_code;
    insert into public.formulas (code, name, product_format, client_id, serving_size, serving_unit, servings_per_pack, calc_offer_id, created_by)
    values (v_code, coalesce(nullif(btrim(o.product_name), ''), o.offer_no), v_format, o.client_id, v_size, v_sunit, v_per, o.id, o.created_by)
    returning * into f;
  else
    update public.formulas
       set name = coalesce(nullif(btrim(o.product_name), ''), o.offer_no), product_format = v_format,
           client_id = coalesce(o.client_id, client_id), serving_size = v_size, serving_unit = v_sunit, servings_per_pack = v_per
     where id = f.id;
  end if;
  select id into v_version from public.formula_versions where formula_id = f.id and version = 1;
  delete from public.formula_lines where version_id = v_version;
  delete from public.formula_pending_lines where version_id = v_version;

  for r in select * from jsonb_array_elements(v_rows) loop
    continue when coalesce(r ->> 'amount', '') !~ num or coalesce(btrim(r ->> 'name'), '') = '';
    v_amount := replace(btrim(r ->> 'amount'), ',', '.')::numeric;
    continue when v_amount <= 0;
    v_unit := case when r ->> 'unit' in ('mg', 'mcg', 'g') then (r ->> 'unit')::public.dose_unit else 'mg' end;
    v_mat := case when coalesce(r ->> 'materialId', '') ~* '^[0-9a-f-]{36}$'
                   and exists (select 1 from public.calc_raw_materials where id = (r ->> 'materialId')::uuid)
                  then (r ->> 'materialId')::uuid end;
    v_item := public.recipe_item_for(v_mat, r ->> 'name');
    v_n := v_n + 1;
    if v_item is not null then
      insert into public.formula_lines (version_id, item_id, amount, unit, overage_pct, sort_order)
      values (v_version, v_item, v_amount, v_unit, v_waste, v_n);
    else
      insert into public.formula_pending_lines (version_id, name, material_id, amount, unit, sort_order)
      values (v_version, btrim(r ->> 'name'), v_mat, v_amount, v_unit, v_n);
    end if;
  end loop;
  perform set_config('nk.recipe_sync', '', true);
  return f.id;
end
$$;

/**
 * Links an ingredient waiting for a stock item: it becomes a recipe line; with p_remember the
 * price-list material keeps the link for the next offers.
 */
create or replace function public.link_recipe_pending_line(p_pending uuid, p_item uuid, p_remember boolean default true)
returns uuid
language plpgsql set search_path = public
as $$
declare
  p      public.formula_pending_lines;
  v_waste numeric;
  v_line uuid;
begin
  perform public.require_role('admin', 'sales');
  select * into p from public.formula_pending_lines where id = p_pending;
  if not found then
    raise exception 'Ingredient not found';
  end if;
  if not exists (select 1 from public.items where id = p_item and type in ('raw_material', 'excipient', 'semi_finished')) then
    raise exception 'Choose a raw material, excipient or semi-finished item';
  end if;
  -- the waste typed on the offer of the recipe
  select public.calc_offer_waste(o.data) into v_waste
    from public.formula_versions v join public.formulas f on f.id = v.formula_id
    join public.calc_offers o on o.id = f.calc_offer_id
   where v.id = p.version_id;
  insert into public.formula_lines (version_id, item_id, amount, unit, overage_pct, sort_order)
  values (p.version_id, p_item, p.amount, p.unit, coalesce(v_waste, 0), p.sort_order) returning id into v_line;
  delete from public.formula_pending_lines where id = p.id;
  if p_remember and p.material_id is not null then
    insert into public.calc_material_items (material_id, item_id) values (p.material_id, p_item)
    on conflict (material_id) do update set item_id = excluded.item_id, updated_by = auth.uid(), updated_at = now();
  end if;
  return v_line;
end
$$;
