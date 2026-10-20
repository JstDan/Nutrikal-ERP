-- =====================================================================
-- Nutrikal ERP + CRM — 0016 expected deliveries and stock counts
-- Brought over from the Nutrikal Inventory app (Oct 2026):
-- * Expected deliveries: what has been ordered from a supplier, when it
--   should arrive and at what price. Received in one or more parts; each
--   receipt is a normal lot (quarantine, QC) linked to the delivery.
-- * Incoming and projected stock per item (available + incoming).
-- * Stock count: enter what is on the shelf; the difference is posted
--   as an adjustment (staff) or sent as a correction request (partner).
--
-- Access: Admin and Inventory create, edit, receive and cancel. Reading
-- deliveries shows suppliers and prices, so it follows supplier prices:
-- Admin, Inventory and Sales users with can_see_purchase_prices.
-- The partner sees no deliveries at all (suppliers and prices are hidden
-- from it); it keeps receiving goods through receive_lot as before.
-- Every staff user sees the incoming quantity per item (no supplier,
-- no price) through item_incoming.
-- =====================================================================

create type public.delivery_status as enum ('open', 'received', 'cancelled');

insert into public.number_series (key, label, prefix, next_number, pad_length)
values ('delivery', 'Expected deliveries', 'ED-', 1, 5)
on conflict (key) do nothing;

create table public.expected_deliveries (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,                               -- e.g. ED-00001
  item_id              uuid not null references public.items (id),
  supplier_id          uuid references public.suppliers (id),
  quantity             numeric(14, 4) not null check (quantity > 0),       -- base unit
  expected_on          date,
  unit_price           numeric(14, 6) check (unit_price >= 0),             -- per base unit
  currency             char(3) not null default 'EUR',
  po_reference         text,                                               -- supplier order / PO number
  location_id          uuid references public.locations (id),              -- where it will arrive
  purchase_request_id  uuid references public.purchase_requests (id),
  status               public.delivery_status not null default 'open',
  note                 text,
  created_by           uuid default auth.uid() references public.profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  closed_by            uuid references public.profiles (id),
  closed_at            timestamptz
);
create index expected_deliveries_item_idx   on public.expected_deliveries (item_id) where status = 'open';
create index expected_deliveries_date_idx   on public.expected_deliveries (expected_on) where status = 'open';
create index expected_deliveries_pr_idx     on public.expected_deliveries (purchase_request_id);
create trigger expected_deliveries_updated_at before update on public.expected_deliveries
  for each row execute function public.set_updated_at();
select public.enable_audit('public.expected_deliveries');

-- Lots received against a delivery
alter table public.lots add column expected_delivery_id uuid references public.expected_deliveries (id);
create index lots_expected_delivery_idx on public.lots (expected_delivery_id);

-- Code from the series; item, code and request never change; a closed
-- delivery is locked; status changes only through the functions below.
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

  if old.status <> 'open' then
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
create trigger expected_deliveries_guard before insert or update on public.expected_deliveries
  for each row execute function public.expected_deliveries_guard();

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------

-- Each delivery with what has been received so far (RLS of the caller applies)
create view public.expected_delivery_overview
with (security_invoker = true) as
select d.*,
       coalesce(r.received, 0)                                   as received,
       greatest(d.quantity - coalesce(r.received, 0), 0)          as remaining,
       (d.status = 'open' and d.expected_on < current_date)       as is_overdue,
       (d.status = 'open' and coalesce(r.received, 0) > 0)        as is_partial
  from public.expected_deliveries d
  left join lateral (
    select sum(m.quantity) as received
      from public.lots l
      join public.stock_movements m on m.lot_id = l.id and m.type = 'receipt'
     where l.expected_delivery_id = d.id
  ) r on true;

-- Incoming per item for every staff user: quantity and dates only, no
-- supplier and no price. Deliberately not security_invoker.
create view public.item_incoming as
select d.item_id,
       sum(greatest(d.quantity - coalesce(r.received, 0), 0))           as incoming,
       min(d.expected_on)                                               as next_expected_on,
       bool_or(d.expected_on < current_date)                            as has_overdue
  from public.expected_deliveries d
  left join lateral (
    select sum(m.quantity) as received
      from public.lots l
      join public.stock_movements m on m.lot_id = l.id and m.type = 'receipt'
     where l.expected_delivery_id = d.id
  ) r on true
 where d.status = 'open'
   and public.is_staff()
 group by d.item_id;

