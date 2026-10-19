-- =====================================================================
-- Nutrikal ERP + CRM — Phase 1 — 0004 inventory
-- Locations, lots, the stock ledger, reservations and adjustment requests.
--
-- Rules
-- * Stock is never edited. Every change is a row in stock_movements and
--   balances are computed from it.
-- * The ledger is written only through the functions below, which check
--   the caller's role, lock the lot/location and refuse negative stock.
-- * Nutrikal owns all stock at every location (decision 19 Oct 2026).
-- * Quantities are always in the item's base unit.
-- =====================================================================

create type public.location_type as enum (
  'warehouse', 'partner_facility', 'quarantine', 'in_transit', 'virtual'
);
create type public.qc_status as enum ('quarantine', 'released', 'rejected');
create type public.movement_type as enum (
  'opening_balance',    -- one-off import from the old inventory app
  'receipt',            -- goods in from a supplier
  'transfer_out',       -- paired with transfer_in (same movement_group)
  'transfer_in',
  'consumption',        -- used in production
  'production_output',  -- finished or semi-finished goods made
  'adjustment',         -- stock count correction (reason required)
  'dispatch',           -- goods out to a client
  'return',             -- goods back in
  'waste'               -- damaged, expired, destroyed
);
create type public.reservation_status as enum ('active', 'consumed', 'released');
create type public.request_status     as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------------
-- Locations
-- ---------------------------------------------------------------------
create table public.locations (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  name                text not null,
  type                public.location_type not null,
  parent_id           uuid references public.locations (id),
  is_partner_visible  boolean not null default false,   -- the partner user works here
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);
select public.enable_audit('public.locations');

create or replace function public.is_partner_location(p_location uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select is_partner_visible and is_active from public.locations where id = p_location),
    false)
$$;

-- ---------------------------------------------------------------------
-- Lots: every receipt and every production batch creates one
-- ---------------------------------------------------------------------
create table public.lots (
  id                uuid primary key default gen_random_uuid(),
  lot_number        text not null unique,                    -- internal lot, e.g. LOT-000123
  item_id           uuid not null references public.items (id),
  supplier_id       uuid references public.suppliers (id),
  supplier_lot      text,
  manufactured_on   date,
  expires_on        date,
  received_on       date not null default current_date,
  qc_status         public.qc_status not null default 'quarantine',
  qc_decided_by     uuid references public.profiles (id),
  qc_decided_at     timestamptz,
  qc_notes          text,
  coa_path          text,                                    -- bucket "lot-documents"
  project_id        uuid references public.projects (id),    -- finished / semi-finished batches
  notes             text,
  created_by        uuid default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint lots_dates_chk check (
    expires_on is null or manufactured_on is null or expires_on > manufactured_on
  )
);
create index lots_item_idx    on public.lots (item_id);
create index lots_expiry_idx  on public.lots (expires_on);
create index lots_project_idx on public.lots (project_id);
create index lots_supplier_lot_idx on public.lots (supplier_id, supplier_lot);

-- Lot number from the series; expiry from the item's shelf life if not given
create or replace function public.lots_defaults()
returns trigger language plpgsql set search_path = public
as $$
declare
  v_shelf_life integer;
begin
  if new.lot_number is null or new.lot_number = '' then
    new.lot_number := public.next_number('lot');
  end if;

  if new.expires_on is null then
    select shelf_life_months into v_shelf_life from public.items where id = new.item_id;
    if v_shelf_life is not null then
      new.expires_on := (coalesce(new.manufactured_on, new.received_on)
                         + make_interval(months => v_shelf_life))::date;
    end if;
  end if;
  return new;
end
$$;

-- Only Admin changes QC status; who and when is recorded
create or replace function public.lots_qc_guard()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.qc_status is distinct from old.qc_status then
    if not public.has_role('admin') then
      raise exception 'Only Admin can change QC status' using errcode = '42501';
    end if;
    new.qc_decided_by := auth.uid();
    new.qc_decided_at := now();
  end if;
  if new.item_id is distinct from old.item_id or new.lot_number is distinct from old.lot_number then
    raise exception 'Lot number and item cannot be changed';
  end if;
  return new;
end
$$;

create trigger lots_defaults  before insert on public.lots for each row execute function public.lots_defaults();
create trigger lots_qc_guard  before update on public.lots for each row execute function public.lots_qc_guard();
create trigger lots_updated_at before update on public.lots for each row execute function public.set_updated_at();
select public.enable_audit('public.lots');

