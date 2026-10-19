-- =====================================================================
-- Nutrikal ERP + CRM — Phase 3 — 0011 sales orders
-- An order is made from a sent or accepted offer: one product (one
-- approved formula version, one project) at one of the offer's
-- quantities. Materials are calculated from the formula and the offer's
-- packaging and reserved for the project.
--
-- Rules
-- * Orders are created only from offers (create_order_from_offer); the
--   offer becomes accepted and the price is the price of that quantity.
-- * Status: draft → confirmed → in_production → ready → dispatched →
--   closed; draft/confirmed/in_production can be cancelled; confirmed can
--   go back to draft. Quantity and price change only on a draft.
-- * Production starts only after the deposit is received (when there is
--   a deposit). With "balance before dispatch" the order is dispatched
--   only after the balance is received. Admin may override both.
-- * The project's stage follows the order (order → production → completed).
--
--                         admin   sales   inventory   partner
-- sales orders (prices)   all     all     —           —
-- order overview          read    read    read        —      (no prices)
-- material requirements   yes     yes     yes         —
-- =====================================================================

create type public.order_status as enum (
  'draft', 'confirmed', 'in_production', 'ready', 'dispatched', 'closed', 'cancelled'
);

create table public.sales_orders (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,                          -- e.g. SO-00001
  client_id            uuid not null references public.clients (id),
  project_id           uuid not null references public.projects (id),
  offer_id             uuid not null references public.offers (id),
  formula_version_id   uuid not null references public.formula_versions (id),
  quantity             integer not null check (quantity > 0),          -- packs
  unit_price           numeric(12, 4) not null check (unit_price >= 0),
  currency             char(3) not null default 'EUR',
  status               public.order_status not null default 'draft',
  deposit_pct          numeric(5, 2) check (deposit_pct between 0 and 100),
  balance_terms        public.balance_terms,
  balance_net_days     integer check (balance_net_days >= 0),
  deposit_received_on  date,
  balance_received_on  date,
  requested_date       date,
  customer_ref         text,                                           -- client's PO number
  notes                text,
  confirmed_at         timestamptz,
  dispatched_at        timestamptz,
  created_by           uuid default auth.uid() references public.profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index sales_orders_client_idx  on public.sales_orders (client_id);
create index sales_orders_project_idx on public.sales_orders (project_id);
create index sales_orders_status_idx  on public.sales_orders (status);

create trigger sales_orders_updated_at before update on public.sales_orders
  for each row execute function public.set_updated_at();
select public.enable_audit('public.sales_orders');

-- ---------------------------------------------------------------------
-- Status rules
-- ---------------------------------------------------------------------
create or replace function public.sales_orders_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_admin boolean := public.has_role('admin');
begin
  if tg_op = 'INSERT' then
    if new.code is null or new.code = '' then
      new.code := public.next_number('sales_order');
    end if;
    select client_id into new.client_id from public.projects where id = new.project_id;
    return new;
  end if;

  if old.status <> 'draft'
     and (new.quantity, new.unit_price, new.offer_id, new.formula_version_id, new.project_id, new.currency)
         is distinct from (old.quantity, old.unit_price, old.offer_id, old.formula_version_id, old.project_id, old.currency) then
    raise exception 'Quantity and price can only change on a draft order';
  end if;
  if new.project_id <> old.project_id then
    select client_id into new.client_id from public.projects where id = new.project_id;
  end if;

  if new.status <> old.status then
    if not (
      (old.status = 'draft'         and new.status in ('confirmed', 'cancelled')) or
      (old.status = 'confirmed'     and new.status in ('in_production', 'draft', 'cancelled')) or
      (old.status = 'in_production' and new.status in ('ready', 'cancelled')) or
      (old.status = 'ready'         and new.status = 'dispatched') or
      (old.status = 'dispatched'    and new.status = 'closed')
    ) then
      raise exception 'An order cannot go from % to %', old.status, new.status;
    end if;

    if new.status = 'in_production' and coalesce(new.deposit_pct, 0) > 0
       and new.deposit_received_on is null and not v_admin then
      raise exception 'The deposit has not been received yet';
    end if;
    if new.status = 'dispatched' and new.balance_terms = 'before_dispatch'
       and new.balance_received_on is null and not v_admin then
      raise exception 'The balance must be paid before dispatch';
    end if;

    if new.status = 'confirmed' and old.status = 'draft' then
      new.confirmed_at := now();
    elsif new.status = 'draft' then
      new.confirmed_at := null;
    elsif new.status = 'dispatched' then
      new.dispatched_at := now();
    end if;
  end if;
  return new;
end
$$;

create trigger sales_orders_guard before insert or update on public.sales_orders
  for each row execute function public.sales_orders_guard();

-- The project's stage follows the order (forward only)
create or replace function public.sales_orders_project_stage()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_stage public.project_status;
begin
  v_stage := case new.status
               when 'confirmed' then 'order'
               when 'in_production' then 'production'
               when 'ready' then 'production'
               when 'dispatched' then 'completed'
               when 'closed' then 'completed'
             end;
  if v_stage is not null then
    update public.projects
       set status = v_stage
     where id = new.project_id
       and status <> v_stage
       and array_position(array['inquiry', 'formulation', 'offer', 'order', 'production', 'completed']::public.project_status[], status)
           < array_position(array['inquiry', 'formulation', 'offer', 'order', 'production', 'completed']::public.project_status[], v_stage);
  end if;
  return null;
end
$$;

create trigger sales_orders_project_stage after insert or update of status on public.sales_orders
  for each row execute function public.sales_orders_project_stage();

-- ---------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------

-- Order from an offer at one of its quantities
create or replace function public.create_order_from_offer(
  p_offer         uuid,
  p_quantity      integer,
  p_customer_ref  text default null,
  p_requested     date default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  o     public.offers;
  v_price numeric;
  v_id  uuid;
begin
  perform public.require_role('admin', 'sales');
  select * into o from public.offers where id = p_offer;
  if not found then
    raise exception 'Unknown offer';
  end if;
  if o.status not in ('sent', 'accepted') then
    raise exception 'Only a sent or accepted offer can become an order';
  end if;
  if o.project_id is null then
    raise exception 'Link the offer to a project first';
  end if;
  select unit_price into v_price from public.offer_tiers where offer_id = p_offer and quantity = p_quantity;
  if v_price is null then
    raise exception 'The offer has no price for % packs', p_quantity;
  end if;

  insert into public.sales_orders (client_id, project_id, offer_id, formula_version_id, quantity, unit_price, currency,
                                   deposit_pct, balance_terms, balance_net_days, customer_ref, requested_date)
  values (o.client_id, o.project_id, o.id, o.formula_version_id, p_quantity, v_price, o.currency,
          o.deposit_pct, o.balance_terms, o.balance_net_days, p_customer_ref, p_requested)
  returning id into v_id;

  if o.status <> 'accepted' then
    update public.offers set status = 'accepted' where id = p_offer;
  end if;
  return v_id;
end
$$;

-- Materials an order needs (base units), what is reserved for its
-- project and what is available. No prices.
create or replace function public.order_material_requirements(p_order uuid)
returns table (
  item_id uuid, sku text, name text, name_bg text, kind text, base_unit public.base_unit,
  required numeric, reserved numeric, available numeric
)
language plpgsql stable security definer set search_path = public
as $$
declare
  so public.sales_orders;
begin
  perform public.require_role('admin', 'sales', 'inventory');
  select * into so from public.sales_orders where id = p_order;
  if not found then
    raise exception 'Unknown order';
  end if;
  return query
    select c.item_id, min(c.sku), min(c.name), min(c.name_bg), min(c.kind), min(c.base_unit),
           round(sum(c.qty_per_pack) * so.quantity, 4) as required,
           coalesce((select sum(r.quantity) from public.stock_reservations r
                      where r.item_id = c.item_id and r.project_id = so.project_id and r.status = 'active'), 0) as reserved,
           coalesce((select s.available from public.item_stock_summary s where s.item_id = c.item_id), 0) as available
      from public.offer_cost_lines(so.offer_id, so.quantity) c
     where c.item_id is not null and c.qty_per_pack is not null
     group by c.item_id
     order by min(c.kind), min(c.name);
end
$$;

-- Reserve what is still missing for the order, as far as stock allows.
-- Returns the number of items for which something was reserved.
create or replace function public.reserve_order_materials(p_order uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  so    public.sales_orders;
  r     record;
  v_qty numeric;
  v_n   integer := 0;
begin
  perform public.require_role('admin', 'sales', 'inventory');
  select * into so from public.sales_orders where id = p_order;
  if not found then
    raise exception 'Unknown order';
  end if;
  if so.status not in ('confirmed', 'in_production') then
    raise exception 'Materials are reserved for confirmed orders';
  end if;
  for r in select * from public.order_material_requirements(p_order) loop
    v_qty := least(r.required - r.reserved, r.available);
    if v_qty > 0 then
      perform public.reserve_stock(r.item_id, so.project_id, v_qty, null, null, 'Order ' || so.code);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;

-- ---------------------------------------------------------------------
-- Overview without prices, for Inventory (deliberately not
-- security_invoker: it exposes only these columns, to staff only)
-- ---------------------------------------------------------------------
create view public.sales_order_overview as
select so.id, so.code, so.status, so.quantity, so.requested_date, so.created_at, so.confirmed_at, so.dispatched_at,
       so.client_id, c.legal_name as client, so.project_id, p.code as project_code, p.name as project_name,
       f.id as formula_id, f.code as formula_code, f.name as product, f.name_bg as product_bg, f.product_format,
       v.version as formula_version
  from public.sales_orders so
  join public.clients c on c.id = so.client_id
  join public.projects p on p.id = so.project_id
  join public.formula_versions v on v.id = so.formula_version_id
  join public.formulas f on f.id = v.formula_id
 where public.has_role('admin', 'sales', 'inventory');

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.sales_orders enable row level security;

-- Created only by create_order_from_offer()
create policy sales_orders_select on public.sales_orders for select to authenticated
  using (public.has_role('admin', 'sales'));
create policy sales_orders_update on public.sales_orders for update to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));
create policy sales_orders_delete on public.sales_orders for delete to authenticated
  using (public.has_role('admin') and status = 'draft');

revoke all on public.sales_order_overview from anon;
grant select on public.sales_order_overview to authenticated;

revoke execute on function
  public.sales_orders_guard(),
  public.sales_orders_project_stage(),
  public.create_order_from_offer(uuid, integer, text, date),
  public.order_material_requirements(uuid),
  public.reserve_order_materials(uuid)
from public, anon, authenticated;

grant execute on function
  public.create_order_from_offer(uuid, integer, text, date),
  public.order_material_requirements(uuid),
  public.reserve_order_materials(uuid)
to authenticated;