-- Item summary gains incoming and projected (= available + incoming).
-- Same columns as before, three added at the end.
create or replace view public.item_stock_summary
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
        and coalesce(b.usable, 0) - coalesce(r.reserved, 0) < i.reorder_level) as below_reorder_level,
       coalesce(n.incoming, 0)                           as incoming,
       n.next_expected_on,
       coalesce(b.usable, 0) - coalesce(r.reserved, 0) + coalesce(n.incoming, 0) as projected
  from public.items i
  left join bal b on b.item_id = i.id
  left join res r on r.item_id = i.id
  left join public.item_incoming n on n.item_id = i.id
 where i.is_active;

-- ---------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------

-- Record an expected delivery. With a purchase request, the item comes
-- from the request (quantity defaults to it) and the request becomes
-- "ordered".
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
  perform public.require_role('admin', 'inventory');

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

-- Receive (part of) a delivery: a new lot in quarantine linked to the
-- delivery, at the delivery's price when it has one. The delivery closes
-- when everything has arrived, or earlier with p_close (short delivery).
-- Receiving more than expected is allowed. Returns the new lot.
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
  perform public.require_role('admin', 'inventory');

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

-- Cancel an open delivery. What was already received stays in stock.
-- A purchase request with no other open delivery and nothing received
-- goes back to "open".
create or replace function public.cancel_expected_delivery(p_delivery uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  d public.expected_deliveries;
begin
  perform public.require_role('admin', 'inventory');
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

-- Stock count: the counted quantity of a lot at a location. Staff post
-- the difference as an adjustment; the partner files a correction
-- request for Admin or Inventory to approve. Returns the difference
-- (0 = the count matched, nothing posted).
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
  perform public.require_role('admin', 'inventory', 'partner');
  if p_counted is null or p_counted < 0 then
    raise exception 'Enter the counted quantity (zero or more)';
  end if;
  if public.has_role('partner') and not public.is_partner_location(p_location) then
    raise exception 'Partner can only count stock at partner locations' using errcode = '42501';
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

  if public.has_role('partner') then
    perform public.request_stock_adjustment(p_lot, p_location, v_diff, v_reason);
  else
    insert into public.stock_movements (type, lot_id, location_id, quantity, reason)
    values ('adjustment', p_lot, p_location, v_diff, v_reason);
  end if;
  return v_diff;
end
$$;

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.expected_deliveries enable row level security;

create policy expected_deliveries_select on public.expected_deliveries for select to authenticated
  using (public.has_role('admin', 'inventory') or public.can_see_purchase_prices());
-- Dates, quantity, price and notes of an open delivery (guard trigger)
create policy expected_deliveries_update on public.expected_deliveries for update to authenticated
  using (public.has_role('admin', 'inventory')) with check (public.has_role('admin', 'inventory'));
-- No insert or delete policy: created through create_expected_delivery, never deleted.

revoke all on public.item_incoming from anon;
grant select on public.item_incoming to authenticated;
revoke all on public.expected_delivery_overview from anon;
grant select on public.expected_delivery_overview to authenticated;

revoke execute on function
  public.expected_deliveries_guard(),
  public.create_expected_delivery(uuid, numeric, uuid, date, numeric, text, uuid, uuid, text),
  public.receive_expected_delivery(uuid, uuid, numeric, text, date, date, text, boolean),
  public.cancel_expected_delivery(uuid, text),
  public.count_stock(uuid, uuid, numeric, text)
from public, anon;

grant execute on function
  public.create_expected_delivery(uuid, numeric, uuid, date, numeric, text, uuid, uuid, text),
  public.receive_expected_delivery(uuid, uuid, numeric, text, date, date, text, boolean),
  public.cancel_expected_delivery(uuid, text),
  public.count_stock(uuid, uuid, numeric, text)
to authenticated;