-- ---------------------------------------------------------------------
-- Stock ledger
-- ---------------------------------------------------------------------
create table public.stock_movements (
  id               bigint generated always as identity primary key,
  movement_group   uuid not null default gen_random_uuid(),
  type             public.movement_type not null,
  item_id          uuid not null references public.items (id),
  lot_id           uuid not null references public.lots (id),
  location_id      uuid not null references public.locations (id),
  quantity         numeric(14, 4) not null,              -- signed, base unit of the item
  project_id       uuid references public.projects (id),
  reference        text,                                 -- PO / MO / delivery note number
  reason           text,
  created_by       uuid default auth.uid() references public.profiles (id),
  created_at       timestamptz not null default now(),
  constraint stock_movements_qty_nonzero check (quantity <> 0),
  constraint stock_movements_sign_chk check (
       (type in ('opening_balance', 'receipt', 'transfer_in', 'production_output', 'return') and quantity > 0)
    or (type in ('transfer_out', 'consumption', 'dispatch', 'waste') and quantity < 0)
    or  type = 'adjustment'
  ),
  constraint stock_movements_adjustment_reason check (
    type <> 'adjustment' or nullif(btrim(reason), '') is not null
  )
);
create index stock_movements_lot_loc_idx  on public.stock_movements (lot_id, location_id);
create index stock_movements_item_idx     on public.stock_movements (item_id);
create index stock_movements_location_idx on public.stock_movements (location_id);
create index stock_movements_project_idx  on public.stock_movements (project_id);
create index stock_movements_created_idx  on public.stock_movements (created_at desc);
create index stock_movements_group_idx    on public.stock_movements (movement_group);

-- Fills item_id, serialises writes per lot+location, refuses negative
-- stock and blocks use of unreleased or expired lots.
create or replace function public.stock_movements_guard()
returns trigger language plpgsql set search_path = public
as $$
declare
  v_lot      public.lots;
  v_balance  numeric;
begin
  select * into v_lot from public.lots where id = new.lot_id;
  if not found then
    raise exception 'Lot % not found', new.lot_id;
  end if;

  if new.item_id is null then
    new.item_id := v_lot.item_id;
  elsif new.item_id <> v_lot.item_id then
    raise exception 'Item does not match lot %', v_lot.lot_number;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.lot_id::text || '/' || new.location_id::text, 0));

  if new.quantity < 0 then
    select coalesce(sum(quantity), 0) into v_balance
      from public.stock_movements
     where lot_id = new.lot_id and location_id = new.location_id;

    if v_balance + new.quantity < 0 then
      raise exception 'Insufficient stock of lot % at this location: % available, % requested',
        v_lot.lot_number, v_balance, abs(new.quantity)
        using errcode = '23514';
    end if;
  end if;

  if new.type in ('consumption', 'dispatch') then
    if v_lot.qc_status <> 'released' then
      raise exception 'Lot % is not released by QC (status: %)', v_lot.lot_number, v_lot.qc_status
        using errcode = '23514';
    end if;
    if v_lot.expires_on is not null and v_lot.expires_on < current_date then
      raise exception 'Lot % expired on %', v_lot.lot_number, v_lot.expires_on
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$$;

create or replace function public.stock_movements_immutable()
returns trigger language plpgsql set search_path = public
as $$
begin
  raise exception 'Stock movements cannot be changed or deleted; post a correcting movement instead';
end
$$;

create trigger stock_movements_guard before insert on public.stock_movements
  for each row execute function public.stock_movements_guard();
create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function public.stock_movements_immutable();

-- ---------------------------------------------------------------------
-- Reservations: stock set aside for a client project
-- ---------------------------------------------------------------------
create table public.stock_reservations (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.items (id),
  lot_id        uuid references public.lots (id),         -- null = any lot of the item
  location_id   uuid references public.locations (id),
  project_id    uuid not null references public.projects (id),
  quantity      numeric(14, 4) not null check (quantity > 0),
  status        public.reservation_status not null default 'active',
  note          text,
  reserved_by   uuid default auth.uid() references public.profiles (id),
  created_at    timestamptz not null default now(),
  closed_by     uuid references public.profiles (id),
  closed_at     timestamptz
);
create index stock_reservations_item_idx    on public.stock_reservations (item_id) where status = 'active';
create index stock_reservations_lot_idx     on public.stock_reservations (lot_id) where status = 'active';
create index stock_reservations_project_idx on public.stock_reservations (project_id);
select public.enable_audit('public.stock_reservations');

-- ---------------------------------------------------------------------
-- Adjustment requests: the partner cannot correct stock directly;
-- Admin or Inventory approves and the adjustment is then posted.
-- ---------------------------------------------------------------------
create table public.stock_adjustment_requests (
  id              uuid primary key default gen_random_uuid(),
  lot_id          uuid not null references public.lots (id),
  location_id     uuid not null references public.locations (id),
  quantity        numeric(14, 4) not null check (quantity <> 0),   -- signed change requested
  reason          text not null check (btrim(reason) <> ''),
  status          public.request_status not null default 'pending',
  requested_by    uuid default auth.uid() references public.profiles (id),
  requested_at    timestamptz not null default now(),
  decided_by      uuid references public.profiles (id),
  decided_at      timestamptz,
  decision_note   text,
  movement_id     bigint references public.stock_movements (id)
);
create index stock_adjustment_requests_pending_idx on public.stock_adjustment_requests (requested_at)
  where status = 'pending';
select public.enable_audit('public.stock_adjustment_requests');

