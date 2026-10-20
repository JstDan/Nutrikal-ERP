-- =====================================================================
-- Nutrikal ERP + CRM — role restructure (Oct 2026)
-- * Inventory merges into Admin: every inventory profile becomes admin
--   and the value can no longer be given to anyone. Postgres cannot drop
--   an enum value, so it stays in the type but a check constraint on
--   profiles refuses it, and no function or policy names it any more.
-- * Partner is renamed Production (the role of the production facility).
--   Location codes PF-… and the column locations.is_partner_visible keep
--   their names (they are printed on labels and shelves).
-- * Sales is unchanged.
-- Function bodies are plain text, so every function that named the old
-- roles is created again below with the new names.
-- =====================================================================

update public.profiles set role = 'admin' where role = 'inventory';
alter table public.profiles
  add constraint profiles_role_not_inventory_chk check (role::text <> 'inventory');

alter type public.app_role rename value 'partner' to 'production';

-- Location names follow (codes stay)
update public.locations set name = replace(name, 'Partner facility', 'Production facility')
 where name like 'Partner facility%';

alter function public.is_partner_location(uuid) rename to is_production_location;
alter view public.partner_projects rename to production_projects;
alter view public.partner_manufacturing_orders rename to production_manufacturing_orders;

-- ---------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_role('admin', 'sales')
$$;

create or replace function public.can_see_purchase_prices()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select p.role = 'admin'
        or (p.role = 'sales' and p.can_see_purchase_prices)
    from public.profiles p
    where p.id = auth.uid() and p.is_active
  ), false)
$$;

