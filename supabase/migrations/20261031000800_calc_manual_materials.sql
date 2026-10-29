-- =====================================================================
-- Nutrikal ERP + CRM — raw materials added by hand in the calculator
-- When a raw material is not in the price list (Google Sheet), admin or
-- sales can add it from the formula search with a name and a price per
-- kg. It is kept in calc_raw_materials marked `manual`, so the sheet
-- sync never removes it; when the sheet later lists the same name, the
-- sheet takes over (price from the sheet, no longer manual).
-- =====================================================================

alter table public.calc_raw_materials
  add column manual   boolean not null default false,
  add column added_by uuid references auth.users (id) on delete set null;

comment on column public.calc_raw_materials.manual is
  'Added by hand in the calculator (not in the Google Sheet); the sync leaves it alone until the sheet lists the same name.';

-- Admin, sales: add a raw material that is not in the price list
create or replace function public.calc_add_raw_material(p_name text, p_price numeric)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_old  public.calc_raw_materials;
  v_id   uuid;
begin
  perform public.require_role('admin', 'sales');
  if v_name = '' then
    raise exception 'Enter the name of the raw material';
  end if;
  if length(v_name) > 200 then
    raise exception 'The name is too long (200 characters at most)';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'Enter a price per kg above 0';
  end if;

  select * into v_old from public.calc_raw_materials where lower(name) = lower(v_name) limit 1;
  if found and v_old.active then
    raise exception 'The raw material "%" is already in the price list', v_old.name;
  end if;

  if found then
    -- removed from the sheet earlier: back as a hand-added material at the new price
    update public.calc_raw_materials
       set price_eur_per_kg = round(p_price, 4), active = true, manual = true, added_by = auth.uid()
     where id = v_old.id
     returning id into v_id;
  else
    insert into public.calc_raw_materials (name, price_eur_per_kg, active, manual, added_by)
    values (v_name, round(p_price, 4), true, true, auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end
$$;

revoke execute on function public.calc_add_raw_material(text, numeric) from public, anon;
grant execute on function public.calc_add_raw_material(text, numeric) to authenticated;

-- Sync: a name in the sheet is no longer manual; hand-added materials are never deactivated
create or replace function public.calc_apply_sync(p_source text, p_plan jsonb, p_stats jsonb, p_error text, p_user uuid)
returns public.calc_sync_runs
language plpgsql security definer set search_path = public
as $$
declare
  r public.calc_sync_runs;
begin
  if p_error is null then
    insert into public.calc_raw_materials (name, price_eur_per_kg, active)
    select x.name, x.price_eur_per_kg, true
      from jsonb_to_recordset(coalesce(p_plan -> 'upserts', '[]'::jsonb)) as x(name text, price_eur_per_kg numeric)
    on conflict (name) do update
      set price_eur_per_kg = excluded.price_eur_per_kg, active = true, manual = false;

    update public.calc_raw_materials set active = false
     where active and not manual
       and name in (select jsonb_array_elements_text(coalesce(p_plan -> 'deactivate', '[]'::jsonb)));
  end if;

  insert into public.calc_sync_runs (source, status, added, changed, unchanged, invalid, missing, removed, restored, error, triggered_by)
  values (
    p_source,
    case when p_error is null then 'success' else 'error' end,
    coalesce((p_stats ->> 'added')::integer, 0),
    coalesce((p_stats ->> 'changed')::integer, 0),
    coalesce((p_stats ->> 'unchanged')::integer, 0),
    coalesce((p_stats ->> 'invalid')::integer, 0),
    coalesce((p_stats ->> 'missing')::integer, 0),
    coalesce((p_stats ->> 'removed')::integer, 0),
    coalesce((p_stats ->> 'restored')::integer, 0),
    p_error,
    p_user
  )
  returning * into r;
  return r;
end
$$;

revoke execute on function public.calc_apply_sync(text, jsonb, jsonb, text, uuid) from public, anon, authenticated, service_role;