-- ---------------------------------------------------------------------
-- Views (security_invoker: the caller's row-level security applies)
-- ---------------------------------------------------------------------

-- Balance per lot and location
create view public.stock_balances
with (security_invoker = true) as
select m.lot_id,
       m.item_id,
       m.location_id,
       sum(m.quantity)                                as quantity,
       l.lot_number,
       l.qc_status,
       l.expires_on,
       (l.expires_on is not null and l.expires_on < current_date) as is_expired
  from public.stock_movements m
  join public.lots l on l.id = m.lot_id
 group by m.lot_id, m.item_id, m.location_id, l.lot_number, l.qc_status, l.expires_on
having sum(m.quantity) <> 0;

-- Per item: on hand, usable (released, not expired), in quarantine,
-- reserved and available (= usable - reserved)
create view public.item_stock_summary
with (security_invoker = true) as
with bal as (
  select item_id,
         sum(quantity)                                                       as on_hand,
         sum(quantity) filter (where qc_status = 'released' and not is_expired) as usable,
         sum(quantity) filter (where qc_status = 'quarantine')               as quarantine
    from public.stock_balances
   group by item_id
),
res as (
  select item_id, sum(quantity) as reserved
    from public.stock_reservations
   where status = 'active'
   group by item_id
)
select i.id                                              as item_id,
       i.sku,
       i.name,
       i.type,
       i.base_unit,
       coalesce(b.on_hand, 0)                            as on_hand,
       coalesce(b.usable, 0)                             as usable,
       coalesce(b.quarantine, 0)                         as quarantine,
       coalesce(r.reserved, 0)                           as reserved,
       coalesce(b.usable, 0) - coalesce(r.reserved, 0)   as available,
       i.reorder_level,
       (i.reorder_level is not null
        and coalesce(b.usable, 0) - coalesce(r.reserved, 0) < i.reorder_level) as below_reorder_level
  from public.items i
  left join bal b on b.item_id = i.id
  left join res r on r.item_id = i.id
 where i.is_active;

-- Lots with stock that expire within the warning window
create view public.expiring_lots
with (security_invoker = true) as
select sb.*,
       i.sku,
       i.name as item_name,
       (sb.expires_on - current_date) as days_left
  from public.stock_balances sb
  join public.items i on i.id = sb.item_id
 where sb.quantity > 0
   and sb.expires_on is not null
   and sb.expires_on <= current_date
       + coalesce((select expiry_warning_days from public.company_settings limit 1), 90);

-- The partner sees projects by code only, never the client.
-- Deliberately not security_invoker: it exposes only these columns.
create view public.partner_projects as
select p.id, p.code, p.product_format, p.status
  from public.projects p
 where public.has_role('admin', 'sales', 'inventory', 'partner');

-- =====================================================================
-- Stock functions (the only way to write the ledger)
-- =====================================================================

-- Receive goods: creates a lot in quarantine and a receipt movement.
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
  perform public.require_role('admin', 'inventory', 'partner');
  if public.has_role('partner') and not public.is_partner_location(p_location) then
    raise exception 'Partner can only receive into partner locations' using errcode = '42501';
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

-- Post a single movement. Quantity is given as a positive number for
-- outbound types (it is negated here); adjustments are signed.
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
  if v_role = 'partner' then
    if p_type not in ('consumption', 'production_output', 'dispatch', 'waste') then
      raise exception 'Partner cannot post %; use request_stock_adjustment', p_type using errcode = '42501';
    end if;
    if not public.is_partner_location(p_location) then
      raise exception 'Partner can only post at partner locations' using errcode = '42501';
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

-- Move stock between locations (two rows, one movement_group).
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
  perform public.require_role('admin', 'inventory', 'partner');
  if public.has_role('partner')
     and not (public.is_partner_location(p_from) and public.is_partner_location(p_to)) then
    raise exception 'Partner can only move stock between partner locations' using errcode = '42501';
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

-- QC decision on a lot (Admin only).
create or replace function public.set_lot_qc_status(
  p_lot     uuid,
  p_status  public.qc_status,
  p_notes   text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin');
  update public.lots
     set qc_status = p_status,
         qc_notes  = coalesce(p_notes, qc_notes)
   where id = p_lot;
  if not found then
    raise exception 'Lot % not found', p_lot;
  end if;
end
$$;

-- Reserve stock for a project. Checks availability under a lock.
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
  perform public.require_role('admin', 'inventory', 'sales');
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

-- Close a reservation as released (no longer needed) or consumed.
create or replace function public.close_reservation(
  p_reservation  uuid,
  p_status       public.reservation_status default 'released'
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'inventory', 'sales');
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

-- Partner (or staff) asks for a stock correction.
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
  perform public.require_role('admin', 'inventory', 'partner');
  if public.has_role('partner') and not public.is_partner_location(p_location) then
    raise exception 'Partner can only request adjustments at partner locations' using errcode = '42501';
  end if;
  insert into public.stock_adjustment_requests (lot_id, location_id, quantity, reason)
  values (p_lot, p_location, p_quantity, p_reason)
  returning id into v_id;
  return v_id;
end
$$;

-- Admin or Inventory approves (posting the adjustment) or rejects.
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
  perform public.require_role('admin', 'inventory');

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
