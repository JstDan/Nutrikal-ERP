-- =====================================================================
-- Nutrikal ERP + CRM — the catalog syncs on its own
-- The catalog products (calc_catalog_products, 20261025000100) were synced
-- together with the raw material price list. They are separate now: own
-- tab in the calculator ("Каталожни формули"), own Sync button, own log
-- (calc_catalog_sync_runs) and own daily 17:00 run. The price-list sync is
-- back to what it was before (20261024000100).
--
--                          admin   sales   production
-- calc_catalog_sync_runs   read    read    —
-- =====================================================================

-- ------------------------------------------- price list: catalog out again
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
      set price_eur_per_kg = excluded.price_eur_per_kg, active = true;

    update public.calc_raw_materials set active = false
     where active
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

alter table public.calc_sync_runs drop column catalog, drop column catalog_error;

-- ------------------------------------------------------- catalog sync
create table public.calc_catalog_sync_runs (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  source        text not null check (source in ('manual', 'scheduled', 'auto')),
  status        text not null check (status in ('success', 'error')),
  added         integer not null default 0,
  changed       integer not null default 0,
  unchanged     integer not null default 0,
  removed       integer not null default 0,
  error         text,
  triggered_by  uuid references public.profiles (id) on delete set null
);
create index calc_catalog_sync_runs_created_at_idx on public.calc_catalog_sync_runs (created_at desc);

alter table public.calc_catalog_sync_runs enable row level security; -- written only by the functions below
create policy calc_catalog_sync_runs_select on public.calc_catalog_sync_runs for select to authenticated
  using (public.has_role('admin', 'sales'));
revoke insert, update, delete, truncate on public.calc_catalog_sync_runs from anon, authenticated;

-- Shared body: apply the products read from the catalog sheet (unless
-- p_error) and log the run. Upserts by code and deactivates products no
-- longer in the sheet; never deletes. An empty list changes nothing.
create or replace function public.calc_apply_catalog_sync(p_source text, p_products jsonb, p_stats jsonb, p_error text, p_user uuid)
returns public.calc_catalog_sync_runs
language plpgsql security definer set search_path = public
as $$
declare
  r public.calc_catalog_sync_runs;
  v_error text := p_error;
begin
  if v_error is null and (jsonb_typeof(p_products) <> 'array' or jsonb_array_length(p_products) = 0) then
    v_error := 'The catalog sheet has no products';
  end if;

  if v_error is null then
    insert into public.calc_catalog_products (code, name, category, tiers, sort_order, active)
    select x.code, x.name, x.category, x.tiers, x.sort_order, true
      from jsonb_to_recordset(p_products) as x(code text, name text, category text, tiers jsonb, sort_order integer)
    on conflict (code) do update
      set name = excluded.name, category = excluded.category, tiers = excluded.tiers,
          sort_order = excluded.sort_order, active = true;

    update public.calc_catalog_products set active = false
     where active
       and code not in (select x ->> 'code' from jsonb_array_elements(p_products) x);
  end if;

  insert into public.calc_catalog_sync_runs (source, status, added, changed, unchanged, removed, error, triggered_by)
  values (
    p_source,
    case when v_error is null then 'success' else 'error' end,
    coalesce((p_stats ->> 'added')::integer, 0),
    coalesce((p_stats ->> 'changed')::integer, 0),
    coalesce((p_stats ->> 'unchanged')::integer, 0),
    coalesce((p_stats ->> 'removed')::integer, 0),
    v_error,
    p_user
  )
  returning * into r;
  return r;
end
$$;

-- Users (admin, sales): Sync button or catch-up when the calculator opens
create or replace function public.calc_record_catalog_sync(p_source text, p_products jsonb, p_stats jsonb, p_error text default null)
returns public.calc_catalog_sync_runs
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  if p_source not in ('manual', 'auto') then
    raise exception 'Invalid sync source %', p_source;
  end if;
  return public.calc_apply_catalog_sync(p_source, p_products, p_stats, p_error, auth.uid());
end
$$;

-- Server job: the daily 17:00 run
create or replace function public.calc_record_scheduled_catalog_sync(p_products jsonb, p_stats jsonb, p_error text default null)
returns public.calc_catalog_sync_runs
language sql security definer set search_path = public
as $$
  select public.calc_apply_catalog_sync('scheduled', p_products, p_stats, p_error, null)
$$;

revoke execute on function public.calc_apply_catalog_sync(text, jsonb, jsonb, text, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.calc_record_catalog_sync(text, jsonb, jsonb, text) from public, anon;
grant execute on function public.calc_record_catalog_sync(text, jsonb, jsonb, text) to authenticated;
revoke execute on function public.calc_record_scheduled_catalog_sync(jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.calc_record_scheduled_catalog_sync(jsonb, jsonb, text) to service_role;
