-- =====================================================================
-- Nutrikal ERP + CRM — orders from calculator offers
-- Flow (owner, Oct 2026):
--   1. Sales creates the client in Clients (CRM).
--   2. Sales makes the offer in the calculator for that client (product
--      only; calc_offers.client_id).
--   3. Admin creates the order from one or more of the client's calculator
--      offers plus extra services; it starts as UNPAID and its proforma
--      ("according to offer No …") is printed.
--   4. When the client has paid, admin confirms the payment (→ confirmed)
--      and releases it to production. A calculator line has no ERP formula
--      yet: production for it is planned once it is linked to an approved
--      formula version (later step); the manufacturing-order guard already
--      refuses a line without one.
--
-- Order lines are of three kinds:
--   offer       ERP offer (offer, project and formula version) — as before
--   calc_offer  calculator offer: product name, quantity and unit price
--               copied from the offer
--   service     extra service (certificate, label design…), never produced
--
--                          admin   sales   production
-- create from calc offers  yes     —       —
-- confirm payment          yes     —       —
-- orders, lines            all     all     —   (unchanged)
-- =====================================================================

alter type public.order_status add value if not exists 'unpaid' before 'confirmed';

-- ------------------------------------------- calculator offer → client
alter table public.calc_offers add column client_id uuid references public.clients (id);
create index calc_offers_client_idx on public.calc_offers (client_id);

-- An offer that is in an order (not cancelled) is fixed: the order and its
-- proforma quote it. Changes go into a copy (Duplicate) instead.
create or replace function public.calc_offers_in_order_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from public.sales_order_lines l join public.sales_orders so on so.id = l.order_id
              where l.calc_offer_id = old.id and so.status <> 'cancelled') then
    raise exception 'Offer % is in an order and can no longer be changed', old.offer_no;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke execute on function public.calc_offers_in_order_guard() from public, anon, authenticated;

-- ----------------------------------------------------- order lines
alter table public.sales_order_lines
  alter column offer_id drop not null,
  alter column project_id drop not null,
  alter column formula_version_id drop not null,
  add column kind text not null default 'offer' check (kind in ('offer', 'calc_offer', 'service')),
  add column calc_offer_id uuid references public.calc_offers (id),
  add column description text,
  add constraint sales_order_lines_kind_chk check (
    (kind = 'offer' and offer_id is not null and project_id is not null and formula_version_id is not null)
    or (kind = 'calc_offer' and calc_offer_id is not null and offer_id is null and description is not null)
    or (kind = 'service' and offer_id is null and calc_offer_id is null and project_id is null
        and formula_version_id is null and description is not null)
  );
create index sales_order_lines_calc_offer_idx on public.sales_order_lines (calc_offer_id);

create trigger calc_offers_in_order_guard before update or delete on public.calc_offers
  for each row execute function public.calc_offers_in_order_guard();

-- VAT % on the proforma (chosen by admin when the order is created)
alter table public.sales_orders add column vat_pct numeric(5, 2) check (vat_pct between 0 and 100);

-- ------------------------------------------------- status rules
-- As before, plus: draft → unpaid (proforma issued); unpaid → confirmed
-- (payment received; admin only) or cancelled.
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
      (old.status = 'draft'         and new.status in ('unpaid', 'confirmed', 'cancelled')) or
      (old.status = 'unpaid'        and new.status in ('confirmed', 'cancelled')) or
      (old.status = 'confirmed'     and new.status in ('in_production', 'draft', 'cancelled')) or
      (old.status = 'in_production' and new.status in ('ready', 'cancelled')) or
      (old.status = 'ready'         and new.status = 'dispatched') or
      (old.status = 'dispatched'    and new.status = 'closed')
    ) then
      raise exception 'An order cannot go from % to %', old.status, new.status;
    end if;

    if new.status in ('unpaid', 'confirmed') and not exists (select 1 from public.sales_order_lines where order_id = new.id) then
      raise exception 'An order without products cannot be confirmed';
    end if;
    if old.status = 'unpaid' and new.status = 'confirmed' then
      if not v_admin then
        raise exception 'Only admin confirms the payment';
      end if;
      -- The proforma is for the full amount: paid in full
      new.deposit_received_on := coalesce(new.deposit_received_on, current_date);
      new.balance_received_on := coalesce(new.balance_received_on, current_date);
    end if;
    if new.status = 'in_production' and coalesce(new.deposit_pct, 0) > 0
       and new.deposit_received_on is null and not v_admin then
      raise exception 'The deposit has not been received yet';
    end if;
    if new.status = 'dispatched' and new.balance_terms = 'before_dispatch'
       and new.balance_received_on is null and not v_admin then
      raise exception 'The balance must be paid before dispatch';
    end if;

    if new.status = 'confirmed' and old.status in ('draft', 'unpaid') then
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

-- Lines: as before; the new columns are fixed once added too
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
  if tg_op = 'UPDATE' and (new.order_id, new.offer_id, new.project_id, new.formula_version_id, new.quantity, new.unit_price,
                           new.kind, new.calc_offer_id, new.description)
                          is distinct from (old.order_id, old.offer_id, old.project_id, old.formula_version_id, old.quantity, old.unit_price,
                           old.kind, old.calc_offer_id, old.description) then
    raise exception 'Remove the line and add it again from the offer';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

