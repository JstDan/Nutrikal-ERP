-- Production calendar (owner, Nov 2026). Admin moves batches; the partner confirms a date or proposes another.
-- The partner also sees scheduled batches here, with the same columns as its orders: project code, product, quantity.
-- Clients get only a window of two calendar weeks, once every batch of the order is confirmed; never a date.

alter table public.manufacturing_orders
  add column date_state text not null default 'pending' check (date_state in ('pending', 'confirmed', 'proposed')),
  add column proposed_date date,
  add column date_note text,
  add column date_answered_at timestamptz;

-- A new date needs a new answer, whichever way it was changed
create or replace function public.mo_date_reset()
returns trigger
language plpgsql
as $$
begin
  if new.planned_date is distinct from old.planned_date and new.date_state = old.date_state then
    new.date_state := 'pending';
    new.proposed_date := null;
    new.date_note := null;
  end if;
  return new;
end
$$;
create trigger manufacturing_orders_date_reset before update on public.manufacturing_orders
  for each row execute function public.mo_date_reset();

do $$
declare
  v text;
begin
  select pg_get_constraintdef(oid) into v from pg_constraint where conname = 'notifications_kind_check';
  execute 'alter table public.notifications drop constraint notifications_kind_check';
  execute 'alter table public.notifications add constraint notifications_kind_check '
    || replace(v, $q$'client_message'::text$q$, $q$'client_message'::text, 'mo_date_changed'::text, 'mo_date_answer'::text, 'mo_date_decided'::text$q$);
end
$$;

-- ---------------------------------------------------------------- moving and answering
create or replace function public.mo_reschedule(p_mo uuid, p_date date)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  mo public.manufacturing_orders;
begin
  perform public.require_role('admin');
  select * into mo from public.manufacturing_orders where id = p_mo for update;
  if mo.id is null then raise exception 'Manufacturing order not found'; end if;
  if mo.status in ('completed', 'cancelled') then raise exception 'This manufacturing order is closed'; end if;
  if p_date is null then raise exception 'Choose a date'; end if;
  if mo.planned_date is not distinct from p_date then return; end if;
  update public.manufacturing_orders set planned_date = p_date where id = p_mo;
  if mo.status in ('scheduled', 'released', 'in_production') then
    perform public.notify_role('production', 'mo_date_changed', jsonb_build_object('code', mo.code, 'date', p_date), '/factory/calendar');
  end if;
end
$$;

