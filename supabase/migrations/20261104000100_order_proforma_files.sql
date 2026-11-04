-- =====================================================================
-- Nutrikal ERP + CRM — issued proformas kept as files in the order tasks
-- Owner, 4 Nov 2026: a proforma that is downloaded (the advance one or
-- the final one) is added as a file to the order's task board, column
-- Payments & invoices: the advance proforma to the task Payment, the
-- final one to Proforma for the final payment (else Final payment, Payment). The latest copy replaces
-- the earlier one of the same name.
-- The board is made when the first payment is confirmed, so an advance
-- proforma issued before it waits in order_proforma_pending and is moved
-- to the task by the app right after the board appears.
-- Files: bucket order-task-files, path {order}/{task or waiting id}/{uuid}-{name}.
-- Admin and Sales only; Production never sees proformas.
-- =====================================================================

create table public.order_proforma_pending (
  order_id      uuid not null references public.sales_orders (id) on delete cascade,
  kind          text not null check (kind in ('advance', 'final')),
  storage_path  text not null unique,
  name          text not null check (btrim(name) <> '' and length(name) <= 200),
  size          bigint not null check (size > 0 and size <= 26214400),
  created_by    uuid default auth.uid() references public.profiles (id),
  created_at    timestamptz not null default now(),
  primary key (order_id, kind)
);
comment on table public.order_proforma_pending is
  'A downloaded proforma of an order whose task board does not exist yet; moved to the Payment task when it does';

alter table public.order_proforma_pending enable row level security;
create policy order_proforma_pending_select on public.order_proforma_pending for select to authenticated
  using (public.has_role('admin', 'sales'));
revoke insert, update, delete, truncate, references, trigger on public.order_proforma_pending from anon, authenticated;
grant select on public.order_proforma_pending to authenticated;

/** The task that keeps a proforma of the order: Payment for the advance; Proforma for the final payment (else Final payment, Payment) for the final one. */
create or replace function public.order_proforma_task(p_order uuid, p_kind text)
returns uuid
language plpgsql stable security definer set search_path = public
as $$
declare
  v uuid;
begin
  perform public.require_role('admin', 'sales');
  select t.id into v
    from public.order_tasks t join public.order_task_boards b on b.id = t.board_id
   where b.sales_order_id = p_order
     and t.template_key = any (case when p_kind = 'final' then array['proforma_final', 'payment_final', 'payment_first'] else array['payment_first'] end)
   order by array_position(case when p_kind = 'final' then array['proforma_final', 'payment_final', 'payment_first'] else array['payment_first'] end, t.template_key)
   limit 1;
  return v;
end
$$;

/**
 * Records a stored proforma file: on its task when the board exists (an earlier file of the same name there
 * is removed), else as waiting. Returns the storage paths the app removes (replaced or moved copies).
 */
create or replace function public.keep_order_proforma(p_order uuid, p_kind text, p_path text, p_name text, p_size bigint)
returns text[]
language plpgsql security definer set search_path = public
as $$
declare
  v_task uuid;
  v_old  text[] := '{}';
  v_name text := btrim(p_name);
begin
  perform public.require_role('admin', 'sales');
  if p_kind not in ('advance', 'final') then
    raise exception 'Unknown proforma';
  end if;
  if not exists (select 1 from public.sales_orders where id = p_order) then
    raise exception 'Unknown order';
  end if;
  if p_name !~* '\.pdf$' or p_size is null or p_size <= 0 or p_size > 26214400 then
    raise exception 'Invalid file';
  end if;
  if split_part(p_path, '/', 1) <> p_order::text or split_part(p_path, '/', 2) !~* '^[0-9a-f-]{36}$'
     or split_part(p_path, '/', 3) !~* '^[0-9a-f-]{36}-.+' then
    raise exception 'Invalid file path';
  end if;
  v_task := public.order_proforma_task(p_order, p_kind);

  if v_task is null then
    select array_agg(storage_path) into v_old from public.order_proforma_pending where order_id = p_order and kind = p_kind;
    insert into public.order_proforma_pending (order_id, kind, storage_path, name, size)
    values (p_order, p_kind, p_path, v_name, p_size)
    on conflict (order_id, kind) do update
      set storage_path = excluded.storage_path, name = excluded.name, size = excluded.size,
          created_by = auth.uid(), created_at = now();
    return coalesce(v_old, '{}');
  end if;

  if split_part(p_path, '/', 2) <> v_task::text then
    raise exception 'Invalid file path';
  end if;
  -- The latest copy replaces the earlier one of the same name
  with gone as (
    update public.order_task_files set deleted_at = now(), deleted_by = auth.uid()
     where task_id = v_task and name = v_name and deleted_at is null
    returning storage_path)
  select coalesce(array_agg(storage_path), '{}') into v_old from gone;
  insert into public.order_task_files (task_id, storage_path, name, size, mime, uploaded_by)
  values (v_task, p_path, v_name, p_size, 'application/pdf', auth.uid());
  perform public.order_task_log(v_task, 'file_added', jsonb_build_object('name', v_name));
  -- A waiting copy of this proforma is now on the task
  with moved as (delete from public.order_proforma_pending where order_id = p_order and kind = p_kind returning storage_path)
  select v_old || coalesce(array_agg(storage_path), '{}') into v_old from moved;
  return v_old;
end
$$;

revoke execute on function public.order_proforma_task(uuid, text) from public, anon;
revoke execute on function public.keep_order_proforma(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.order_proforma_task(uuid, text) to authenticated;
grant execute on function public.keep_order_proforma(uuid, text, text, text, bigint) to authenticated;
