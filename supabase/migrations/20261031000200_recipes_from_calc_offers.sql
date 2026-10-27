-- Recipes from calculator offers (owner, 27 Oct 2026): every calculator offer gets a recipe
-- (a formula with a draft version 1) with its ingredients and amounts per serving. An ingredient
-- is a stock item: a price-list material is matched through calc_material_items (remembered once
-- chosen) or by the same name; what cannot be matched waits in formula_pending_lines until someone
-- picks the stock item. While the recipe is untouched, saving the offer again rebuilds it; once it
-- is edited by hand it is left alone.
--
-- Production: no access (formulas are staff only; the two new tables are admin/sales/inventory).

alter table public.formulas
  add column calc_offer_id uuid unique references public.calc_offers (id) on delete set null,
  add column offer_edited  boolean not null default false;

-- Price-list material -> stock item, remembered for the next offers
create table public.calc_material_items (
  material_id uuid primary key references public.calc_raw_materials (id) on delete cascade,
  item_id     uuid not null references public.items (id) on delete cascade,
  updated_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table public.calc_material_items enable row level security;
create policy calc_material_items_select on public.calc_material_items for select to authenticated
  using (public.is_staff());
create policy calc_material_items_write on public.calc_material_items for all to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));
select public.enable_audit('public.calc_material_items');

-- Ingredients of an offer that have no stock item yet
create table public.formula_pending_lines (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.formula_versions (id) on delete cascade,
  name        text not null,
  material_id uuid references public.calc_raw_materials (id) on delete set null,
  amount      numeric(14, 4) not null check (amount > 0),
  unit        public.dose_unit not null default 'mg',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create index formula_pending_lines_version_idx on public.formula_pending_lines (version_id);
alter table public.formula_pending_lines enable row level security;
create policy formula_pending_lines_select on public.formula_pending_lines for select to authenticated
  using (public.is_staff());
create policy formula_pending_lines_write on public.formula_pending_lines for all to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));

create or replace function public.formula_pending_lines_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_status public.formula_status;
begin
  select status into v_status from public.formula_versions
   where id = case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  if v_status is null and tg_op = 'DELETE' then
    return old;
  end if;
  if v_status <> 'draft' then
    raise exception 'This formula version is %; only drafts can be changed. Create a new version instead.', v_status;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
create trigger formula_pending_lines_guard before insert or update or delete on public.formula_pending_lines
  for each row execute function public.formula_pending_lines_guard();

-- A recipe with ingredients still to link cannot be approved
create or replace function public.formula_versions_pending_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'approved' and old.status <> 'approved'
     and exists (select 1 from public.formula_pending_lines where version_id = new.id) then
    raise exception 'Link every ingredient to a stock item before approving';
  end if;
  return new;
end
$$;
create trigger formula_versions_pending_guard before update of status on public.formula_versions
  for each row execute function public.formula_versions_pending_guard();

-- A hand edit of a recipe from an offer: saving the offer no longer rebuilds it
create or replace function public.formula_offer_edited()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_version uuid := case when tg_op = 'DELETE' then old.version_id else new.version_id end;
begin
  if coalesce(current_setting('nk.recipe_sync', true), '') <> 'on' then
    update public.formulas f set offer_edited = true
      from public.formula_versions v
     where v.id = v_version and f.id = v.formula_id and f.calc_offer_id is not null and not f.offer_edited;
  end if;
  return null;
end
$$;
create trigger formula_lines_offer_edited after insert or update or delete on public.formula_lines
  for each row execute function public.formula_offer_edited();
create trigger formula_pending_lines_offer_edited after insert or update or delete on public.formula_pending_lines
  for each row execute function public.formula_offer_edited();

/** The stock item of a price-list material or ingredient name: the remembered link, else the same name. */
create or replace function public.recipe_item_for(p_material uuid, p_name text)
returns uuid
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select item_id from public.calc_material_items where material_id = p_material),
    (select id from public.items
      where is_active and type in ('raw_material', 'excipient', 'semi_finished')
        and lower(btrim(name)) = lower(btrim(p_name))
      order by sku limit 1));
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
      insert into public.formula_lines (version_id, item_id, amount, unit, sort_order) values (v_version, v_item, v_amount, v_unit, v_n);
    else
      insert into public.formula_pending_lines (version_id, name, material_id, amount, unit, sort_order)
      values (v_version, btrim(r ->> 'name'), v_mat, v_amount, v_unit, v_n);
    end if;
  end loop;
  perform set_config('nk.recipe_sync', '', true);
  return f.id;
end
$$;
revoke execute on function public.calc_offer_recipe_sync(uuid) from public, anon, authenticated;

create or replace function public.calc_offers_recipe()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' or (new.data, new.product_name, new.product_type, new.client_id)
                          is distinct from (old.data, old.product_name, old.product_type, old.client_id) then
    perform public.calc_offer_recipe_sync(new.id);
  end if;
  return null;
end
$$;
create trigger calc_offers_recipe after insert or update on public.calc_offers
  for each row execute function public.calc_offers_recipe();

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
  insert into public.formula_lines (version_id, item_id, amount, unit, sort_order)
  values (p.version_id, p_item, p.amount, p.unit, p.sort_order) returning id into v_line;
  delete from public.formula_pending_lines where id = p.id;
  if p_remember and p.material_id is not null then
    insert into public.calc_material_items (material_id, item_id) values (p.material_id, p_item)
    on conflict (material_id) do update set item_id = excluded.item_id, updated_by = auth.uid(), updated_at = now();
  end if;
  return v_line;
end
$$;
revoke execute on function public.link_recipe_pending_line(uuid, uuid, boolean) from public, anon;
grant execute on function public.link_recipe_pending_line(uuid, uuid, boolean) to authenticated;

-- The offers saved so far get their recipes too
select public.calc_offer_recipe_sync(id) from public.calc_offers order by created_at;
