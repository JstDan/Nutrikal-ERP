-- =====================================================================
-- Nutrikal ERP + CRM — production portal and production flow (Oct 2026)
--
-- Production (the facility user) can now:
-- * correct stock of raw materials and packaging at its own locations
--   directly: an adjustment in the ledger with a required reason; every
--   admin is notified (no more approval requests);
-- * move its orders forward: Waiting (released) -> In production ->
--   Ready to ship (completed). Only Admin moves an order back, and Admin
--   can also move it forward on the facility's behalf;
-- * report a batch: used quantity per lot next to what was reserved;
--   a difference over company_settings.production_variance_pct needs a
--   reason; the finished batch goes to quarantine in PF-QUAR; the used
--   part of the reservations is consumed and the rest released;
-- * receive expected deliveries to its locations (into PF-QUAR, with
--   waybill photos, see delivery_attachments);
-- * see, per material of its orders, supplier, ordered quantity, unit
--   purchase price and date (read only; Admin edits them).
-- Client names and sales prices stay hidden from Production.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Stock: direct corrections by Production
-- ---------------------------------------------------------------------

-- Post a single movement. Production posts consumption, output, dispatch
-- and waste at its locations; corrections go through count_stock.
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
      raise exception 'Production cannot post %; use count_stock to correct stock', p_type using errcode = '42501';
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

-- Correction requests are no longer used by Production (kept for history).
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
  if public.has_role('production') then
    raise exception 'Correct the stock directly with count_stock' using errcode = '42501';
  end if;
  perform public.require_role('admin');
  insert into public.stock_adjustment_requests (lot_id, location_id, quantity, reason)
  values (p_lot, p_location, p_quantity, p_reason)
  returning id into v_id;
  return v_id;
end
$$;

-- Stock count / correction: the quantity now on the shelf for a lot at a
-- location. The difference is posted as an adjustment. Production:
-- only its locations, only raw materials and packaging, reason required;
-- every admin is notified. Returns the difference (0 = nothing posted).
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
  v_prod    boolean := public.has_role('production');
  v_balance numeric;
  v_diff    numeric;
  v_item    public.items;
  v_lot     public.lots;
  v_loc     public.locations;
  v_reason  text := nullif(btrim(p_reason), '');
begin
  perform public.require_role('admin', 'production');
  if p_counted is null or p_counted < 0 then
    raise exception 'Enter the counted quantity (zero or more)';
  end if;
  select * into v_lot from public.lots where id = p_lot;
  select * into v_item from public.items where id = v_lot.item_id;
  select * into v_loc from public.locations where id = p_location;
  if v_lot.id is null or v_loc.id is null then
    raise exception 'Unknown lot or location';
  end if;
  if v_prod then
    if not public.is_production_location(p_location) then
      raise exception 'Production can only correct stock at production locations' using errcode = '42501';
    end if;
    if v_item.type not in ('raw_material', 'excipient', 'packaging') then
      raise exception 'Production corrects raw materials and packaging only' using errcode = '42501';
    end if;
    if v_reason is null then
      raise exception 'Enter the reason for the correction';
    end if;
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

  insert into public.stock_movements (type, lot_id, location_id, quantity, reason)
  values ('adjustment', p_lot, p_location, v_diff,
          case when v_prod then v_reason else 'Stock count' || coalesce(': ' || v_reason, '') end);

  if v_prod then
    perform public.notify_role('admin', 'stock_corrected', jsonb_build_object(
      'lot', v_lot.lot_number, 'sku', v_item.sku, 'item', v_item.name, 'item_bg', v_item.name_bg,
      'location', v_loc.code, 'before', v_balance, 'after', p_counted, 'diff', v_diff,
      'unit', v_item.base_unit, 'reason', v_reason), '/inventory/corrections');
  end if;
  return v_diff;
end
$$;

-- Corrections by Production, newest first (Admin)
create view public.production_corrections as
select m.id, m.created_at, m.quantity as diff, m.reason, m.lot_id, l.lot_number, m.item_id, i.sku, i.name, i.name_bg,
       i.base_unit, m.location_id, loc.code as location, m.created_by, p.full_name as created_by_name
  from public.stock_movements m
  join public.lots l on l.id = m.lot_id
  join public.items i on i.id = m.item_id
  join public.locations loc on loc.id = m.location_id
  join public.profiles p on p.id = m.created_by
 where m.type = 'adjustment' and p.role = 'production'
   and public.has_role('admin');