create or replace function public.mo_date_answer(p_mo uuid, p_date date, p_note text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  mo public.manufacturing_orders;
begin
  perform public.require_role('production');
  select * into mo from public.manufacturing_orders where id = p_mo for update;
  if mo.id is null or mo.status not in ('scheduled', 'released', 'in_production') then
    raise exception 'This manufacturing order cannot be answered';
  end if;
  if p_date is null or p_date = mo.planned_date then
    update public.manufacturing_orders set date_state = 'confirmed', proposed_date = null, date_note = nullif(btrim(coalesce(p_note, '')), ''), date_answered_at = now() where id = p_mo;
  else
    update public.manufacturing_orders set date_state = 'proposed', proposed_date = p_date, date_note = nullif(btrim(coalesce(p_note, '')), ''), date_answered_at = now() where id = p_mo;
  end if;
  perform public.notify_role('admin', 'mo_date_answer',
    jsonb_build_object('code', mo.code, 'proposed', case when p_date is distinct from mo.planned_date then p_date end), '/production/calendar');
end
$$;

create or replace function public.mo_date_decide(p_mo uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  mo public.manufacturing_orders;
begin
  perform public.require_role('admin');
  select * into mo from public.manufacturing_orders where id = p_mo for update;
  if mo.id is null or mo.date_state <> 'proposed' then raise exception 'No date was proposed'; end if;
  if p_accept then
    update public.manufacturing_orders set planned_date = proposed_date, proposed_date = null, date_state = 'confirmed' where id = p_mo;
  else
    update public.manufacturing_orders set proposed_date = null, date_state = 'pending' where id = p_mo;
  end if;
  perform public.notify_role('production', 'mo_date_decided', jsonb_build_object('code', mo.code, 'accepted', p_accept), '/factory/calendar');
end
$$;

-- ---------------------------------------------------------------- reading
-- The team: with the client and its requested date
create or replace function public.staff_calendar(p_from date, p_to date)
returns table (id uuid, code text, status text, on_date date, product text, product_bg text, quantity integer, project_code text,
               client text, order_id uuid, requested_date date, date_state text, proposed_date date, date_note text, late boolean, past_requested boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  return query
    select mo.id, mo.code, mo.status::text, case when mo.status = 'completed' then coalesce(mo.produced_on, mo.planned_date) else mo.planned_date end,
           f.name::text, f.name_bg::text, mo.quantity, p.code::text, c.legal_name::text, so.id, so.requested_date, mo.date_state, mo.proposed_date, mo.date_note,
           mo.status <> 'completed' and mo.planned_date < current_date,
           mo.status <> 'completed' and so.requested_date is not null and mo.planned_date > so.requested_date
      from public.manufacturing_orders mo
      join public.formula_versions v on v.id = mo.formula_version_id
      join public.formulas f on f.id = v.formula_id
      left join public.projects p on p.id = mo.project_id
      left join public.sales_order_lines l on l.id = mo.sales_order_line_id
      left join public.sales_orders so on so.id = l.order_id
      left join public.clients c on c.id = coalesce(so.client_id, p.client_id)
     where mo.status <> 'cancelled'
       and (mo.planned_date is null and mo.status = 'simulation'
            or mo.date_state = 'proposed'
            or mo.status <> 'completed' and mo.planned_date < current_date
            or coalesce(mo.produced_on, mo.planned_date) between p_from and p_to)
     order by 4 nulls first, mo.code;
end
$$;

-- The partner: no client, no order, no prices
create or replace function public.production_calendar(p_from date, p_to date)
returns table (id uuid, code text, status text, on_date date, product text, product_bg text, quantity integer, project_code text,
               date_state text, proposed_date date, date_note text, late boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('production', 'admin');
  return query
    select mo.id, mo.code, mo.status::text, case when mo.status = 'completed' then coalesce(mo.produced_on, mo.planned_date) else mo.planned_date end,
           f.name::text, f.name_bg::text, mo.quantity, p.code::text, mo.date_state, mo.proposed_date, mo.date_note,
           mo.status <> 'completed' and mo.planned_date < current_date
      from public.manufacturing_orders mo
      join public.projects p on p.id = mo.project_id
      join public.formula_versions v on v.id = mo.formula_version_id
      join public.formulas f on f.id = v.formula_id
     where mo.status in ('scheduled', 'released', 'in_production', 'completed')
       and (mo.status <> 'completed' and (mo.date_state <> 'confirmed' or mo.planned_date < current_date)
            or coalesce(mo.produced_on, mo.planned_date) between p_from and p_to)
     order by 4, mo.code;
end
$$;

-- A client sees weeks only, and only when every batch of the order is confirmed
create or replace function public.portal_order_window(p_order uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when count(*) > 0 and bool_and(mo.date_state = 'confirmed' and mo.planned_date is not null) then
           jsonb_build_object('from', to_char(max(mo.planned_date), 'IW')::int, 'to', to_char(max(mo.planned_date) + 7, 'IW')::int) end
    from public.manufacturing_orders mo
    join public.sales_order_lines l on l.id = mo.sales_order_line_id
    join public.sales_orders so on so.id = l.order_id
   where so.id = p_order and public.portal_own_order(so.id) and so.status in ('confirmed', 'in_production')
     and mo.status not in ('cancelled', 'completed')
$$;

do $$
declare
  f text;
begin
  foreach f in array array['mo_reschedule(uuid, date)', 'mo_date_answer(uuid, date, text)', 'mo_date_decide(uuid, boolean)',
    'staff_calendar(date, date)', 'production_calendar(date, date)', 'portal_order_window(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$$;
