-- =====================================================================
-- Nutrikal ERP + CRM — Phase 3 — 0012 manufacturing
-- Nutrikal plans what to produce; the partner facility produces it.
--
-- Flow of a manufacturing order (MO-00001)
--   simulation  → check materials, optionally reserve, raise purchase
--                 requests for what is missing
--   scheduled   → planned date set; materials are reserved
--   released    → sent to the partner (all materials must be reserved)
--   in_production → the partner has started
--   completed   → the partner reports the lots consumed, the quantity
--                 made and its batch number; a finished-goods lot is
--                 created in quarantine at the partner (QC by Admin)
--   cancelled   → reservations are released
--
-- Rules
-- * Status changes only through the functions below.
-- * Quantity, formula and project change only in simulation.
-- * The partner sees released orders by project code only, the
--   materials they need and the stock at the facility; no clients,
--   prices or suppliers. The partner enters its invoice per batch.
--
--                         admin   sales     inventory   partner
-- manufacturing orders    all     simulate  all         released only (view)
-- purchase requests       all     create    all         —
-- production invoices     all     —         read        own, for released orders
-- =====================================================================

create type public.mo_status as enum ('simulation', 'scheduled', 'released', 'in_production', 'completed', 'cancelled');
create type public.purchase_request_status as enum ('open', 'ordered', 'received', 'cancelled');