-- ---------------------------------------------------------------------
-- Manufacturing orders
-- ---------------------------------------------------------------------
alter table public.manufacturing_orders add column status_reason text;  -- why Admin moved it back

-- Usage reported per material: reserved (for reference) vs used
create table public.mo_material_usage (
  mo_id     uuid not null references public.manufacturing_orders (id),
  item_id   uuid not null references public.items (id),
  reserved  numeric(14, 4) not null default 0,
  used      numeric(14, 4) not null default 0,
  reason    text,
  primary key (mo_id, item_id)
);
select public.enable_audit('public.mo_material_usage');
alter table public.mo_material_usage enable row level security;
create policy mo_material_usage_select on public.mo_material_usage for select to authenticated
  using (public.has_role('admin') or (public.has_role('production') and public.mo_is_released(mo_id)));
-- Written only by complete_production.

-- Requirements: needed / free / reserved / at production / ordered.
-- Production sees released orders only, without free and requested stock.
drop function public.mo_material_requirements(uuid);
create function public.mo_material_requirements(p_mo uuid)
returns table (
  item_id uuid, sku text, name text, name_bg text, kind text, base_unit public.base_unit,
  required numeric, reserved numeric, available numeric, at_production numeric, requested numeric, ordered numeric
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_prod   boolean := public.has_role('production');
  v_status public.mo_status;
begin
  if not public.has_role('admin', 'sales', 'production') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select status into v_status from public.manufacturing_orders where id = p_mo;
  if v_status is null or (v_prod and v_status not in ('released', 'in_production', 'completed')) then
    raise exception 'Unknown manufacturing order';
  end if;
  return query
    select r.item_id, i.sku, i.name, i.name_bg, r.kind, i.base_unit, r.required,
           coalesce((select sum(sr.quantity) from public.stock_reservations sr
                      where sr.manufacturing_order_id = p_mo and sr.item_id = r.item_id and sr.status = 'active'), 0),
           case when v_prod then null
                else coalesce((select s.available from public.item_stock_summary s where s.item_id = r.item_id), 0) end,
           coalesce((select sum(b.quantity) from public.stock_balances b
                      where b.item_id = r.item_id and b.qc_status = 'released' and not b.is_expired
                        and public.is_production_location(b.location_id)), 0),
           case when v_prod then null
                else coalesce((select sum(pr.quantity) from public.purchase_requests pr
                                where pr.manufacturing_order_id = p_mo and pr.item_id = r.item_id
                                  and pr.status in ('open', 'ordered')), 0) end,
           coalesce((select sum(o.remaining) from public.expected_delivery_overview o
                       join public.purchase_requests pr on pr.id = o.purchase_request_id
                      where pr.manufacturing_order_id = p_mo and o.item_id = r.item_id and o.status = 'open'), 0)
      from public.mo_required_materials(p_mo) r
      join public.items i on i.id = r.item_id
     order by r.kind, i.name;
end
$$;

-- Send to Production: every material must be fully reserved
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
  update public.manufacturing_orders set status = 'released', released_at = now(), status_reason = null where id = p_mo;
  perform set_config('nk.mo_transition', 'off', true);
  perform public.notify_role('production', 'mo_sent',
    jsonb_build_object('code', mo.code, 'quantity', mo.quantity, 'planned_date', mo.planned_date),
    '/factory/orders/' || p_mo);
end
$$;

-- Waiting -> In production (Production, or Admin on its behalf)
create or replace function public.start_production(p_mo uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'production');
  if (select status from public.manufacturing_orders where id = p_mo) is distinct from 'released' then
    raise exception 'Only an order waiting at production can be started';
  end if;
  perform set_config('nk.mo_transition', 'on', true);
  update public.manufacturing_orders set status = 'in_production', started_at = now(), status_reason = null where id = p_mo;
  perform set_config('nk.mo_transition', 'off', true);
end
$$;

-- Admin only: one step back. In production -> Waiting, Waiting ->
-- Scheduled (taken back from Production). Ready to ship is final: the
-- ledger already holds the batch; mistakes are fixed with corrections.
create or replace function public.revert_mo_status(p_mo uuid, p_reason text)
returns public.mo_status
language plpgsql security definer set search_path = public
as $$
declare
  mo     public.manufacturing_orders;
  v_to   public.mo_status;
begin
  perform public.require_role('admin');
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Enter the reason for moving the order back';
  end if;
  select * into mo from public.manufacturing_orders where id = p_mo for update;
  v_to := case mo.status when 'in_production' then 'released' when 'released' then 'scheduled' end;
  if v_to is null then
    raise exception 'A % manufacturing order cannot be moved back', coalesce(mo.status::text, 'missing');
  end if;
  perform set_config('nk.mo_transition', 'on', true);
  update public.manufacturing_orders
     set status = v_to, status_reason = btrim(p_reason),
         started_at = case when v_to = 'released' then null else started_at end,
         released_at = case when v_to = 'scheduled' then null else released_at end
   where id = p_mo;
  perform set_config('nk.mo_transition', 'off', true);
  return v_to;
end
$$;

-- The batch report (Production, or Admin on its behalf). p_usage: jsonb
-- array of {lot_id, location_id, quantity} used; p_reasons: jsonb array
-- of {item_id, reason}. A material whose used quantity differs from the
-- reserved one by more than the tolerance (or that was not reserved)
-- needs a reason. The finished batch goes to PF-QUAR in quarantine.
drop function public.complete_production(uuid, text, integer, date, jsonb);
create function public.complete_production(
  p_mo           uuid,
  p_batch        text,
  p_quantity     integer,
  p_produced_on  date,
  p_usage        jsonb,
  p_reasons      jsonb default '[]'
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  mo        public.manufacturing_orders;
  v_prod    boolean := public.has_role('production');
  v_tol     numeric;
  c         record;
  r         record;
  res       record;
  v_item    uuid;
  v_left    numeric;
  v_reason  text;
  v_fg      uuid;
  v_lot     uuid;
  v_shelf   integer;
  v_fg_loc  uuid;
  v_over    integer := 0;
  v_project public.projects;
  v_formula public.formulas;
begin
  perform public.require_role('admin', 'production');
  select * into mo from public.manufacturing_orders where id = p_mo for update;
  if mo.status is distinct from 'in_production' then
    raise exception 'Only an order in production can be reported';
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
  if jsonb_typeof(p_usage) <> 'array' or jsonb_array_length(p_usage) = 0 then
    raise exception 'Enter the lots used';
  end if;
  select coalesce(production_variance_pct, 5) into v_tol from public.company_settings limit 1;
  v_tol := coalesce(v_tol, 5);


  -- Consumption, lot by lot (the ledger refuses unreleased, expired or missing stock)
  for c in select * from jsonb_to_recordset(p_usage) as x(lot_id uuid, location_id uuid, quantity numeric) loop
    continue when coalesce(c.quantity, 0) = 0;
    if c.quantity < 0 then
      raise exception 'Used quantities cannot be negative';
    end if;
    select item_id into v_item from public.lots where id = c.lot_id;
    if v_item is null or not exists (select 1 from public.mo_required_materials(p_mo) q where q.item_id = v_item) then
      raise exception 'A used lot is not one of the materials of this order';
    end if;
    if v_prod and not public.is_production_location(c.location_id) then
      raise exception 'Production can only use stock at production locations' using errcode = '42501';
    end if;
    insert into public.stock_movements (type, lot_id, location_id, quantity, project_id, reference, manufacturing_order_id)
    values ('consumption', c.lot_id, c.location_id, -c.quantity, mo.project_id, mo.code, p_mo);
  end loop;

  -- Reserved vs used per material; reasons over the tolerance
  for r in
    with req as (select q.item_id from public.mo_required_materials(p_mo) q),
    rsv as (select sr.item_id, sum(sr.quantity) as reserved from public.stock_reservations sr
             where sr.manufacturing_order_id = p_mo and sr.status = 'active' group by sr.item_id),
    use as (select m.item_id, -sum(m.quantity) as used from public.stock_movements m
             where m.manufacturing_order_id = p_mo and m.type = 'consumption' group by m.item_id)
    select k.item_id, coalesce(rsv.reserved, 0) as reserved, coalesce(use.used, 0) as used
      from (select item_id from req union select item_id from rsv union select item_id from use) k
      left join rsv on rsv.item_id = k.item_id
      left join use on use.item_id = k.item_id
  loop
    select nullif(btrim(x.reason), '') into v_reason
      from jsonb_to_recordset(coalesce(p_reasons, '[]')) as x(item_id uuid, reason text)
     where x.item_id = r.item_id limit 1;
    if (r.reserved = 0 and r.used > 0)
       or (r.reserved > 0 and abs(r.used - r.reserved) / r.reserved * 100 > v_tol) then
      v_over := v_over + 1;
      if v_reason is null then
        raise exception 'Enter a reason for %: used % against % reserved',
          (select name from public.items where id = r.item_id), round(r.used, 4), round(r.reserved, 4);
      end if;
    end if;
    insert into public.mo_material_usage (mo_id, item_id, reserved, used, reason)
    values (p_mo, r.item_id, r.reserved, r.used, v_reason);

    -- The used part of the reservations is consumed, the rest released
    v_left := r.used;
    for res in select * from public.stock_reservations
                where manufacturing_order_id = p_mo and item_id = r.item_id and status = 'active'
                order by created_at for update loop
      if v_left >= res.quantity then
        update public.stock_reservations set status = 'consumed', closed_by = auth.uid(), closed_at = now() where id = res.id;
        v_left := v_left - res.quantity;
      elsif v_left > 0 then
        insert into public.stock_reservations (item_id, lot_id, location_id, project_id, manufacturing_order_id, quantity,
                                               status, note, reserved_by, created_at, closed_by, closed_at)
        values (res.item_id, res.lot_id, res.location_id, res.project_id, p_mo, res.quantity - v_left,
                'released', 'Not used in ' || mo.code, res.reserved_by, res.created_at, auth.uid(), now());
        update public.stock_reservations set quantity = v_left, status = 'consumed', closed_by = auth.uid(), closed_at = now()
         where id = res.id;
        v_left := 0;
      else
        update public.stock_reservations set status = 'released', closed_by = auth.uid(), closed_at = now() where id = res.id;
      end if;
    end loop;
  end loop;

  -- Finished-goods item of the project (created on the first batch)
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

  select id into v_fg_loc from public.locations where code = 'PF-QUAR' and is_active;
  if v_fg_loc is null then
    raise exception 'Location PF-QUAR (production quarantine) is missing';
  end if;

  -- New lots start in quarantine; only Admin releases them
  insert into public.lots (lot_number, item_id, manufactured_on, expires_on, received_on, project_id, notes)
  values (btrim(p_batch), v_fg, coalesce(p_produced_on, current_date),
          (coalesce(p_produced_on, current_date) + make_interval(months => coalesce(v_shelf, 24)))::date,
          coalesce(p_produced_on, current_date), mo.project_id, 'Production ' || mo.code)
  returning id into v_lot;

  insert into public.stock_movements (type, lot_id, location_id, quantity, project_id, reference, manufacturing_order_id)
  values ('production_output', v_lot, v_fg_loc, p_quantity, mo.project_id, mo.code, p_mo);

  perform set_config('nk.mo_transition', 'on', true);
  update public.manufacturing_orders
     set status = 'completed', completed_at = now(), batch_number = btrim(p_batch), produced_quantity = p_quantity,
         produced_on = coalesce(p_produced_on, current_date), finished_lot_id = v_lot,
         started_at = coalesce(started_at, now()), status_reason = null
   where id = p_mo;
  perform set_config('nk.mo_transition', 'off', true);

  perform public.update_batch_cost(p_mo);
  perform public.notify_role('admin', 'mo_completed', jsonb_build_object(
    'code', mo.code, 'batch', btrim(p_batch), 'quantity', p_quantity, 'over', v_over), '/production/' || p_mo);
  return v_lot;
end
$$;

-- The production settings for the portal screens (Production cannot read company_settings)
create or replace function public.production_settings()
returns table (variance_pct numeric, require_waybill_photo boolean)
language sql stable security definer set search_path = public
as $q$
  select coalesce(c.production_variance_pct, 5), coalesce(c.require_waybill_photo, true)
    from (select 1) one
    left join public.company_settings c on true
   where public.current_app_role() is not null
   limit 1
$q$;

-- Reserved vs used per material. The value of the difference is shown
-- only to users who see purchase prices (Admin); Production gets null.
create or replace function public.mo_usage_report(p_mo uuid)
returns table (
  item_id uuid, sku text, name text, name_bg text, base_unit public.base_unit,
  reserved numeric, used numeric, diff numeric, diff_pct numeric, over_limit boolean, reason text, diff_value numeric
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_prices boolean := public.has_role('admin') or public.can_see_purchase_prices();
  v_tol    numeric;
begin
  if not (public.has_role('admin') or (public.has_role('production') and public.mo_is_released(p_mo))) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select coalesce(production_variance_pct, 5) into v_tol from public.company_settings limit 1;
  v_tol := coalesce(v_tol, 5);
  return query
    select u.item_id, i.sku, i.name, i.name_bg, i.base_unit, u.reserved, u.used, u.used - u.reserved,
           case when u.reserved > 0 then round((u.used - u.reserved) / u.reserved * 100, 2) end,
           (u.reserved = 0 and u.used > 0) or (u.reserved > 0 and abs(u.used - u.reserved) / u.reserved * 100 > v_tol),
           u.reason,
           case when v_prices then round((u.used - u.reserved) * coalesce(
             (select sum(-m.quantity * lc.unit_cost) / nullif(sum(-m.quantity), 0)
                from public.stock_movements m join public.lot_costs lc on lc.lot_id = m.lot_id
               where m.manufacturing_order_id = p_mo and m.type = 'consumption' and m.item_id = u.item_id),
             public.item_unit_price(u.item_id, 0)), 2) end
      from public.mo_material_usage u join public.items i on i.id = u.item_id
     where u.mo_id = p_mo
     order by i.type, i.name;
end
$$;

-- Per material of an order: where it comes from, with supplier, quantity,
-- unit purchase price and date. Deliveries ordered for the order, and
-- lots at the production locations. Admin and Production (released
-- orders); never client names or sales prices.
create or replace function public.mo_material_sources(p_mo uuid)
returns table (
  item_id uuid, source text, delivery_id uuid, delivery_code text, lot_id uuid, lot_number text,
  supplier text, quantity numeric, unit_price numeric, currency char(3), on_date date, status text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (public.has_role('admin') or (public.has_role('production') and public.mo_is_released(p_mo))) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    with req as (select q.item_id from public.mo_required_materials(p_mo) q)
    select d.item_id, 'delivery'::text, d.id, d.code, null::uuid, null::text, s.name::text, d.quantity, d.unit_price,
           d.currency, coalesce(d.closed_at::date, d.expected_on), d.status::text
      from public.expected_deliveries d
      join public.purchase_requests pr on pr.id = d.purchase_request_id and pr.manufacturing_order_id = p_mo
      left join public.suppliers s on s.id = d.supplier_id
     where d.status <> 'cancelled'
    union all
    select b.item_id, 'stock', l.expected_delivery_id, null, l.id, l.lot_number, s.name::text, sum(b.quantity),
           lc.unit_cost, coalesce(lc.currency, 'EUR'), l.received_on, l.qc_status::text
      from public.stock_balances b
      join req on req.item_id = b.item_id
      join public.lots l on l.id = b.lot_id
      left join public.suppliers s on s.id = l.supplier_id
      left join public.lot_costs lc on lc.lot_id = l.id
     where public.is_production_location(b.location_id) and b.quantity > 0
     group by b.item_id, l.expected_delivery_id, l.id, l.lot_number, s.name, lc.unit_cost, lc.currency, l.received_on, l.qc_status
     order by 1, 2, 11;
end
$$;

-- Order a missing material from the order screen: a purchase request
-- and an expected delivery in one step (Admin).
create or replace function public.order_mo_material(
  p_mo           uuid,
  p_item         uuid,
  p_quantity     numeric,
  p_supplier     uuid    default null,
  p_unit_price   numeric default null,
  p_expected_on  date    default null,
  p_location     uuid    default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  mo     public.manufacturing_orders;
  v_req  uuid;
begin
  perform public.require_role('admin');
  select * into mo from public.manufacturing_orders where id = p_mo;
  if mo.id is null or mo.status in ('completed', 'cancelled') then
    raise exception 'This manufacturing order is closed';
  end if;
  if not exists (select 1 from public.mo_required_materials(p_mo) q where q.item_id = p_item) then
    raise exception 'This item is not a material of the order';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive';
  end if;
  insert into public.purchase_requests (item_id, quantity, needed_by, manufacturing_order_id, note)
  values (p_item, p_quantity, mo.planned_date, p_mo, 'Production ' || mo.code)
  returning id into v_req;
  return public.create_expected_delivery(
    p_item, p_quantity, p_supplier, p_expected_on, p_unit_price, null,
    coalesce(p_location, (select id from public.locations where code = 'PF-QUAR')), v_req, 'Production ' || mo.code);
end
$$;

-- Production sees its orders by project code only (no client, no prices)
create or replace view public.production_manufacturing_orders as
select mo.id, mo.code, p.code as project_code, f.name as product, f.name_bg as product_bg, f.product_format,
       f.serving_size, f.serving_unit, f.servings_per_pack, mo.quantity, mo.planned_date, mo.status,
       mo.batch_number, mo.produced_quantity, mo.produced_on, mo.released_at, mo.started_at, mo.completed_at
  from public.manufacturing_orders mo
  join public.projects p on p.id = mo.project_id
  join public.formula_versions v on v.id = mo.formula_version_id
  join public.formulas f on f.id = v.formula_id
 where mo.status in ('released', 'in_production', 'completed')
   and public.has_role('admin', 'production');

-- ---------------------------------------------------------------------
-- Expected deliveries: Admin edits terms; Production receives
-- ---------------------------------------------------------------------

-- As before, plus: Admin may change supplier, quantity and price of a
-- received delivery through update_delivery_terms.
create or replace function public.expected_deliveries_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.code is null or new.code = '' then
      new.code := public.next_number('delivery');
    end if;
    if new.status <> 'open' then
      raise exception 'A new delivery starts open';
    end if;
    return new;
  end if;

  if old.status <> 'open' and coalesce(current_setting('nutrikal.delivery_terms', true), '') <> 'on' then
    raise exception 'Delivery % is %; it cannot be changed', old.code, old.status;
  end if;
  if new.item_id is distinct from old.item_id or new.code is distinct from old.code
     or new.purchase_request_id is distinct from old.purchase_request_id then
    raise exception 'Item, code and purchase request of a delivery cannot be changed';
  end if;
  if new.status is distinct from old.status
     and coalesce(current_setting('nutrikal.delivery_fn', true), '') <> 'on' then
    raise exception 'Use receive_expected_delivery or cancel_expected_delivery to close a delivery';
  end if;
  return new;
end
$$;

-- Admin: supplier, ordered quantity and unit price of a delivery. On a
-- received delivery the lots follow (supplier and cost). Logged in the
-- audit history like every change.
create or replace function public.update_delivery_terms(
  p_delivery    uuid,
  p_supplier    uuid,
  p_quantity    numeric,
  p_unit_price  numeric
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  d   public.expected_deliveries;
  l   record;
begin
  perform public.require_role('admin');
  select * into d from public.expected_deliveries where id = p_delivery for update;
  if not found or d.status = 'cancelled' then
    raise exception 'Delivery % not found', p_delivery;
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive';
  end if;
  if p_unit_price is not null and p_unit_price < 0 then
    raise exception 'Price cannot be negative';
  end if;
  perform set_config('nutrikal.delivery_terms', 'on', true);
  update public.expected_deliveries
     set supplier_id = p_supplier, quantity = p_quantity, unit_price = p_unit_price
   where id = d.id;
  perform set_config('nutrikal.delivery_terms', '', true);
  for l in select id from public.lots where expected_delivery_id = d.id loop
    update public.lots set supplier_id = p_supplier where id = l.id;
    if p_unit_price is not null and d.currency = 'EUR' then
      perform public.set_lot_cost(l.id, p_unit_price);
    end if;
  end loop;
end
$$;

-- Photos and documents of a delivery (bucket "delivery-docs", path
-- {delivery_id}/{uuid}.{ext}). A receipt links the files uploaded for it
-- to the lot it creates.
create table public.delivery_attachments (
  id            uuid primary key default gen_random_uuid(),
  delivery_id   uuid not null references public.expected_deliveries (id),
  lot_id        uuid references public.lots (id),
  storage_path  text not null unique,
  kind          text not null default 'waybill' check (kind in ('waybill', 'coa', 'other')),
  file_name     text,
  content_type  text,
  size_bytes    integer,
  note          text,
  uploaded_by   uuid not null default auth.uid() references public.profiles (id),
  uploaded_at   timestamptz not null default now(),
  constraint delivery_attachments_path_chk check (storage_path like delivery_id::text || '/%')
);
create index delivery_attachments_delivery_idx on public.delivery_attachments (delivery_id);
create index delivery_attachments_lot_idx on public.delivery_attachments (lot_id);
select public.enable_audit('public.delivery_attachments');

-- Who may see / add files of a delivery
create or replace function public.can_access_delivery(p_delivery uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_role('admin')
      or (public.has_role('production') and coalesce(
            (select public.is_production_location(d.location_id) from public.expected_deliveries d where d.id = p_delivery),
            false))
$$;

alter table public.delivery_attachments enable row level security;
create policy delivery_attachments_select on public.delivery_attachments for select to authenticated
  using (public.can_access_delivery(delivery_id));
create policy delivery_attachments_insert on public.delivery_attachments for insert to authenticated
  with check (public.can_access_delivery(delivery_id) and uploaded_by = auth.uid() and lot_id is null);
-- Production removes its own files within 24 hours; nobody else deletes
create policy delivery_attachments_delete on public.delivery_attachments for delete to authenticated
  using (public.has_role('production') and uploaded_by = auth.uid() and uploaded_at > now() - interval '24 hours');

-- Deliveries to the production locations, for Production: supplier,
-- quantities and dates; no prices.
create view public.production_deliveries as
select d.id, d.code, d.item_id, i.sku, i.name, i.name_bg, i.base_unit, s.name as supplier, d.quantity,
       coalesce(r.received, 0) as received, greatest(d.quantity - coalesce(r.received, 0), 0) as remaining,
       d.expected_on, d.status, (d.status = 'open' and d.expected_on < current_date) as is_overdue,
       (d.status = 'open' and coalesce(r.received, 0) > 0) as is_partial, d.location_id, loc.code as location,
       d.closed_at, d.created_at,
       (select count(*)::int from public.delivery_attachments a where a.delivery_id = d.id) as attachments
  from public.expected_deliveries d
  join public.items i on i.id = d.item_id
  join public.locations loc on loc.id = d.location_id
  left join public.suppliers s on s.id = d.supplier_id
  left join lateral (
    select sum(m.quantity) as received
      from public.lots l
      join public.stock_movements m on m.lot_id = l.id and m.type = 'receipt'
     where l.expected_delivery_id = d.id
  ) r on true
 where d.status <> 'cancelled'
   and public.is_production_location(d.location_id)
   and public.has_role('admin', 'production');

-- As before, plus: Production is told about deliveries to its locations
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
  v_code text;
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
  returning id, code into v_id, v_code;

  if p_purchase_request is not null then
    update public.purchase_requests set status = 'ordered' where id = p_purchase_request and status = 'open';
  end if;

  if p_location is not null and public.is_production_location(p_location) then
    perform public.notify_role('production', 'delivery_ordered', jsonb_build_object(
      'code', v_code, 'sku', (select sku from public.items where id = p_item),
      'item', (select name from public.items where id = p_item), 'item_bg', (select name_bg from public.items where id = p_item),
      'quantity', p_quantity, 'unit', (select base_unit from public.items where id = p_item), 'expected_on', p_expected_on),
      '/factory/deliveries/' || v_id);
  end if;
  return v_id;
end
$$;

-- Receive (part of) a delivery: a new lot in quarantine linked to the
-- delivery, at the delivery's price when it has one. Production receives
-- deliveries to its locations, always into PF-QUAR. When the waybill
-- rule is on, a waybill photo uploaded for this receipt is required; the
-- files are linked to the new lot. Admins are notified of receipts by
-- Production. The delivery closes when everything has arrived, or
-- earlier with p_close (the rest will not come). Returns the new lot.
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
  v_prod     boolean := public.has_role('production');
  v_location uuid := p_location;
  v_lot      uuid;
  v_received numeric;
  v_photos   integer;
  v_closed   boolean := false;
begin
  perform public.require_role('admin', 'production');

  select * into d from public.expected_deliveries where id = p_delivery for update;
  if not found or (v_prod and not public.can_access_delivery(p_delivery)) then
    raise exception 'Delivery % not found', p_delivery;
  end if;
  if d.status <> 'open' then
    raise exception 'Delivery % is %', d.code, d.status;
  end if;
  if v_prod then
    select id into v_location from public.locations where code = 'PF-QUAR' and is_active;
    if v_location is null then
      raise exception 'Location PF-QUAR (production quarantine) is missing';
    end if;
  end if;

  select count(*) into v_photos from public.delivery_attachments
   where delivery_id = d.id and lot_id is null and kind = 'waybill';
  if v_photos = 0 and coalesce((select require_waybill_photo from public.company_settings limit 1), true) then
    raise exception 'Add at least one photo of the waybill';
  end if;

  v_lot := public.receive_lot(d.item_id, coalesce(v_location, d.location_id), p_quantity, d.supplier_id,
                              p_supplier_lot, p_manufactured_on, p_expires_on, null,
                              coalesce(nullif(btrim(p_reference), ''), d.po_reference, d.code), null);
  update public.lots set expected_delivery_id = d.id where id = v_lot;
  select count(*) into v_photos from public.delivery_attachments where delivery_id = d.id and lot_id is null;
  update public.delivery_attachments set lot_id = v_lot where delivery_id = d.id and lot_id is null;

  -- The delivery's price becomes the lot cost (written here, so that
  -- Production can receive without the right to set costs)
  if d.unit_price is not null and d.currency = 'EUR' then
    insert into public.lot_costs (lot_id, unit_cost, source, updated_by, updated_at)
    values (v_lot, d.unit_price, 'receipt', auth.uid(), now())
    on conflict (lot_id) do update
      set unit_cost = excluded.unit_cost, source = 'receipt', updated_by = auth.uid(), updated_at = now();
  end if;

  select coalesce(sum(m.quantity), 0) into v_received
    from public.lots l
    join public.stock_movements m on m.lot_id = l.id and m.type = 'receipt'
   where l.expected_delivery_id = d.id;

  if v_received >= d.quantity or p_close then
    v_closed := true;
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

  if v_prod then
    perform public.notify_role('admin', 'delivery_received', jsonb_build_object(
      'code', d.code, 'lot', (select lot_number from public.lots where id = v_lot),
      'sku', (select sku from public.items where id = d.item_id),
      'item', (select name from public.items where id = d.item_id),
      'item_bg', (select name_bg from public.items where id = d.item_id),
      'quantity', p_quantity, 'unit', (select base_unit from public.items where id = d.item_id),
      'photos', v_photos, 'closed', v_closed), '/deliveries?open=' || d.id);
  end if;

  return v_lot;
end
$$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke all on public.production_corrections, public.production_deliveries from anon;
grant select on public.production_corrections, public.production_deliveries to authenticated;
revoke all on public.production_manufacturing_orders from anon;
grant select on public.production_manufacturing_orders to authenticated;

revoke execute on function
  public.mo_material_requirements(uuid),
  public.complete_production(uuid, text, integer, date, jsonb, jsonb),
  public.revert_mo_status(uuid, text),
  public.mo_usage_report(uuid),
  public.mo_material_sources(uuid),
  public.order_mo_material(uuid, uuid, numeric, uuid, numeric, date, uuid),
  public.update_delivery_terms(uuid, uuid, numeric, numeric),
  public.can_access_delivery(uuid),
  public.production_settings()
from public, anon;

grant execute on function
  public.mo_material_requirements(uuid),
  public.complete_production(uuid, text, integer, date, jsonb, jsonb),
  public.revert_mo_status(uuid, text),
  public.mo_usage_report(uuid),
  public.mo_material_sources(uuid),
  public.order_mo_material(uuid, uuid, numeric, uuid, numeric, date, uuid),
  public.update_delivery_terms(uuid, uuid, numeric, numeric),
  public.can_access_delivery(uuid),
  public.production_settings()
to authenticated;
