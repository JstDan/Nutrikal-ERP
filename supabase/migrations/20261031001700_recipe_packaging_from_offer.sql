-- =====================================================================
-- Nutrikal ERP + CRM — capsule shell, jar and lid of a recipe from its offer
-- Owner, 30 Oct 2026: a recipe made from a calculator offer gets the
-- capsule (size 00, the only one the machines fill), the jar and the lid
-- chosen on the offer. Five basic packaging items are added for this
-- (SKU, supplier and price are filled in under Items later):
--   PK-CAPS-00  capsule size 00
--   PK-JAR-PL   plastic jar        PK-LID-PL  plastic lid
--   PK-JAR-GL   glass jar          PK-LID-AL  aluminium lid
-- What the offer says:
--   custom formula   jar = the product type (capsules in glass / plastic);
--                    lid = the lid chosen (a glass jar at catalog prices
--                    comes with its aluminium lid)
--   catalog product  jar and lid chosen (a glass jar: aluminium lid)
--   powder           no capsule, jar or lid
-- The existing draft recipes from offers get what is missing (also those
-- whose offer was deleted: its data is read from the audit log).
--
-- Production: no access to recipes (unchanged); items as before.
-- =====================================================================

insert into public.items (sku, type, name, name_bg, base_unit, capacity_unit, material)
values ('PK-CAPS-00', 'packaging', 'Capsule size 00', 'Капсула размер 00', 'pcs', null, null),
       ('PK-JAR-PL',  'packaging', 'Plastic jar',     'Пластмасово бурканче', 'pcs', null, 'plastic'),
       ('PK-LID-PL',  'packaging', 'Plastic lid',     'Пластмасова капачка', 'pcs', null, 'plastic'),
       ('PK-JAR-GL',  'packaging', 'Glass jar',       'Стъклено бурканче', 'pcs', null, 'glass'),
       ('PK-LID-AL',  'packaging', 'Aluminium lid',   'Алуминиева капачка', 'pcs', null, 'aluminium')
on conflict (sku) do nothing;

/** The capsule shell, jar and lid (packaging items) chosen on a calculator offer; null where none. */
create or replace function public.calc_offer_packaging(p_data jsonb, p_product_type text, out shell uuid, out jar uuid, out lid uuid)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_pt   text := coalesce(nullif(p_product_type, ''), p_data ->> 'productType', '');
  v_jar  text;
  v_lid  text;
begin
  if v_pt not like 'capsules%' then
    return;
  end if;
  v_jar := case when p_data ->> 'mode' = 'catalog' then coalesce(p_data ->> 'jar', 'plastic')
                when v_pt = 'capsules_glass' then 'glass' else 'plastic' end;
  v_lid := case when v_jar = 'glass' and (p_data ->> 'mode' = 'catalog' or coalesce((p_data ->> 'catalogPackaging')::boolean, false))
                  then 'aluminium'
                else coalesce(p_data ->> 'lid', 'plastic') end;
  select id into shell from public.items where sku = 'PK-CAPS-00';
  select id into jar from public.items where sku = case v_jar when 'glass' then 'PK-JAR-GL' else 'PK-JAR-PL' end;
  select id into lid from public.items where sku = case v_lid when 'aluminium' then 'PK-LID-AL' else 'PK-LID-PL' end;
end
$$;
revoke execute on function public.calc_offer_packaging(jsonb, text) from public, anon, authenticated;

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
  pk        record;
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

  -- Capsule shell, jar and lid from the offer
  select * into pk from public.calc_offer_packaging(o.data, v_pt);
  update public.formulas set shell_item_id = case when v_format = 'capsule' then pk.shell end where id = f.id;
  delete from public.formula_packaging where version_id = v_version;
  insert into public.formula_packaging (version_id, item_id)
  select v_version, x from unnest(array[pk.jar, pk.lid]) x where x is not null;
  perform set_config('nk.recipe_sync', '', true);
  return f.id;
end
$$;

-- Draft recipes from offers: fill the capsule, jar and lid where missing, and the 5 % overage where
-- 0 and not edited by hand (not counted as a hand edit). A recipe whose offer was deleted reads the
-- offer from the audit log.
do $$
declare
  r  record;
  pk record;
begin
  perform set_config('nk.recipe_sync', 'on', true);
  for r in
    select f.id, f.product_format, f.shell_item_id, f.offer_edited, v.id as version_id, src.data, src.product_type
      from public.formulas f
      join public.formula_versions v on v.formula_id = f.id and v.status = 'draft'
      cross join lateral (
        select o.data, o.product_type from public.calc_offers o where o.id = f.calc_offer_id
        union all
        select d.old_data -> 'data', d.old_data ->> 'product_type'
          from public.audit_log u
          join public.audit_log d on d.table_name = 'calc_offers' and d.action = 'DELETE' and d.row_id = u.old_data ->> 'calc_offer_id'
         where f.calc_offer_id is null and u.table_name = 'formulas' and u.row_id = f.id::text and u.action = 'UPDATE'
           and u.old_data ->> 'calc_offer_id' is not null and u.new_data ->> 'calc_offer_id' is null
        limit 1
      ) src
  loop
    select * into pk from public.calc_offer_packaging(r.data, r.product_type);
    if r.product_format = 'capsule' and r.shell_item_id is null and pk.shell is not null then
      update public.formulas set shell_item_id = pk.shell where id = r.id;
    end if;
    if not exists (select 1 from public.formula_packaging where version_id = r.version_id) then
      insert into public.formula_packaging (version_id, item_id)
      select r.version_id, x from unnest(array[pk.jar, pk.lid]) x where x is not null;
    end if;
    if not r.offer_edited then
      update public.formula_lines set overage_pct = public.recipe_default_overage() where version_id = r.version_id and overage_pct = 0;
    end if;
  end loop;
  perform set_config('nk.recipe_sync', '', true);
end
$$;
