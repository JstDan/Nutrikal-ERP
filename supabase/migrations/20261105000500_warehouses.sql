-- Warehouses (owner, Nov 2026): four stores only.
--   NK-WH  Nutrikal
--   G-PRO  Производство (G-PRO)   the partner facility; the default store:
--          new purchase orders, deliveries and moves for production go here
--   FG     Готова продукция       a reported batch goes here by itself
--   FULFIL Фулфилмънт             own products at the fulfilment centre
-- The production sub-stores (quarantine, raw materials, packaging) are closed:
-- their stock moves to G-PRO (finished goods to FG) through the ledger, and the
-- rows stay inactive, since past movements point at them. QC stays per lot.

update public.locations set name = 'Nutrikal' where code = 'NK-WH';
update public.locations set code = 'G-PRO', name = 'Производство (G-PRO)' where code = 'PF';
update public.locations set code = 'FG', name = 'Готова продукция', parent_id = null where code = 'PF-FG';
insert into public.locations (code, name, type, is_partner_visible)
values ('FULFIL', 'Фулфилмънт', 'warehouse', false)
on conflict (code) do nothing;

-- Stock of the closed sub-stores, lot by lot, as paired transfers
do $$
declare
  v_pro uuid := (select id from public.locations where code = 'G-PRO');
  v_fg  uuid := (select id from public.locations where code = 'FG');
  v_to  uuid;
  v_grp uuid;
  b     record;
begin
  for b in
    select m.lot_id, m.location_id, i.type, sum(m.quantity) as q
      from public.stock_movements m
      join public.locations l on l.id = m.location_id
      join public.items i on i.id = m.item_id
     where l.code in ('PF-QUAR', 'PF-RM', 'PF-PACK')
     group by m.lot_id, m.location_id, i.type
    having sum(m.quantity) > 0
  loop
    v_to := case when b.type = 'finished_good' then v_fg else v_pro end;
    v_grp := gen_random_uuid();
    insert into public.stock_movements (movement_group, type, lot_id, location_id, quantity, reason, reference)
    values (v_grp, 'transfer_out', b.lot_id, b.location_id, -b.q, 'Warehouses merged', 'WAREHOUSES'),
           (v_grp, 'transfer_in',  b.lot_id, v_to,          b.q, 'Warehouses merged', 'WAREHOUSES');
  end loop;

  -- Open references to the closed stores follow the stock
  update public.stock_reservations r set location_id = case when i.type = 'finished_good' then v_fg else v_pro end
    from public.items i, public.locations l
   where i.id = r.item_id and l.id = r.location_id and r.status = 'active'
     and l.code in ('PF-QUAR', 'PF-RM', 'PF-PACK');
  update public.expected_deliveries d set location_id = v_pro
    from public.locations l
   where l.id = d.location_id and d.status = 'open' and l.code in ('PF-QUAR', 'PF-RM', 'PF-PACK');
  update public.purchase_orders p set location_id = v_pro
    from public.locations l
   where l.id = p.location_id and p.status in ('draft', 'sent') and l.code in ('PF-QUAR', 'PF-RM', 'PF-PACK');
end $$;

update public.locations set is_active = false where code in ('PF-QUAR', 'PF-RM', 'PF-PACK');

-- New purchase orders go to production unless another store is chosen
create or replace function public.generate_purchase_orders(p_lines jsonb, p_location uuid default null::uuid)
 returns uuid[]
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r        jsonb;
  v_sup    uuid;
  v_po     uuid;
  v_out    uuid[] := '{}';
  v_loc    uuid := coalesce(p_location, (select id from public.locations where code = 'G-PRO'));
  v_n      integer;
begin
  perform public.require_role('admin');
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Choose at least one line';
  end if;
  for r in select * from jsonb_array_elements(p_lines) loop
    if nullif(r ->> 'supplier_id', '') is null then
      raise exception 'Choose a supplier for every chosen line';
    end if;
    if coalesce((r ->> 'quantity')::numeric, 0) <= 0 then
      raise exception 'Quantity must be positive';
    end if;
  end loop;

  for v_sup in select distinct (x ->> 'supplier_id')::uuid from jsonb_array_elements(p_lines) x loop
    insert into public.purchase_orders (supplier_id, location_id) values (v_sup, v_loc) returning id into v_po;
    v_out := v_out || v_po;
    v_n := 0;
    for r in select x from jsonb_array_elements(p_lines) x where (x ->> 'supplier_id')::uuid = v_sup loop
      v_n := v_n + 1;
      insert into public.purchase_order_lines (purchase_order_id, item_id, quantity, unit_price, purchase_request_id, sort_order)
      values (v_po, (r ->> 'item_id')::uuid, (r ->> 'quantity')::numeric, nullif(r ->> 'unit_price', '')::numeric,
              nullif(r ->> 'purchase_request_id', '')::uuid, v_n);
    end loop;
  end loop;
  return v_out;