-- ------------------------------------------- create from calc offers
-- p_services: [{"description": "Label design", "quantity": 1, "unit_price": 200}, …]
create or replace function public.create_order_from_calc_offers(
  p_client        uuid,
  p_offers        uuid[],
  p_services      jsonb default '[]'::jsonb,
  p_vat_pct       numeric default null,
  p_customer_ref  text default null,
  p_requested     date default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  c      public.clients;
  o      public.calc_offers;
  v_id   uuid;
  v_qty  integer;
  v_price numeric;
  v_n    integer := 0;
  s      record;
begin
  perform public.require_role('admin');
  select * into c from public.clients where id = p_client;
  if not found then
    raise exception 'Unknown client';
  end if;
  if coalesce(array_length(p_offers, 1), 0) = 0 then
    raise exception 'Choose at least one offer';
  end if;

  insert into public.sales_orders (client_id, currency, deposit_pct, balance_terms, balance_net_days, vat_pct, customer_ref, requested_date)
  values (c.id, 'EUR', c.deposit_pct, c.balance_terms, c.balance_net_days, p_vat_pct, nullif(trim(p_customer_ref), ''), p_requested)
  returning id into v_id;

  for o in select * from public.calc_offers where id = any (p_offers) order by offer_no loop
    if o.client_id is distinct from c.id then
      raise exception 'Offer % is for another client', o.offer_no;
    end if;
    if exists (select 1 from public.sales_order_lines l join public.sales_orders so on so.id = l.order_id
                where l.calc_offer_id = o.id and so.status <> 'cancelled') then
      raise exception 'Offer % is already in an order', o.offer_no;
    end if;
    v_qty := nullif(o.data ->> 'numberOfUnits', '')::numeric::integer;
    v_price := nullif(o.results ->> 'unitPrice', '')::numeric;
    if coalesce(v_qty, 0) <= 0 or coalesce(v_price, 0) <= 0 then
      raise exception 'Offer % has no quantity or price', o.offer_no;
    end if;
    insert into public.sales_order_lines (order_id, kind, calc_offer_id, description, quantity, unit_price, sort_order)
    values (v_id, 'calc_offer', o.id, coalesce(nullif(o.product_name, ''), o.offer_no), v_qty, v_price, v_n);
    v_n := v_n + 1;
  end loop;
  if v_n <> array_length(p_offers, 1) then
    raise exception 'Unknown offer';
  end if;

  for s in select * from jsonb_to_recordset(coalesce(p_services, '[]'::jsonb)) as x(description text, quantity integer, unit_price numeric) loop
    if nullif(trim(s.description), '') is null or coalesce(s.quantity, 0) <= 0 or s.unit_price is null or s.unit_price < 0 then
      raise exception 'Each service needs a description, a quantity above 0 and a price';
    end if;
    insert into public.sales_order_lines (order_id, kind, description, quantity, unit_price, sort_order)
    values (v_id, 'service', trim(s.description), s.quantity, s.unit_price, v_n);
    v_n := v_n + 1;
  end loop;

  update public.sales_orders set status = 'unpaid' where id = v_id;
  return v_id;
end
$$;

revoke execute on function public.create_order_from_calc_offers(uuid, uuid[], jsonb, numeric, text, date) from public, anon;
grant execute on function public.create_order_from_calc_offers(uuid, uuid[], jsonb, numeric, text, date) to authenticated;

-- ------------------------------------------------------------ views
-- Packs count products only (no services); lines of every kind are listed.
create or replace view public.sales_order_overview as
select so.id, so.code, so.status, so.requested_date, so.created_at, so.confirmed_at, so.dispatched_at,
       so.client_id, c.legal_name as client,
       (select count(*)::int from public.sales_order_lines l where l.order_id = so.id and l.kind <> 'service') as line_count,
       (select coalesce(sum(l.quantity), 0)::int from public.sales_order_lines l where l.order_id = so.id and l.kind <> 'service') as total_packs
  from public.sales_orders so
  join public.clients c on c.id = so.client_id
 where public.has_role('admin', 'sales');

create or replace view public.sales_order_line_overview as
select l.id, l.order_id, l.quantity, l.sort_order, l.project_id, p.code as project_code, p.name as project_name,
       f.id as formula_id, f.code as formula_code, coalesce(f.name, l.description) as product, f.name_bg as product_bg, f.product_format,
       v.id as formula_version_id, v.version as formula_version, l.offer_id,
       l.kind, l.calc_offer_id, co.offer_no as calc_offer_no
  from public.sales_order_lines l
  left join public.projects p on p.id = l.project_id
  left join public.formula_versions v on v.id = l.formula_version_id
  left join public.formulas f on f.id = v.formula_id
  left join public.calc_offers co on co.id = l.calc_offer_id
 where public.has_role('admin', 'sales');

revoke insert, update, delete, truncate, references, trigger on public.sales_order_overview, public.sales_order_line_overview from anon, authenticated;