create or replace function public.next_number(p_key text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v public.number_series;
begin
  if not (public.is_staff() or (public.has_role('production') and p_key = 'lot')) then
    raise exception 'Not allowed to draw numbers from series %', p_key using errcode = '42501';
  end if;

  update public.number_series
     set next_number = next_number + 1
   where key = p_key
  returning * into v;

  if not found then
    raise exception 'Unknown number series %', p_key;
  end if;

  return v.prefix || lpad((v.next_number - 1)::text, v.pad_length, '0');
end
$$;

create or replace function public.receive_lot(
  p_item             uuid,
  p_location         uuid,
  p_quantity         numeric,
  p_supplier         uuid    default null,
  p_supplier_lot     text    default null,
  p_manufactured_on  date    default null,
  p_expires_on       date    default null,
  p_coa_path         text    default null,
  p_reference        text    default null,
  p_project          uuid    default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_lot uuid;
begin
  perform public.require_role('admin', 'production');
  if public.has_role('production') and not public.is_production_location(p_location) then
    raise exception 'Production can only receive into production locations' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive';
  end if;

  insert into public.lots (item_id, supplier_id, supplier_lot, manufactured_on, expires_on, coa_path, project_id)
  values (p_item, p_supplier, p_supplier_lot, p_manufactured_on, p_expires_on, p_coa_path, p_project)
  returning id into v_lot;

  insert into public.stock_movements (type, lot_id, location_id, quantity, reference, project_id)
  values ('receipt', v_lot, p_location, p_quantity, p_reference, p_project);

  return v_lot;
end
$$;

create or replace function public.post_stock_movement(
  p_type       public.movement_type,
  p_lot        uuid,
  p_location   uuid,
  p_quantity   numeric,
  p_reason     text default null,
  p_project    uuid default null,
  p_reference  text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_role public.app_role := public.current_app_role();
  v_qty  numeric;
  v_id   bigint;
begin
  if v_role is null or v_role = 'sales' then
    raise exception 'Not allowed to post stock movements' using errcode = '42501';
  end if;
  if p_type in ('receipt', 'transfer_out', 'transfer_in') then
    raise exception 'Use receive_lot or transfer_stock for %', p_type;
  end if;
  if p_type = 'opening_balance' and v_role <> 'admin' then
    raise exception 'Only Admin can post opening balances' using errcode = '42501';
  end if;
  if v_role = 'production' then
    if p_type not in ('consumption', 'production_output', 'dispatch', 'waste') then
      raise exception 'Production cannot post %; use request_stock_adjustment', p_type using errcode = '42501';
    end if;
    if not public.is_production_location(p_location) then
      raise exception 'Production can only post at production locations' using errcode = '42501';
    end if;
  end if;
  if p_quantity is null or p_quantity = 0 then
    raise exception 'Quantity must not be zero';
  end if;

  v_qty := case
             when p_type in ('consumption', 'dispatch', 'waste') then -abs(p_quantity)
             when p_type = 'adjustment' then p_quantity
             else abs(p_quantity)
           end;

  insert into public.stock_movements (type, lot_id, location_id, quantity, reason, project_id, reference)
  values (p_type, p_lot, p_location, v_qty, p_reason, p_project, p_reference)
  returning id into v_id;

  return v_id;
end
$$;

create or replace function public.transfer_stock(
  p_lot        uuid,
  p_from       uuid,
  p_to         uuid,
  p_quantity   numeric,
  p_reason     text default null,
  p_reference  text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_group uuid := gen_random_uuid();
begin
  perform public.require_role('admin', 'production');
  if public.has_role('production')
     and not (public.is_production_location(p_from) and public.is_production_location(p_to)) then
    raise exception 'Production can only move stock between production locations' using errcode = '42501';
  end if;
  if p_from = p_to then
    raise exception 'From and to locations are the same';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive';
  end if;

  insert into public.stock_movements (movement_group, type, lot_id, location_id, quantity, reason, reference)
  values (v_group, 'transfer_out', p_lot, p_from, -p_quantity, p_reason, p_reference),
         (v_group, 'transfer_in',  p_lot, p_to,    p_quantity, p_reason, p_reference);

  return v_group;
end
$$;

create or replace function public.reserve_stock(
  p_item      uuid,
  p_project   uuid,
  p_quantity  numeric,
  p_lot       uuid default null,
  p_location  uuid default null,
  p_note      text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_available numeric;
  v_id        uuid;
begin
  perform public.require_role('admin', 'sales');
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('reserve/' || p_item::text, 0));

  if p_lot is null then
    select available into v_available from public.item_stock_summary where item_id = p_item;
  else
    select coalesce(sum(sb.quantity), 0)
           - coalesce((select sum(r.quantity) from public.stock_reservations r
                        where r.lot_id = p_lot and r.status = 'active'
                          and (p_location is null or r.location_id = p_location)), 0)
      into v_available
      from public.stock_balances sb
     where sb.lot_id = p_lot
       and sb.item_id = p_item
       and sb.qc_status = 'released'
       and not sb.is_expired
       and (p_location is null or sb.location_id = p_location);
  end if;

  if coalesce(v_available, 0) < p_quantity then
    raise exception 'Only % available, % requested', coalesce(v_available, 0), p_quantity
      using errcode = '23514';
  end if;

  insert into public.stock_reservations (item_id, lot_id, location_id, project_id, quantity, note)
  values (p_item, p_lot, p_location, p_project, p_quantity, p_note)
  returning id into v_id;

  return v_id;
end
$$;

create or replace function public.close_reservation(
  p_reservation  uuid,
  p_status       public.reservation_status default 'released'
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  if p_status = 'active' then
    raise exception 'Use released or consumed';
  end if;
  update public.stock_reservations
     set status = p_status, closed_by = auth.uid(), closed_at = now()
   where id = p_reservation and status = 'active';
  if not found then
    raise exception 'Active reservation % not found', p_reservation;
  end if;
end
$$;

create or replace function public.request_stock_adjustment(
  p_lot       uuid,
  p_location  uuid,
  p_quantity  numeric,
  p_reason    text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.require_role('admin', 'production');
  if public.has_role('production') and not public.is_production_location(p_location) then
    raise exception 'Production can only request adjustments at production locations' using errcode = '42501';
  end if;
  insert into public.stock_adjustment_requests (lot_id, location_id, quantity, reason)
  values (p_lot, p_location, p_quantity, p_reason)
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.decide_stock_adjustment(
  p_request  uuid,
  p_approve  boolean,
  p_note     text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_req      public.stock_adjustment_requests;
  v_movement bigint;
begin
  perform public.require_role('admin');

  select * into v_req from public.stock_adjustment_requests where id = p_request for update;
  if not found or v_req.status <> 'pending' then
    raise exception 'Pending request % not found', p_request;
  end if;

  if p_approve then
    insert into public.stock_movements (type, lot_id, location_id, quantity, reason)
    values ('adjustment', v_req.lot_id, v_req.location_id, v_req.quantity,
            'Approved request: ' || v_req.reason)
    returning id into v_movement;
  end if;

  update public.stock_adjustment_requests
     set status        = case when p_approve then 'approved' else 'rejected' end::public.request_status,
         decided_by    = auth.uid(),
         decided_at    = now(),
         decision_note = p_note,
         movement_id   = v_movement
   where id = p_request;

  return v_movement;
end
$$;

create or replace function public.mo_material_requirements(p_mo uuid)
returns table (
  item_id uuid, sku text, name text, name_bg text, kind text, base_unit public.base_unit,
  required numeric, reserved numeric, available numeric, at_partner numeric, requested numeric
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_production boolean := public.has_role('production');
  v_status  public.mo_status;
begin
  if not public.has_role('admin', 'sales', 'production') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select status into v_status from public.manufacturing_orders where id = p_mo;
  if v_status is null or (v_production and v_status not in ('released', 'in_production', 'completed')) then
    raise exception 'Unknown manufacturing order';
  end if;
  return query
    select r.item_id, i.sku, i.name, i.name_bg, r.kind, i.base_unit, r.required,
           coalesce((select sum(sr.quantity) from public.stock_reservations sr
                      where sr.manufacturing_order_id = p_mo and sr.item_id = r.item_id and sr.status = 'active'), 0),
           case when v_production then null
                else coalesce((select s.available from public.item_stock_summary s where s.item_id = r.item_id), 0) end,
           coalesce((select sum(b.quantity) from public.stock_balances b
                      where b.item_id = r.item_id and b.qc_status = 'released' and not b.is_expired
                        and public.is_production_location(b.location_id)), 0),
           case when v_production then null
                else coalesce((select sum(pr.quantity) from public.purchase_requests pr
                                where pr.manufacturing_order_id = p_mo and pr.item_id = r.item_id
                                  and pr.status in ('open', 'ordered')), 0) end
      from public.mo_required_materials(p_mo) r
      join public.items i on i.id = r.item_id
     order by r.kind, i.name;
end
$$;

create or replace function public.reserve_mo_materials(p_mo uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  mo    public.manufacturing_orders;
  r     record;
  v_free numeric;
  v_qty  numeric;
  v_n    integer := 0;
begin
  perform public.require_role('admin', 'sales');
  select * into mo from public.manufacturing_orders where id = p_mo;
  if mo.status not in ('simulation', 'scheduled', 'released') then
    raise exception 'Materials cannot be reserved for a % manufacturing order', mo.status;
  end if;
  for r in
    select q.item_id, q.required,
           coalesce((select sum(sr.quantity) from public.stock_reservations sr
                      where sr.manufacturing_order_id = p_mo and sr.item_id = q.item_id and sr.status = 'active'), 0) as reserved
      from public.mo_required_materials(p_mo) q
  loop
    continue when r.required <= r.reserved;
    perform pg_advisory_xact_lock(hashtextextended('reserve/' || r.item_id::text, 0));
    select coalesce(available, 0) into v_free from public.item_stock_summary where item_id = r.item_id;
    v_qty := least(r.required - r.reserved, coalesce(v_free, 0));
    if v_qty > 0 then
      insert into public.stock_reservations (item_id, project_id, manufacturing_order_id, quantity, note)
      values (r.item_id, mo.project_id, p_mo, v_qty, 'Production ' || mo.code);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;

create or replace function public.create_purchase_requests(p_mo uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  mo  public.manufacturing_orders;
  r   record;
  v_n integer := 0;
begin
  perform public.require_role('admin', 'sales');
  select * into mo from public.manufacturing_orders where id = p_mo;
  if mo.status in ('completed', 'cancelled') then
    raise exception 'This manufacturing order is closed';
  end if;
  for r in select * from public.mo_material_requirements(p_mo) loop
    if r.required - r.reserved - r.requested > 0 then
      insert into public.purchase_requests (item_id, quantity, needed_by, manufacturing_order_id, note)
      values (r.item_id, round(r.required - r.reserved - r.requested, 4), mo.planned_date, p_mo, 'Production ' || mo.code);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;

create or replace function public.schedule_mo(p_mo uuid, p_date date)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  mo public.manufacturing_orders;
begin
  perform public.require_role('admin');
  select * into mo from public.manufacturing_orders where id = p_mo;
  if mo.status not in ('simulation', 'scheduled') then
    raise exception 'Only a simulation or a scheduled order can be scheduled';
  end if;
  if mo.project_id is null then
    raise exception 'Choose the project before scheduling';
  end if;
  if p_date is null then
    raise exception 'Choose the production date';
  end if;
  perform set_config('nk.mo_transition', 'on', true);
  update public.manufacturing_orders set status = 'scheduled', planned_date = p_date where id = p_mo;
  perform set_config('nk.mo_transition', 'off', true);
  return public.reserve_mo_materials(p_mo);
end
$$;

create or replace function public.release_mo(p_mo uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  mo        public.manufacturing_orders;
  v_missing text;
begin
  perform public.require_role('admin');
  select * into mo from public.manufacturing_orders where id = p_mo;
  if mo.status <> 'scheduled' then
    raise exception 'Only a scheduled order can be sent to production';
  end if;
  select string_agg(i.name, ', ' order by i.name) into v_missing
    from public.mo_material_requirements(p_mo) r join public.items i on i.id = r.item_id
   where r.reserved < r.required;
  if v_missing is not null then
    raise exception 'Not all materials are reserved: %', v_missing;
  end if;
  perform set_config('nk.mo_transition', 'on', true);
  update public.manufacturing_orders set status = 'released', released_at = now() where id = p_mo;
  perform set_config('nk.mo_transition', 'off', true);
end
$$;

create or replace function public.cancel_mo(p_mo uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  mo public.manufacturing_orders;
begin
  perform public.require_role('admin');
  select * into mo from public.manufacturing_orders where id = p_mo;
  if mo.status not in ('simulation', 'scheduled', 'released') then
    raise exception 'A % manufacturing order cannot be cancelled', mo.status;
  end if;
  update public.stock_reservations set status = 'released', closed_by = auth.uid(), closed_at = now()
   where manufacturing_order_id = p_mo and status = 'active';
  update public.purchase_requests set status = 'cancelled' where manufacturing_order_id = p_mo and status = 'open';
  perform set_config('nk.mo_transition', 'on', true);
  update public.manufacturing_orders set status = 'cancelled' where id = p_mo;
  perform set_config('nk.mo_transition', 'off', true);
end
$$;

create or replace function public.start_production(p_mo uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'production');
  if (select status from public.manufacturing_orders where id = p_mo) is distinct from 'released' then
    raise exception 'Only an order sent to production can be started';
  end if;
  perform set_config('nk.mo_transition', 'on', true);
  update public.manufacturing_orders set status = 'in_production', started_at = now() where id = p_mo;
  perform set_config('nk.mo_transition', 'off', true);
end
$$;

create or replace function public.complete_production(
  p_mo           uuid,
  p_batch        text,
  p_quantity     integer,
  p_produced_on  date,
  p_consumption  jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  mo        public.manufacturing_orders;
  v_production boolean := public.has_role('production');
  c         record;
  v_item    uuid;
  v_fg      uuid;
  v_lot     uuid;
  v_shelf   integer;
  v_fg_loc  uuid;
  v_project public.projects;
  v_formula public.formulas;
begin
  perform public.require_role('admin', 'production');
  select * into mo from public.manufacturing_orders where id = p_mo;
  if mo.status not in ('released', 'in_production') then
    raise exception 'Only an order sent to production can be completed';
  end if;
  if nullif(btrim(p_batch), '') is null then
    raise exception 'Enter the batch number';
  end if;
  if exists (select 1 from public.lots where lot_number = btrim(p_batch)) then
    raise exception 'Batch number % is already used', btrim(p_batch);
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Enter the quantity made';
  end if;
  if jsonb_typeof(p_consumption) <> 'array' or jsonb_array_length(p_consumption) = 0 then
    raise exception 'Enter the lots consumed';
  end if;

  for c in select * from jsonb_to_recordset(p_consumption) as x(lot_id uuid, location_id uuid, quantity numeric) loop
    continue when coalesce(c.quantity, 0) = 0;
    select item_id into v_item from public.lots where id = c.lot_id;
    if v_item is null or not exists (select 1 from public.mo_required_materials(p_mo) r where r.item_id = v_item) then
      raise exception 'A consumed lot is not one of the materials of this order';
    end if;
    if v_production and not public.is_production_location(c.location_id) then
      raise exception 'Production can only consume stock at production locations' using errcode = '42501';
    end if;
    insert into public.stock_movements (type, lot_id, location_id, quantity, project_id, reference, manufacturing_order_id)
    values ('consumption', c.lot_id, c.location_id, -abs(c.quantity), mo.project_id, mo.code, p_mo);
  end loop;

  select * into v_project from public.projects where id = mo.project_id;
  select f.* into v_formula from public.formulas f join public.formula_versions v on v.formula_id = f.id
   where v.id = mo.formula_version_id;
  select shelf_life_months into v_shelf from public.formula_versions where id = mo.formula_version_id;
  select id into v_fg from public.items
   where type = 'finished_good' and project_id = mo.project_id order by created_at limit 1;
  if v_fg is null then
    insert into public.items (sku, type, name, name_bg, base_unit, client_id, project_id, shelf_life_months)
    values ('FG-' || v_project.code, 'finished_good', v_formula.name, v_formula.name_bg, 'pcs',
            v_project.client_id, v_project.id, v_shelf)
    returning id into v_fg;
  end if;

  select id into v_fg_loc from public.locations where code = 'PF-FG' and is_active;
  if v_fg_loc is null then
    raise exception 'Location PF-FG (production finished goods) is missing';
  end if;

  insert into public.lots (lot_number, item_id, manufactured_on, expires_on, received_on, project_id, notes)
  values (btrim(p_batch), v_fg, coalesce(p_produced_on, current_date),
          (coalesce(p_produced_on, current_date) + make_interval(months => coalesce(v_shelf, 24)))::date,
          coalesce(p_produced_on, current_date), mo.project_id, 'Production ' || mo.code)
  returning id into v_lot;

  insert into public.stock_movements (type, lot_id, location_id, quantity, project_id, reference, manufacturing_order_id)
  values ('production_output', v_lot, v_fg_loc, p_quantity, mo.project_id, mo.code, p_mo);

  update public.stock_reservations set status = 'consumed', closed_by = auth.uid(), closed_at = now()
   where manufacturing_order_id = p_mo and status = 'active';

  perform set_config('nk.mo_transition', 'on', true);
  update public.manufacturing_orders
     set status = 'completed', completed_at = now(), batch_number = btrim(p_batch), produced_quantity = p_quantity,
         produced_on = coalesce(p_produced_on, current_date), finished_lot_id = v_lot,
         started_at = coalesce(started_at, now())
   where id = p_mo;
  perform set_config('nk.mo_transition', 'off', true);

  perform public.update_batch_cost(p_mo);
  return v_lot;
end
$$;

create or replace function public.set_lot_cost(p_lot uuid, p_unit_cost numeric)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin');
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'Enter a cost of zero or more';
  end if;
  insert into public.lot_costs (lot_id, unit_cost, source, updated_by, updated_at)
  values (p_lot, p_unit_cost, 'receipt', auth.uid(), now())
  on conflict (lot_id) do update
    set unit_cost = excluded.unit_cost, source = 'receipt', updated_by = auth.uid(), updated_at = now();
end
$$;

create or replace function public.create_expected_delivery(
  p_item               uuid,
  p_quantity           numeric,
  p_supplier           uuid    default null,
  p_expected_on        date    default null,
  p_unit_price         numeric default null,
  p_po_reference       text    default null,
  p_location           uuid    default null,
  p_purchase_request   uuid    default null,
  p_note               text    default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_req public.purchase_requests;
  v_id  uuid;
begin
  perform public.require_role('admin');

  if p_purchase_request is not null then
    select * into v_req from public.purchase_requests where id = p_purchase_request for update;
    if not found then
      raise exception 'Purchase request % not found', p_purchase_request;
    end if;
    if v_req.status not in ('open', 'ordered') then
      raise exception 'Purchase request % is %', v_req.code, v_req.status;
    end if;
    if p_item is not null and p_item <> v_req.item_id then
      raise exception 'The delivery must be for the item of purchase request %', v_req.code;
    end if;
    p_item := v_req.item_id;
    p_quantity := coalesce(p_quantity, v_req.quantity);
  end if;

  if p_item is null then
    raise exception 'Choose an item';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive';
  end if;
  if p_unit_price is not null and p_unit_price < 0 then
    raise exception 'Price cannot be negative';
  end if;

  insert into public.expected_deliveries (item_id, supplier_id, quantity, expected_on, unit_price,
                                          po_reference, location_id, purchase_request_id, note)
  values (p_item, p_supplier, p_quantity, p_expected_on, p_unit_price,
          nullif(btrim(p_po_reference), ''), p_location, p_purchase_request, nullif(btrim(p_note), ''))
  returning id into v_id;

  if p_purchase_request is not null then
    update public.purchase_requests set status = 'ordered' where id = p_purchase_request and status = 'open';
  end if;

  return v_id;
end
$$;

create or replace function public.receive_expected_delivery(
  p_delivery         uuid,
  p_location         uuid,
  p_quantity         numeric,
  p_supplier_lot     text    default null,
  p_manufactured_on  date    default null,
  p_expires_on       date    default null,
  p_reference        text    default null,
  p_close            boolean default false
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  d          public.expected_deliveries;
  v_lot      uuid;
  v_received numeric;
begin
  perform public.require_role('admin');

  select * into d from public.expected_deliveries where id = p_delivery for update;
  if not found then
    raise exception 'Delivery % not found', p_delivery;
  end if;
  if d.status <> 'open' then
    raise exception 'Delivery % is %', d.code, d.status;
  end if;

  v_lot := public.receive_lot(d.item_id, coalesce(p_location, d.location_id), p_quantity, d.supplier_id,
                              p_supplier_lot, p_manufactured_on, p_expires_on, null,
                              coalesce(nullif(btrim(p_reference), ''), d.po_reference, d.code), null);
  update public.lots set expected_delivery_id = d.id where id = v_lot;

  if d.unit_price is not null and d.currency = 'EUR' then
    perform public.set_lot_cost(v_lot, d.unit_price);
  end if;

  select coalesce(sum(m.quantity), 0) into v_received
    from public.lots l
    join public.stock_movements m on m.lot_id = l.id and m.type = 'receipt'
   where l.expected_delivery_id = d.id;

  if v_received >= d.quantity or p_close then
    perform set_config('nutrikal.delivery_fn', 'on', true);
    update public.expected_deliveries
       set status = 'received', closed_by = auth.uid(), closed_at = now()
     where id = d.id;
    perform set_config('nutrikal.delivery_fn', '', true);

    -- The request is done when none of its deliveries is still open
    if d.purchase_request_id is not null and not exists (
         select 1 from public.expected_deliveries
          where purchase_request_id = d.purchase_request_id and status = 'open') then
      update public.purchase_requests set status = 'received'
       where id = d.purchase_request_id and status in ('open', 'ordered');
    end if;
  end if;

  return v_lot;
end
$$;

create or replace function public.cancel_expected_delivery(p_delivery uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  d public.expected_deliveries;
begin
  perform public.require_role('admin');
  select * into d from public.expected_deliveries where id = p_delivery for update;
  if not found or d.status <> 'open' then
    raise exception 'Open delivery % not found', p_delivery;
  end if;

  perform set_config('nutrikal.delivery_fn', 'on', true);
  update public.expected_deliveries
     set status = 'cancelled', closed_by = auth.uid(), closed_at = now(),
         note = coalesce(nullif(btrim(p_note), ''), note)
   where id = d.id;
  perform set_config('nutrikal.delivery_fn', '', true);

  if d.purchase_request_id is not null and not exists (
       select 1 from public.expected_deliveries x
        where x.purchase_request_id = d.purchase_request_id
          and (x.status = 'open' or exists (select 1 from public.lots l where l.expected_delivery_id = x.id))) then
    update public.purchase_requests set status = 'open'
     where id = d.purchase_request_id and status = 'ordered';
  end if;
end
$$;

create or replace function public.count_stock(
  p_lot       uuid,
  p_location  uuid,
  p_counted   numeric,
  p_reason    text default null
)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_balance numeric;
  v_diff    numeric;
  v_reason  text := 'Stock count' || coalesce(': ' || nullif(btrim(p_reason), ''), '');
begin
  perform public.require_role('admin', 'production');
  if p_counted is null or p_counted < 0 then
    raise exception 'Enter the counted quantity (zero or more)';
  end if;
  if public.has_role('production') and not public.is_production_location(p_location) then
    raise exception 'Production can only count stock at production locations' using errcode = '42501';
  end if;

  -- Same lock as the ledger guard, so the balance cannot move under us
  perform pg_advisory_xact_lock(hashtextextended(p_lot::text || '/' || p_location::text, 0));
  select coalesce(sum(quantity), 0) into v_balance
    from public.stock_movements
   where lot_id = p_lot and location_id = p_location;

  v_diff := p_counted - v_balance;
  if v_diff = 0 then
    return 0;
  end if;

  if public.has_role('production') then
    perform public.request_stock_adjustment(p_lot, p_location, v_diff, v_reason);
  else
    insert into public.stock_movements (type, lot_id, location_id, quantity, reason)
    values ('adjustment', p_lot, p_location, v_diff, v_reason);
  end if;
  return v_diff;
end
$$;

create or replace function public.impersonation_targets()
returns table (id uuid, full_name text, email text, role public.app_role, locale public.app_locale)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_developer() then
    raise exception 'Only a developer can act as another user' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.email::text, p.role, p.locale
      from public.profiles p
     where p.is_active and p.role::text <> 'developer'
     order by array_position(array['admin', 'sales', 'production'], p.role::text), p.full_name;
end
$$;

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------
create or replace view public.production_projects as
select p.id, p.code, p.product_format, p.status
  from public.projects p
 where public.has_role('admin', 'sales', 'production');

create or replace view public.sales_order_overview as
select so.id, so.code, so.status, so.requested_date, so.created_at, so.confirmed_at, so.dispatched_at,
       so.client_id, c.legal_name as client,
       (select count(*)::int from public.sales_order_lines l where l.order_id = so.id) as line_count,
       (select coalesce(sum(l.quantity), 0)::int from public.sales_order_lines l where l.order_id = so.id) as total_packs
  from public.sales_orders so
  join public.clients c on c.id = so.client_id
 where public.has_role('admin', 'sales');

create or replace view public.sales_order_line_overview as
select l.id, l.order_id, l.quantity, l.sort_order, l.project_id, p.code as project_code, p.name as project_name,
       f.id as formula_id, f.code as formula_code, f.name as product, f.name_bg as product_bg, f.product_format,
       v.id as formula_version_id, v.version as formula_version, l.offer_id
  from public.sales_order_lines l
  join public.projects p on p.id = l.project_id
  join public.formula_versions v on v.id = l.formula_version_id
  join public.formulas f on f.id = v.formula_id
 where public.has_role('admin', 'sales');

-- ---------------------------------------------------------------------
-- Policies that named Inventory or Partner
-- ---------------------------------------------------------------------
drop policy clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (public.has_role('admin', 'sales'));

drop policy projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
  using (public.has_role('admin', 'sales'));

drop policy items_insert on public.items;
create policy items_insert on public.items for insert to authenticated
  with check (public.has_role('admin'));
drop policy items_update on public.items;
create policy items_update on public.items for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

drop policy suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers for select to authenticated
  using (public.has_role('admin') or public.can_see_purchase_prices());
drop policy suppliers_insert on public.suppliers;
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check (public.has_role('admin'));
drop policy suppliers_update on public.suppliers;
create policy suppliers_update on public.suppliers for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

drop policy supplier_items_select on public.supplier_items;
create policy supplier_items_select on public.supplier_items for select to authenticated
  using (public.has_role('admin') or public.can_see_purchase_prices());
drop policy supplier_items_write on public.supplier_items;
create policy supplier_items_write on public.supplier_items for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

drop policy supplier_prices_insert on public.supplier_prices;
create policy supplier_prices_insert on public.supplier_prices for insert to authenticated
  with check (public.has_role('admin'));
drop policy supplier_prices_update on public.supplier_prices;
create policy supplier_prices_update on public.supplier_prices for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

drop policy locations_select on public.locations;
create policy locations_select on public.locations for select to authenticated
  using (public.is_staff() or (public.has_role('production') and is_partner_visible and is_active));

drop policy lots_select on public.lots;
create policy lots_select on public.lots for select to authenticated
  using (
    public.is_staff()
    or (public.has_role('production') and exists (
          select 1 from public.stock_movements m
           where m.lot_id = lots.id and public.is_production_location(m.location_id)))
  );
drop policy lots_update on public.lots;
create policy lots_update on public.lots for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

drop policy stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements for select to authenticated
  using (public.is_staff() or (public.has_role('production') and public.is_production_location(location_id)));

drop policy stock_reservations_select on public.stock_reservations;
create policy stock_reservations_select on public.stock_reservations for select to authenticated
  using (public.is_staff()
         or (public.has_role('production') and location_id is not null and public.is_production_location(location_id)));

drop policy stock_adjustment_requests_select on public.stock_adjustment_requests;
create policy stock_adjustment_requests_select on public.stock_adjustment_requests for select to authenticated
  using (public.has_role('admin') or requested_by = auth.uid());

drop policy item_nutrients_write on public.item_nutrients;
create policy item_nutrients_write on public.item_nutrients for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

drop policy manufacturing_orders_update on public.manufacturing_orders;
create policy manufacturing_orders_update on public.manufacturing_orders for update to authenticated
  using (public.has_role('admin') or (public.has_role('sales') and status = 'simulation'))
  with check (public.has_role('admin') or (public.has_role('sales') and status = 'simulation'));

drop policy production_invoices_select on public.production_invoices;
create policy production_invoices_select on public.production_invoices for select to authenticated
  using (public.has_role('admin') or (public.has_role('production') and entered_by = auth.uid()));
drop policy production_invoices_insert on public.production_invoices;
create policy production_invoices_insert on public.production_invoices for insert to authenticated
  with check (public.has_role('admin', 'production') and public.mo_is_released(mo_id));

drop policy purchase_requests_update on public.purchase_requests;
create policy purchase_requests_update on public.purchase_requests for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

drop policy lot_costs_write on public.lot_costs;
create policy lot_costs_write on public.lot_costs for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

drop policy expected_deliveries_select on public.expected_deliveries;
create policy expected_deliveries_select on public.expected_deliveries for select to authenticated
  using (public.has_role('admin') or public.can_see_purchase_prices());
drop policy expected_deliveries_update on public.expected_deliveries;
create policy expected_deliveries_update on public.expected_deliveries for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