end
$function$;

-- Move to production: everything goes to G-PRO
create or replace function public.move_mo_materials_to_production(p_mo uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  mo      public.manufacturing_orders;
  q       record;
  b       record;
  v_need  numeric;
  v_qty   numeric;
  v_to    uuid := (select id from public.locations where code = 'G-PRO' and is_active);
  v_n     integer := 0;
begin
  perform public.require_role('admin');
  select * into mo from public.manufacturing_orders where id = p_mo;
  if not found then
    raise exception 'Unknown manufacturing order';
  end if;
  if mo.status not in ('simulation', 'scheduled', 'released', 'in_production') then
    raise exception 'Materials cannot be moved for a % manufacturing order', mo.status;
  end if;
  if v_to is null then
    raise exception 'Location G-PRO (production) is missing';
  end if;

  for q in select r.item_id, r.required from public.mo_required_materials(p_mo) r loop
    -- What is at production serves the other open batches first
    v_need := least(q.required,
                    q.required
                    + coalesce((select sum(x.required) from public.manufacturing_orders o2
                                  cross join lateral public.mo_required_materials(o2.id) x
                                 where o2.id <> p_mo and o2.status in ('scheduled', 'released', 'in_production') and x.item_id = q.item_id), 0)
                    - coalesce((select sum(s.quantity) from public.stock_balances s
                                 where s.item_id = q.item_id and s.qc_status = 'released' and not s.is_expired
                                   and public.is_production_location(s.location_id)), 0));
    continue when v_need <= 0;
    for b in select s.lot_id, s.location_id, s.quantity from public.stock_balances s
              where s.item_id = q.item_id and s.qc_status = 'released' and not s.is_expired and s.quantity > 0
                and not public.is_production_location(s.location_id)
              order by s.expires_on nulls last, s.lot_number loop
      exit when v_need <= 0;
      v_qty := least(v_need, b.quantity);
      perform public.transfer_stock(b.lot_id, b.location_id, v_to, v_qty, 'For production ' || mo.code, mo.code);
      v_need := v_need - v_qty;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end
$function$;

-- Material ordered for a batch is delivered to production by default
create or replace function public.order_mo_material(p_mo uuid, p_item uuid, p_quantity numeric, p_supplier uuid default null::uuid, p_unit_price numeric default null::numeric, p_expected_on date default null::date, p_location uuid default null::uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    coalesce(p_location, (select id from public.locations where code = 'G-PRO')), v_req, 'Production ' || mo.code);
end
$function$;

-- Production receives its deliveries into G-PRO
create or replace function public.receive_expected_delivery(p_delivery uuid, p_location uuid, p_quantity numeric, p_supplier_lot text default null::text, p_manufactured_on date default null::date, p_expires_on date default null::date, p_reference text default null::text, p_close boolean default false)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    select id into v_location from public.locations where code = 'G-PRO' and is_active;
    if v_location is null then
      raise exception 'Location G-PRO (production) is missing';
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
$function$;

-- A reported batch goes to Готова продукция (FG), in quarantine until Admin releases it
create or replace function public.complete_production(p_mo uuid, p_batch text, p_quantity integer, p_produced_on date, p_usage jsonb, p_reasons jsonb default '[]'::jsonb, p_expires_on date default null::date)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  v_expiry  date;
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

  select id into v_fg_loc from public.locations where code = 'FG' and is_active;
  if v_fg_loc is null then
    raise exception 'Location FG (finished goods) is missing';
  end if;

  -- The expiry date is entered with the batch; otherwise it comes from a known
  -- shelf life. Never a guess: without either the batch cannot be reported.
  v_shelf := coalesce(v_shelf, (select shelf_life_months from public.items where id = v_fg));
  v_expiry := coalesce(p_expires_on,
    case when v_shelf is not null then (coalesce(p_produced_on, current_date) + make_interval(months => v_shelf))::date end);
  if v_expiry is null then
    raise exception 'Enter the expiry date of the batch';
  end if;
  if v_expiry <= coalesce(p_produced_on, current_date) then
    raise exception 'The expiry date must be after the production date';
  end if;

  -- A finished batch waits in quarantine: only Admin releases it, with its COA
  insert into public.lots (lot_number, item_id, manufactured_on, expires_on, received_on, project_id, notes, qc_status)
  values (btrim(p_batch), v_fg, coalesce(p_produced_on, current_date), v_expiry,
          coalesce(p_produced_on, current_date), mo.project_id, 'Production ' || mo.code, 'quarantine')
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
$function$;
