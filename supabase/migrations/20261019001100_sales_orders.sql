-- =====================================================================
-- Nutrikal ERP + CRM — Phase 3 — 0011 sales orders
-- An order belongs to one client and can hold several products. Each
-- line comes from a sent or accepted offer of that client (one approved
-- formula version, one project) at one of the offer's quantities.
-- Production of each line is planned with manufacturing orders (0012).
--
-- Rules
-- * Orders and lines are created only from offers
--   (create_order_from_offer, add_order_line_from_offer); the offer
--   becomes accepted and the line price is the price of that quantity.
-- * Status: draft → confirmed → in_production → ready → dispatched →
--   closed; draft/confirmed/in_production can be cancelled; confirmed can
--   go back to draft. Lines change only on a draft.
-- * Production starts only after the deposit is received (when there is
--   a deposit). With "balance before dispatch" the order is dispatched
--   only after the balance is received. Admin may override both.
-- * The stage of each line's project follows the order.
--
--                         admin   sales   inventory   partner
-- orders, lines (prices)  all     all     —           —
-- order overview          read    read    read        —      (no prices)
-- =====================================================================

create type public.order_status as enum (
  'draft', 'confirmed', 'in_production', 'ready', 'dispatched', 'closed', 'cancelled'
);

create table public.sales_orders (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,                          -- e.g. SO-00001
  client_id            uuid not null references public.clients (id),
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
create index sales_orders_client_idx on public.sales_orders (client_id);
create index sales_orders_status_idx on public.sales_orders (status);

create table public.sales_order_lines (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.sales_orders (id) on delete cascade,
  offer_id            uuid not null references public.offers (id),
  project_id          uuid not null references public.projects (id),
  formula_version_id  uuid not null references public.formula_versions (id),
  quantity            integer not null check (quantity > 0),              -- packs
  unit_price          numeric(12, 4) not null check (unit_price >= 0),
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now()
);
create index sales_order_lines_order_idx   on public.sales_order_lines (order_id);
create index sales_order_lines_project_idx on public.sales_order_lines (project_id);

create trigger sales_orders_updated_at before update on public.sales_orders
  for each row execute function public.set_updated_at();
select public.enable_audit('public.sales_orders');
select public.enable_audit('public.sales_order_lines');

-- ---------------------------------------------------------------------
-- Rules
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
    return new;
  end if;

  if new.client_id <> old.client_id or new.currency <> old.currency then
    raise exception 'Client and currency of an order cannot be changed';
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

    if new.status = 'confirmed' and not exists (select 1 from public.sales_order_lines where order_id = new.id) then
      raise exception 'An order without products cannot be confirmed';
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

-- Lines change only on a draft order (and only through the functions)
create or replace function public.sales_order_lines_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_status public.order_status;
begin
  select status into v_status from public.sales_orders
   where id = case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  if v_status is null and tg_op = 'DELETE' then
    return old;   -- the order itself is being deleted
  end if;
  if v_status <> 'draft' then
    raise exception 'Products can only change on a draft order';
  end if;
  if tg_op = 'UPDATE' and (new.order_id, new.offer_id, new.project_id, new.formula_version_id, new.quantity, new.unit_price)
                          is distinct from (old.order_id, old.offer_id, old.project_id, old.formula_version_id, old.quantity, old.unit_price) then
    raise exception 'Remove the line and add it again from the offer';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger sales_order_lines_guard before insert or update or delete on public.sales_order_lines
  for each row execute function public.sales_order_lines_guard();

-- The stage of every line's project follows the order (forward only)
create or replace function public.sales_orders_project_stage()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_stage public.project_status;
  v_steps public.project_status[] := array['inquiry', 'formulation', 'offer', 'order', 'production', 'completed'];
begin
  v_stage := case new.status
               when 'confirmed' then 'order'
               when 'in_production' then 'production'
               when 'ready' then 'production'
               when 'dispatched' then 'completed'
               when 'closed' then 'completed'
             end;
  if v_stage is not null then
    update public.projects p
       set status = v_stage
      from public.sales_order_lines l
     where l.order_id = new.id and p.id = l.project_id
       and p.status <> v_stage
       and array_position(v_steps, p.status) < array_position(v_steps, v_stage);
  end if;
  return null;
end
$$;

create trigger sales_orders_project_stage after update of status on public.sales_orders
  for each row execute function public.sales_orders_project_stage();

-- ---------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------

-- Adds an offer's product at one of its quantities to a draft order
create or replace function public.add_order_line_from_offer(p_order uuid, p_offer uuid, p_quantity integer)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  so      public.sales_orders;
  o       public.offers;
  v_price numeric;
  v_id    uuid;
begin
  perform public.require_role('admin', 'sales');
  select * into so from public.sales_orders where id = p_order;
  select * into o from public.offers where id = p_offer;
  if so.id is null or o.id is null then
    raise exception 'Unknown order or offer';
  end if;
  if o.client_id <> so.client_id then
    raise exception 'The offer is for another client';
  end if;
  if o.currency <> so.currency then
    raise exception 'The offer is in another currency';
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

  insert into public.sales_order_lines (order_id, offer_id, project_id, formula_version_id, quantity, unit_price, sort_order)
  values (p_order, p_offer, o.project_id, o.formula_version_id, p_quantity, v_price,
          (select count(*) from public.sales_order_lines where order_id = p_order))
  returning id into v_id;

  if o.status <> 'accepted' then
    update public.offers set status = 'accepted' where id = p_offer;
  end if;
  return v_id;
end
$$;

-- New order (terms from the offer) with the offer's product as first line
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
  o    public.offers;
  v_id uuid;
begin
  perform public.require_role('admin', 'sales');
  select * into o from public.offers where id = p_offer;
  if not found then
    raise exception 'Unknown offer';
  end if;
  insert into public.sales_orders (client_id, currency, deposit_pct, balance_terms, balance_net_days, customer_ref, requested_date)
  values (o.client_id, o.currency, o.deposit_pct, o.balance_terms, o.balance_net_days, p_customer_ref, p_requested)
  returning id into v_id;
  perform public.add_order_line_from_offer(v_id, p_offer, p_quantity);
  return v_id;
end
$$;

-- ---------------------------------------------------------------------
-- Overviews without prices, for Inventory (deliberately not
-- security_invoker: they expose only these columns, to staff only)
-- ---------------------------------------------------------------------
create view public.sales_order_overview as
select so.id, so.code, so.status, so.requested_date, so.created_at, so.confirmed_at, so.dispatched_at,
       so.client_id, c.legal_name as client,
       (select count(*)::int from public.sales_order_lines l where l.order_id = so.id) as line_count,
       (select coalesce(sum(l.quantity), 0)::int from public.sales_order_lines l where l.order_id = so.id) as total_packs
  from public.sales_orders so
  join public.clients c on c.id = so.client_id
 where public.has_role('admin', 'sales', 'inventory');

create view public.sales_order_line_overview as
select l.id, l.order_id, l.quantity, l.sort_order, l.project_id, p.code as project_code, p.name as project_name,
       f.id as formula_id, f.code as formula_code, f.name as product, f.name_bg as product_bg, f.product_format,
       v.id as formula_version_id, v.version as formula_version, l.offer_id
  from public.sales_order_lines l
  join public.projects p on p.id = l.project_id
  join public.formula_versions v on v.id = l.formula_version_id
  join public.formulas f on f.id = v.formula_id
 where public.has_role('admin', 'sales', 'inventory');

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.sales_orders      enable row level security;
alter table public.sales_order_lines enable row level security;

-- Created only by the functions above
create policy sales_orders_select on public.sales_orders for select to authenticated
  using (public.has_role('admin', 'sales'));
create policy sales_orders_update on public.sales_orders for update to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));
create policy sales_orders_delete on public.sales_orders for delete to authenticated
  using (public.has_role('admin') and status = 'draft');

create policy sales_order_lines_select on public.sales_order_lines for select to authenticated
  using (public.has_role('admin', 'sales'));
create policy sales_order_lines_delete on public.sales_order_lines for delete to authenticated
  using (public.has_role('admin', 'sales'));

revoke all on public.sales_order_overview, public.sales_order_line_overview from anon;
grant select on public.sales_order_overview, public.sales_order_line_overview to authenticated;

revoke execute on function
  public.sales_orders_guard(),
  public.sales_order_lines_guard(),
  public.sales_orders_project_stage(),
  public.add_order_line_from_offer(uuid, uuid, integer),
  public.create_order_from_offer(uuid, integer, text, date)
from public, anon, authenticated;

grant execute on function
  public.add_order_line_from_offer(uuid, uuid, integer),
  public.create_order_from_offer(uuid, integer, text, date)
to authenticated;
