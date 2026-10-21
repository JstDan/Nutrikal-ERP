-- =====================================================================
-- Nutrikal ERP + CRM — daily price-list sync at 17:00 (Europe/Sofia)
-- The calculator's price list comes from the Google Sheet. Besides the
-- manual "Sync" button (admin, sales) and the catch-up sync when the
-- calculator opens, the server syncs it once a day after 17:00 Sofia
-- time. That job has no signed-in user, so it gets its own function that
-- only the database owner (the app server) may call: users can never log
-- a run as "scheduled".
-- =====================================================================

-- Shared body: apply a plan (unless p_error) and log the run. Not callable by users.
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

-- Users (admin, sales): manual button or catch-up when the calculator opens
create or replace function public.calc_record_sync(p_source text, p_plan jsonb, p_stats jsonb, p_error text default null)
returns public.calc_sync_runs
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  if p_source not in ('manual', 'auto') then
    raise exception 'Invalid sync source %', p_source;
  end if;
  return public.calc_apply_sync(p_source, p_plan, p_stats, p_error, auth.uid());
end
$$;

-- Server job: the daily 17:00 run
create or replace function public.calc_record_scheduled_sync(p_plan jsonb, p_stats jsonb, p_error text default null)
returns public.calc_sync_runs
language sql security definer set search_path = public
as $$
  select public.calc_apply_sync('scheduled', p_plan, p_stats, p_error, null)
$$;

revoke execute on function public.calc_apply_sync(text, jsonb, jsonb, text, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.calc_record_scheduled_sync(jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.calc_record_scheduled_sync(jsonb, jsonb, text) to service_role;