insert into public.number_series (key, label, prefix, next_number, pad_length)
values ('purchase_request', 'Purchase requests', 'PR-', 1, 5)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Manufacturing orders
-- ---------------------------------------------------------------------
create table public.manufacturing_orders (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,                             -- e.g. MO-00001
  formula_version_id   uuid not null references public.formula_versions (id),
  project_id           uuid references public.projects (id),             -- required from scheduling on
  sales_order_line_id  uuid references public.sales_order_lines (id),
  quantity             integer not null check (quantity > 0),             -- packs
  planned_date         date,
  status               public.mo_status not null default 'simulation',
  batch_number         text,                                              -- given by the partner
  produced_quantity    integer check (produced_quantity > 0),
  produced_on          date,
  finished_lot_id      uuid references public.lots (id),
  notes                text,
  released_at          timestamptz,
  started_at           timestamptz,
  completed_at         timestamptz,
  created_by           uuid default auth.uid() references public.profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index manufacturing_orders_status_idx  on public.manufacturing_orders (status, planned_date);
create index manufacturing_orders_project_idx on public.manufacturing_orders (project_id);
create index manufacturing_orders_line_idx    on public.manufacturing_orders (sales_order_line_id);

create trigger manufacturing_orders_updated_at before update on public.manufacturing_orders
  for each row execute function public.set_updated_at();
select public.enable_audit('public.manufacturing_orders');

-- Packaging per pack (copied from the offer when planned from an order)
create table public.mo_packaging (
  id            uuid primary key default gen_random_uuid(),
  mo_id         uuid not null references public.manufacturing_orders (id) on delete cascade,
  item_id       uuid not null references public.items (id),
  qty_per_pack  numeric(12, 4) not null default 1 check (qty_per_pack > 0),
  unique (mo_id, item_id)
);
select public.enable_audit('public.mo_packaging');

-- Reservations can belong to a manufacturing order; the project is then optional
alter table public.stock_reservations
  add column manufacturing_order_id uuid references public.manufacturing_orders (id);
alter table public.stock_reservations alter column project_id drop not null;
alter table public.stock_reservations
  add constraint stock_reservations_owner_chk check (project_id is not null or manufacturing_order_id is not null);
create index stock_reservations_mo_idx on public.stock_reservations (manufacturing_order_id) where status = 'active';

-- The partner's invoice for a batch (actual production cost)
create table public.production_invoices (
  id              uuid primary key default gen_random_uuid(),
  mo_id           uuid not null references public.manufacturing_orders (id),
  invoice_number  text not null,
  invoice_date    date not null,
  amount          numeric(14, 2) not null check (amount >= 0),
  currency        char(3) not null default 'EUR',
  notes           text,
  entered_by      uuid default auth.uid() references public.profiles (id),
  created_at      timestamptz not null default now()
);
create index production_invoices_mo_idx on public.production_invoices (mo_id);
select public.enable_audit('public.production_invoices');

-- Purchase requests for missing materials (purchase orders follow later)
create table public.purchase_requests (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null unique,                       -- e.g. PR-00001
  item_id                 uuid not null references public.items (id),
  quantity                numeric(14, 4) not null check (quantity > 0), -- base unit
  needed_by               date,
  manufacturing_order_id  uuid references public.manufacturing_orders (id),
  status                  public.purchase_request_status not null default 'open',
  note                    text,
  created_by              uuid default auth.uid() references public.profiles (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index purchase_requests_status_idx on public.purchase_requests (status);
create index purchase_requests_mo_idx     on public.purchase_requests (manufacturing_order_id);
create trigger purchase_requests_updated_at before update on public.purchase_requests
  for each row execute function public.set_updated_at();
select public.enable_audit('public.purchase_requests');

create or replace function public.purchase_requests_defaults()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.code is null or new.code = '' then
    new.code := public.next_number('purchase_request');
  end if;
  return new;
end
$$;
create trigger purchase_requests_defaults before insert on public.purchase_requests
  for each row execute function public.purchase_requests_defaults();

-- ---------------------------------------------------------------------
-- Triggers on manufacturing orders
-- ---------------------------------------------------------------------
create or replace function public.manufacturing_orders_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_status   public.formula_status;
  v_fclient  uuid;
  v_servings integer;
begin
  if tg_op = 'INSERT' then
    if new.code is null or new.code = '' then
      new.code := public.next_number('production');
    end if;
    if new.status <> 'simulation' then
      raise exception 'A manufacturing order starts as a simulation';
    end if;
    if new.sales_order_line_id is not null then
      select project_id, formula_version_id into new.project_id, new.formula_version_id
        from public.sales_order_lines where id = new.sales_order_line_id;
    end if;
  else
    if new.status <> old.status and current_setting('nk.mo_transition', true) is distinct from 'on' then
      raise exception 'Use the production actions to change the status';
    end if;
    if old.status <> 'simulation'
       and (new.quantity, new.formula_version_id, new.project_id, new.sales_order_line_id)
           is distinct from (old.quantity, old.formula_version_id, old.project_id, old.sales_order_line_id) then
      raise exception 'Quantity, formula and project change only in simulation';
    end if;
    if old.status in ('completed', 'cancelled') and new.planned_date is distinct from old.planned_date then
      raise exception 'This manufacturing order is closed';
    end if;
  end if;

  if tg_op = 'INSERT' or new.formula_version_id <> old.formula_version_id or new.project_id is distinct from old.project_id then
    select v.status, f.client_id, f.servings_per_pack into v_status, v_fclient, v_servings
      from public.formula_versions v join public.formulas f on f.id = v.formula_id
     where v.id = new.formula_version_id;
    if v_status is distinct from 'approved' then
      raise exception 'Production needs an approved formula version';
    end if;
    if v_servings is null then
      raise exception 'Set the servings per pack on the formula first';
    end if;
    if v_fclient is not null and new.project_id is not null
       and v_fclient <> (select client_id from public.projects where id = new.project_id) then
      raise exception 'This formula belongs to another client';
    end if;
  end if;
  return new;
end
$$;

create trigger manufacturing_orders_guard before insert or update on public.manufacturing_orders
  for each row execute function public.manufacturing_orders_guard();

-- Packaging from the offer of the order line
create or replace function public.manufacturing_orders_packaging()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.sales_order_line_id is not null then
    insert into public.mo_packaging (mo_id, item_id, qty_per_pack)
    select new.id, op.item_id, op.qty_per_pack
      from public.sales_order_lines l join public.offer_packaging op on op.offer_id = l.offer_id
     where l.id = new.sales_order_line_id
    on conflict do nothing;
  end if;
  return null;
end
$$;

create trigger manufacturing_orders_packaging after insert on public.manufacturing_orders
  for each row execute function public.manufacturing_orders_packaging();

create or replace function public.mo_packaging_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_status public.mo_status;
begin
  select status into v_status from public.manufacturing_orders
   where id = case when tg_op = 'DELETE' then old.mo_id else new.mo_id end;
  if v_status is null and tg_op = 'DELETE' then
    return old;
  end if;
  if v_status <> 'simulation' then
    raise exception 'Packaging changes only in simulation';
  end if;
  if tg_op <> 'DELETE' and (select type from public.items where id = new.item_id) <> 'packaging' then
    raise exception 'Only packaging items can be added as packaging';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger mo_packaging_guard before insert or update or delete on public.mo_packaging
  for each row execute function public.mo_packaging_guard();

-- ---------------------------------------------------------------------
-- Materials (internal: no role check; used by the functions below)
-- ---------------------------------------------------------------------
create or replace function public.mo_required_materials(p_mo uuid)
returns table (item_id uuid, kind text, required numeric)
language sql stable security definer set search_path = public
as $$
  with m as (
    select mo.id, mo.quantity, mo.formula_version_id, f.serving_size, f.serving_unit, f.servings_per_pack,
           f.shell_item_id, coalesce(fc.loss_pct, 0) as loss_pct
      from public.manufacturing_orders mo
      join public.formula_versions v on v.id = mo.formula_version_id
      join public.formulas f on f.id = v.formula_id
      left join public.format_costing fc on fc.product_format = f.product_format
     where mo.id = p_mo
  ),
  lines as (
    select i.id as item_id, 'ingredient'::text as kind,
           l.amount_mg * (1 + l.overage_pct / 100) * m.servings_per_pack * (1 + m.loss_pct / 100) * m.quantity
             / case i.base_unit when 'kg' then 1000000 when 'g' then 1000 end as required
      from m join public.formula_lines l on l.version_id = m.formula_version_id
      join public.items i on i.id = l.item_id
    union all
    select m.shell_item_id, 'shell', m.serving_size * m.servings_per_pack * (1 + m.loss_pct / 100) * m.quantity
      from m where m.serving_unit = 'pcs' and m.shell_item_id is not null
    union all
    select p.item_id, 'packaging', p.qty_per_pack * m.quantity
      from m join public.mo_packaging p on p.mo_id = m.id
  )
  select item_id, min(kind), round(sum(required), 4)
    from lines where required is not null
   group by item_id
$$;

-- What a manufacturing order needs, what is reserved for it, what is
-- free, what is usable at the partner and what has been requested.
-- The partner sees released orders only, without the free stock column.
create or replace function public.mo_material_requirements(p_mo uuid)
returns table (
  item_id uuid, sku text, name text, name_bg text, kind text, base_unit public.base_unit,
  required numeric, reserved numeric, available numeric, at_partner numeric, requested numeric
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_partner boolean := public.has_role('partner');
  v_status  public.mo_status;
begin
  if not public.has_role('admin', 'sales', 'inventory', 'partner') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select status into v_status from public.manufacturing_orders where id = p_mo;
  if v_status is null or (v_partner and v_status not in ('released', 'in_production', 'completed')) then
    raise exception 'Unknown manufacturing order';
  end if;
  return query
    select r.item_id, i.sku, i.name, i.name_bg, r.kind, i.base_unit, r.required,
           coalesce((select sum(sr.quantity) from public.stock_reservations sr
                      where sr.manufacturing_order_id = p_mo and sr.item_id = r.item_id and sr.status = 'active'), 0),
           case when v_partner then null
                else coalesce((select s.available from public.item_stock_summary s where s.item_id = r.item_id), 0) end,
           coalesce((select sum(b.quantity) from public.stock_balances b
                      where b.item_id = r.item_id and b.qc_status = 'released' and not b.is_expired
                        and public.is_partner_location(b.location_id)), 0),
           case when v_partner then null
                else coalesce((select sum(pr.quantity) from public.purchase_requests pr
                                where pr.manufacturing_order_id = p_mo and pr.item_id = r.item_id
                                  and pr.status in ('open', 'ordered')), 0) end
      from public.mo_required_materials(p_mo) r
      join public.items i on i.id = r.item_id
     order by r.kind, i.name;
end
$$;

-- ---------------------------------------------------------------------
-- Planning functions
-- ---------------------------------------------------------------------

-- Reserve what is still missing, as far as free stock allows
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
  perform public.require_role('admin', 'sales', 'inventory');
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

-- Purchase requests for what is neither reserved nor already requested
create or replace function public.create_purchase_requests(p_mo uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  mo  public.manufacturing_orders;
  r   record;
  v_n integer := 0;
begin
  perform public.require_role('admin', 'sales', 'inventory');
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
  perform public.require_role('admin', 'inventory');
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

-- Send to the partner: every material must be fully reserved
create or replace function public.release_mo(p_mo uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  mo        public.manufacturing_orders;
  v_missing text;
begin
  perform public.require_role('admin', 'inventory');
  select * into mo from public.manufacturing_orders where id = p_mo;
  if mo.status <> 'scheduled' then
    raise exception 'Only a scheduled order can be sent to the partner';
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
  perform public.require_role('admin', 'inventory');
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

-- ---------------------------------------------------------------------
-- Partner functions
-- ---------------------------------------------------------------------
create or replace function public.start_production(p_mo uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'inventory', 'partner');
  if (select status from public.manufacturing_orders where id = p_mo) is distinct from 'released' then
    raise exception 'Only an order sent to the partner can be started';
  end if;
  perform set_config('nk.mo_transition', 'on', true);
  update public.manufacturing_orders set status = 'in_production', started_at = now() where id = p_mo;
  perform set_config('nk.mo_transition', 'off', true);
end
$$;

-- The partner reports the batch: lots consumed (jsonb array of
-- {lot_id, location_id, quantity}), quantity made and batch number.
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
  v_partner boolean := public.has_role('partner');
  c         record;
  v_item    uuid;
  v_fg      uuid;
  v_lot     uuid;
  v_shelf   integer;
  v_fg_loc  uuid;
  v_project public.projects;
  v_formula public.formulas;
begin
  perform public.require_role('admin', 'inventory', 'partner');
  select * into mo from public.manufacturing_orders where id = p_mo;
  if mo.status not in ('released', 'in_production') then
    raise exception 'Only an order sent to the partner can be completed';
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

  -- Consumption, lot by lot (the ledger refuses unreleased, expired or missing stock)
  for c in select * from jsonb_to_recordset(p_consumption) as x(lot_id uuid, location_id uuid, quantity numeric) loop
    continue when coalesce(c.quantity, 0) = 0;
    select item_id into v_item from public.lots where id = c.lot_id;
    if v_item is null or not exists (select 1 from public.mo_required_materials(p_mo) r where r.item_id = v_item) then
      raise exception 'A consumed lot is not one of the materials of this order';
    end if;
    if v_partner and not public.is_partner_location(c.location_id) then
      raise exception 'Partner can only consume stock at partner locations' using errcode = '42501';
    end if;
    insert into public.stock_movements (type, lot_id, location_id, quantity, project_id, reference)
    values ('consumption', c.lot_id, c.location_id, -abs(c.quantity), mo.project_id, mo.code);
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

  select id into v_fg_loc from public.locations where code = 'PF-FG' and is_active;
  if v_fg_loc is null then
    raise exception 'Location PF-FG (partner finished goods) is missing';
  end if;

  insert into public.lots (lot_number, item_id, manufactured_on, expires_on, received_on, project_id, notes)
  values (btrim(p_batch), v_fg, coalesce(p_produced_on, current_date),
          (coalesce(p_produced_on, current_date) + make_interval(months => coalesce(v_shelf, 24)))::date,
          coalesce(p_produced_on, current_date), mo.project_id, 'Production ' || mo.code)
  returning id into v_lot;

  insert into public.stock_movements (type, lot_id, location_id, quantity, project_id, reference)
  values ('production_output', v_lot, v_fg_loc, p_quantity, mo.project_id, mo.code);

  update public.stock_reservations set status = 'consumed', closed_by = auth.uid(), closed_at = now()
   where manufacturing_order_id = p_mo and status = 'active';

  perform set_config('nk.mo_transition', 'on', true);
  update public.manufacturing_orders
     set status = 'completed', completed_at = now(), batch_number = btrim(p_batch), produced_quantity = p_quantity,
         produced_on = coalesce(p_produced_on, current_date), finished_lot_id = v_lot,
         started_at = coalesce(started_at, now())
   where id = p_mo;
  perform set_config('nk.mo_transition', 'off', true);
  return v_lot;
end
$$;

-- ---------------------------------------------------------------------
-- The partner's view: released orders by project code only
-- (deliberately not security_invoker: it exposes only these columns)
-- ---------------------------------------------------------------------
create view public.partner_manufacturing_orders as
select mo.id, mo.code, p.code as project_code, f.name as product, f.name_bg as product_bg, f.product_format,
       f.serving_size, f.serving_unit, f.servings_per_pack, mo.quantity, mo.planned_date, mo.status,
       mo.batch_number, mo.produced_quantity, mo.produced_on, mo.released_at, mo.started_at, mo.completed_at
  from public.manufacturing_orders mo
  join public.projects p on p.id = mo.project_id
  join public.formula_versions v on v.id = mo.formula_version_id
  join public.formulas f on f.id = v.formula_id
 where mo.status in ('released', 'in_production', 'completed')
   and public.has_role('admin', 'inventory', 'partner');

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.manufacturing_orders enable row level security;
alter table public.mo_packaging         enable row level security;
alter table public.production_invoices  enable row level security;
alter table public.purchase_requests    enable row level security;

create policy manufacturing_orders_select on public.manufacturing_orders for select to authenticated
  using (public.is_staff());
create policy manufacturing_orders_insert on public.manufacturing_orders for insert to authenticated
  with check (public.is_staff());
create policy manufacturing_orders_update on public.manufacturing_orders for update to authenticated
  using (public.has_role('admin', 'inventory') or (public.has_role('sales') and status = 'simulation'))
  with check (public.has_role('admin', 'inventory') or (public.has_role('sales') and status = 'simulation'));

create policy mo_packaging_select on public.mo_packaging for select to authenticated
  using (public.is_staff());
create policy mo_packaging_write on public.mo_packaging for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy production_invoices_select on public.production_invoices for select to authenticated
  using (public.has_role('admin', 'inventory') or (public.has_role('partner') and entered_by = auth.uid()));
-- The partner cannot read manufacturing_orders, so the check runs as owner
create or replace function public.mo_is_released(p_mo uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select status in ('released', 'in_production', 'completed')
                     from public.manufacturing_orders where id = p_mo), false)
$$;

create policy production_invoices_insert on public.production_invoices for insert to authenticated
  with check (public.has_role('admin', 'partner') and public.mo_is_released(mo_id));
create policy production_invoices_delete on public.production_invoices for delete to authenticated
  using (public.has_role('admin'));

create policy purchase_requests_select on public.purchase_requests for select to authenticated
  using (public.is_staff());
create policy purchase_requests_insert on public.purchase_requests for insert to authenticated
  with check (public.is_staff());
create policy purchase_requests_update on public.purchase_requests for update to authenticated
  using (public.has_role('admin', 'inventory')) with check (public.has_role('admin', 'inventory'));

revoke all on public.partner_manufacturing_orders from anon;
grant select on public.partner_manufacturing_orders to authenticated;

revoke execute on function
  public.purchase_requests_defaults(),
  public.manufacturing_orders_guard(),
  public.manufacturing_orders_packaging(),
  public.mo_packaging_guard(),
  public.mo_required_materials(uuid),
  public.mo_material_requirements(uuid),
  public.reserve_mo_materials(uuid),
  public.create_purchase_requests(uuid),
  public.schedule_mo(uuid, date),
  public.release_mo(uuid),
  public.cancel_mo(uuid),
  public.start_production(uuid),
  public.complete_production(uuid, text, integer, date, jsonb)
from public, anon, authenticated;

grant execute on function
  public.mo_material_requirements(uuid),
  public.reserve_mo_materials(uuid),
  public.create_purchase_requests(uuid),
  public.schedule_mo(uuid, date),
  public.release_mo(uuid),
  public.cancel_mo(uuid),
  public.start_production(uuid),
  public.complete_production(uuid, text, integer, date, jsonb)
to authenticated;
