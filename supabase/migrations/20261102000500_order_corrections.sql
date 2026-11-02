-- =====================================================================
-- Nutrikal ERP + CRM — corrections of an order until it goes to production
-- (owner, Nov 2026)
--
-- Admin and Sales (the bookkeeper too, as everywhere Sales may) correct an
-- order while it is a draft, unpaid or confirmed and no manufacturing order
-- of it has been sent to production:
--   * quantity and unit price of a line, remove a line, add a calculator
--     offer of the client or a service line;
--   * VAT % and the terms of the balance;
--   * client and currency.
-- Every correction needs a reason and is kept in order_corrections (who,
-- when, before and after), next to the audit log of the tables.
--
-- What a correction does around the order:
--   * Draft invoices of the order are deleted; they are made again from the
--     corrected order when opened. Issued invoices stay as they are: with one,
--     VAT, client and currency no longer change (a credit or debit note).
--   * A manufacturing order of a changed or removed line that is not yet sent
--     to production (simulation, scheduled) is cancelled: its reservations
--     are released and its open purchase requests cancelled. Admin runs
--     Prepare production again.
--   * A client change needs an order whose lines are not yet tied to a
--     recipe or project and that has no manufacturing order; the calculator
--     offers of its lines and the recipes made from them move to the new
--     client. Files and messages of the order stay with the old client.
--   * The task board follows (order_tasks_sync).
--
-- Production: order_corrections has no policy for it (like sales orders).
-- =====================================================================

create table public.order_corrections (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.sales_orders (id) on delete cascade,
  kind        text not null check (kind in ('line', 'line_added', 'line_removed', 'terms', 'client')),
  detail      jsonb not null default '{}'::jsonb,
  reason      text not null check (btrim(reason) <> ''),
  created_by  uuid references public.profiles (id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index order_corrections_order_idx on public.order_corrections (order_id, created_at);
alter table public.order_corrections enable row level security;
create policy order_corrections_select on public.order_corrections for select to authenticated
  using (public.has_role('admin', 'sales'));
grant select on public.order_corrections to authenticated;

-- ---------------------------------------------------------------------
-- Guards: a correction (nk.order_correct) passes the locks it needs
-- ---------------------------------------------------------------------
create or replace function public.sales_orders_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_admin boolean := public.has_role('admin');
  -- Payments: Admin and the bookkeeper (owner, Oct 2026)
  v_pays  boolean := public.has_role('admin') or public.current_app_role() = 'bookkeeper';
begin
  if tg_op = 'INSERT' then
    if new.code is null or new.code = '' then
      new.code := public.next_number('sales_order');
    end if;
    return new;
  end if;

  -- A correction (correct_order_client) may change them; nothing else (owner, Nov 2026)
  if (new.client_id <> old.client_id or new.currency <> old.currency)
     and current_setting('nk.order_correct', true) is distinct from 'on' then
    raise exception 'Client and currency of an order cannot be changed';
  end if;

  if new.status <> old.status then
    if not (
      (old.status = 'draft'         and new.status in ('unpaid', 'confirmed', 'cancelled')) or
      (old.status = 'unpaid'        and new.status in ('confirmed', 'cancelled')) or
      (old.status = 'confirmed'     and new.status in ('in_production', 'draft', 'cancelled')) or
      (old.status = 'in_production' and new.status in ('ready', 'cancelled', 'confirmed')) or
      (old.status = 'ready'         and new.status = 'dispatched') or
      (old.status = 'dispatched'    and new.status = 'closed') or
      (old.status = 'confirmed'     and new.status = 'unpaid' and current_setting('nk.cancel_payment', true) = 'on')
    ) then
      raise exception 'An order cannot go from % to %', old.status, new.status;
    end if;

    if new.status in ('unpaid', 'confirmed') and not exists (select 1 from public.sales_order_lines where order_id = new.id) then
      raise exception 'An order without products cannot be confirmed';
    end if;
    if old.status = 'unpaid' and new.status = 'confirmed' then
      if not v_pays then
        raise exception 'Only admin confirms the payment' using errcode = '42501';
      end if;
      new.deposit_received_on := coalesce(new.deposit_received_on, current_date);
      if not (coalesce(new.deposit_pct, 0) > 0 and new.deposit_pct < 100) then
        new.balance_received_on := coalesce(new.balance_received_on, current_date);
      end if;
    end if;
    -- An order with calculator offers goes back to unpaid, never to draft
    if new.status = 'draft' and exists (select 1 from public.sales_order_lines where order_id = new.id and kind <> 'offer') then
      raise exception 'An order from calculator offers cannot go back to draft';
    end if;
    if new.status = 'in_production' and coalesce(new.deposit_pct, 0) > 0
       and new.deposit_received_on is null and not v_admin then
      raise exception 'The deposit has not been received yet';
    end if;
    -- Production sees manufacturing orders only: the order is in production once one is sent to it
    if new.status = 'in_production' and not public.order_sent_to_production(new.id) then
      raise exception 'No manufacturing order of this order has been sent to production yet';
    end if;
    if old.status = 'in_production' and new.status = 'confirmed' and public.order_sent_to_production(new.id) then
      raise exception 'Production has this order; it cannot go back to confirmed';
    end if;
    if new.status = 'dispatched' and new.balance_terms = 'before_dispatch'
       and new.balance_received_on is null and not v_admin then
      raise exception 'The balance must be paid before dispatch';
    end if;

    if new.status = 'confirmed' and old.status in ('draft', 'unpaid') then
      new.confirmed_at := now();
    elsif new.status in ('draft', 'unpaid') then
      new.confirmed_at := null;
    elsif new.status = 'dispatched' then
      new.dispatched_at := now();
    end if;
  end if;
  return new;
end
$$;


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
  if tg_op = 'UPDATE' and current_setting('nk.line_link', true) = 'on' then
    return new;
  end if;
  -- Corrections of an order not yet in production check their own rules (correct_order_*)
  if current_setting('nk.order_correct', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if v_status <> 'draft' and not (tg_op = 'INSERT' and current_setting('nk.order_create', true) = 'on') then
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


create or replace function public.calc_offers_in_order_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_link text;
begin
  -- A client correction of the order moves its offers to the new client
  if tg_op = 'UPDATE' and current_setting('nk.order_correct', true) = 'on'
     and (to_jsonb(new) - 'client_id' - 'updated_at') = (to_jsonb(old) - 'client_id' - 'updated_at') then
    return new;
  end if;
  if exists (select 1 from public.sales_order_lines l join public.sales_orders so on so.id = l.order_id
              where l.calc_offer_id = old.id and so.status <> 'cancelled') then
    raise exception 'Offer % is in an order and can no longer be changed', old.offer_no;
  end if;
  if tg_op = 'DELETE' then
    -- Only cancelled orders are left: their lines lose the link to the offer
    v_link := current_setting('nk.line_link', true);
    perform set_config('nk.line_link', 'on', true);
    update public.sales_order_lines set calc_offer_id = null where calc_offer_id = old.id;
    perform set_config('nk.line_link', coalesce(v_link, 'off'), true);
    return old;
  end if;
  return new;
end
$$;


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
    -- A cancelled MO lets go of an order line removed by a correction (owner, Nov 2026)
    if old.status = 'cancelled' and new.sales_order_line_id is null
       and current_setting('nk.order_correct', true) = 'on'
       and (new.quantity, new.formula_version_id, new.project_id) is not distinct from (old.quantity, old.formula_version_id, old.project_id) then
      return new;
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


-- ---------------------------------------------------------------------
-- Shared steps
-- ---------------------------------------------------------------------
-- The order, if it may still be corrected; the reason is required
create or replace function public.order_correction_start(p_order uuid, p_reason text)
returns public.sales_orders
language plpgsql security definer set search_path = public
as $$
declare
  so public.sales_orders;
begin
  perform public.require_role('admin', 'sales');
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for the correction';
  end if;
  select * into so from public.sales_orders where id = p_order for update;
  if not found then
    raise exception 'Unknown order';
  end if;
  if so.status not in ('draft', 'unpaid', 'confirmed') or public.order_sent_to_production(so.id) then
    raise exception 'Only an order not yet sent to production can be corrected';
  end if;
  perform set_config('nk.order_correct', 'on', true);
  return so;
end
$$;

-- Cancels the manufacturing orders of a line not yet sent to production
create or replace function public.order_correction_cancel_mos(p_line uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  m record;
  n integer := 0;
begin
  for m in select id from public.manufacturing_orders
            where sales_order_line_id = p_line and status in ('simulation', 'scheduled') loop
    update public.stock_reservations set status = 'released', closed_by = auth.uid(), closed_at = now()
     where manufacturing_order_id = m.id and status = 'active';
    update public.purchase_requests set status = 'cancelled' where manufacturing_order_id = m.id and status = 'open';
    perform set_config('nk.mo_transition', 'on', true);
    update public.manufacturing_orders set status = 'cancelled' where id = m.id;
    perform set_config('nk.mo_transition', 'off', true);
    n := n + 1;
  end loop;
  return n;
end
$$;

-- After a correction: draft invoices go, the log, the task board follows
create or replace function public.order_correction_finish(p_order uuid, p_kind text, p_detail jsonb, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.invoices where order_id = p_order and status = 'draft';
  insert into public.order_corrections (order_id, kind, detail, reason, created_by)
  values (p_order, p_kind, coalesce(p_detail, '{}'::jsonb), btrim(p_reason), auth.uid());
  perform set_config('nk.order_correct', 'off', true);
  if exists (select 1 from public.order_task_boards where sales_order_id = p_order) then
    perform public.order_tasks_sync(p_order, 'correction');
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Corrections
-- ---------------------------------------------------------------------
-- Quantity and unit price of a line
create or replace function public.correct_order_line(p_line uuid, p_quantity integer, p_unit_price numeric, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  l  public.sales_order_lines;
  so public.sales_orders;
  v_mos integer := 0;
begin
  select * into l from public.sales_order_lines where id = p_line;
  if not found then
    raise exception 'Unknown order line';
  end if;
  so := public.order_correction_start(l.order_id, p_reason);
  if coalesce(p_quantity, 0) <= 0 or p_unit_price is null or p_unit_price < 0 then
    raise exception 'Quantity must be above 0 and the price 0 or more';
  end if;
  if p_quantity = l.quantity and round(p_unit_price, 4) = l.unit_price then
    raise exception 'Nothing to correct';
  end if;
  if p_quantity <> l.quantity then
    v_mos := public.order_correction_cancel_mos(l.id);
  end if;
  update public.sales_order_lines set quantity = p_quantity, unit_price = round(p_unit_price, 4) where id = l.id;
  perform public.order_correction_finish(so.id, 'line', jsonb_build_object(
    'product', coalesce(l.description, ''),
    'quantity', jsonb_build_array(l.quantity, p_quantity),
    'unit_price', jsonb_build_array(l.unit_price, round(p_unit_price, 4)),
    'mos_cancelled', v_mos), p_reason);
end
$$;

-- Removes a line; an order past the draft keeps at least one product
create or replace function public.correct_order_remove_line(p_line uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  l  public.sales_order_lines;
  so public.sales_orders;
  v_mos integer;
begin
  select * into l from public.sales_order_lines where id = p_line;
  if not found then
    raise exception 'Unknown order line';
  end if;
  so := public.order_correction_start(l.order_id, p_reason);
  if so.status <> 'draft' and l.kind <> 'service'
     and not exists (select 1 from public.sales_order_lines where order_id = so.id and kind <> 'service' and id <> l.id) then
    raise exception 'The last product of an order cannot be removed: cancel the order instead';
  end if;
  v_mos := public.order_correction_cancel_mos(l.id);
  -- the cancelled manufacturing orders keep their history without the line
  update public.manufacturing_orders set sales_order_line_id = null where sales_order_line_id = l.id and status = 'cancelled';
  delete from public.sales_order_lines where id = l.id;
  perform public.order_correction_finish(so.id, 'line_removed', jsonb_build_object(
    'product', coalesce(l.description, ''), 'kind', l.kind, 'quantity', l.quantity, 'unit_price', l.unit_price,
    'mos_cancelled', v_mos), p_reason);
end
$$;

-- Adds a calculator offer of the client, at its quantity and price (both correctable after)
create or replace function public.correct_order_add_offer(p_order uuid, p_offer uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  so      public.sales_orders;
  o       public.calc_offers;
  v_qty   integer;
  v_price numeric;
  v_id    uuid;
begin
  so := public.order_correction_start(p_order, p_reason);
  select * into o from public.calc_offers where id = p_offer;
  if not found then
    raise exception 'Unknown offer';
  end if;
  if o.client_id is distinct from so.client_id then
    raise exception 'Offer % is for another client', o.offer_no;
  end if;
  if exists (select 1 from public.sales_order_lines l join public.sales_orders x on x.id = l.order_id
              where l.calc_offer_id = o.id and x.status <> 'cancelled') then
    raise exception 'Offer % is already in an order', o.offer_no;
  end if;
  v_qty := nullif(o.data ->> 'numberOfUnits', '')::numeric::integer;
  v_price := nullif(o.results ->> 'unitPrice', '')::numeric;
  if coalesce(v_qty, 0) <= 0 or coalesce(v_price, 0) <= 0 then
    raise exception 'Offer % has no quantity or price', o.offer_no;
  end if;
  insert into public.sales_order_lines (order_id, kind, calc_offer_id, description, quantity, unit_price, sort_order)
  values (so.id, 'calc_offer', o.id, coalesce(nullif(o.product_name, ''), o.offer_no), v_qty, round(v_price, 4),
          coalesce((select max(sort_order) + 1 from public.sales_order_lines where order_id = so.id), 0))
  returning id into v_id;
  perform public.order_correction_finish(so.id, 'line_added', jsonb_build_object(
    'product', coalesce(nullif(o.product_name, ''), o.offer_no), 'offer_no', o.offer_no,
    'quantity', v_qty, 'unit_price', round(v_price, 4)), p_reason);
  return v_id;
end
$$;

-- Adds a service line
create or replace function public.correct_order_add_service(p_order uuid, p_description text, p_quantity integer,
                                                            p_unit_price numeric, p_reason text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  so   public.sales_orders;
  v_id uuid;
begin
  so := public.order_correction_start(p_order, p_reason);
  if coalesce(btrim(p_description), '') = '' or coalesce(p_quantity, 0) <= 0 or p_unit_price is null or p_unit_price < 0 then
    raise exception 'Each service needs a description, a quantity above 0 and a price';
  end if;
  insert into public.sales_order_lines (order_id, kind, description, quantity, unit_price, sort_order)
  values (so.id, 'service', btrim(p_description), p_quantity, round(p_unit_price, 4),
          coalesce((select max(sort_order) + 1 from public.sales_order_lines where order_id = so.id), 0))
  returning id into v_id;
  perform public.order_correction_finish(so.id, 'line_added', jsonb_build_object(
    'product', btrim(p_description), 'kind', 'service', 'quantity', p_quantity, 'unit_price', round(p_unit_price, 4)), p_reason);
  return v_id;
end
$$;

-- VAT % and the terms of the balance
create or replace function public.correct_order_terms(p_order uuid, p_vat_pct numeric, p_balance_terms public.balance_terms,
                                                      p_balance_net_days integer, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  so public.sales_orders;
  v_days integer := case when p_balance_terms = 'net_days' then p_balance_net_days end;
begin
  so := public.order_correction_start(p_order, p_reason);
  if p_vat_pct is null or p_vat_pct < 0 or p_vat_pct > 100 then
    raise exception 'VAT must be from 0 to 100';
  end if;
  if p_balance_terms is null or (p_balance_terms = 'net_days' and coalesce(p_balance_net_days, 0) <= 0) then
    raise exception 'Choose the terms of the balance (days above 0 for net days)';
  end if;
  if p_vat_pct is distinct from so.vat_pct
     and exists (select 1 from public.invoices where order_id = so.id and status = 'issued') then
    raise exception 'An invoice of this order is issued: correct VAT with a credit or debit note';
  end if;
  if p_vat_pct is not distinct from so.vat_pct and p_balance_terms is not distinct from so.balance_terms
     and (p_balance_terms <> 'net_days' or v_days is not distinct from so.balance_net_days) then
    raise exception 'Nothing to correct';
  end if;
  update public.sales_orders
     set vat_pct = p_vat_pct, balance_terms = p_balance_terms,
         balance_net_days = coalesce(v_days, balance_net_days)
   where id = so.id;
  perform public.order_correction_finish(so.id, 'terms', jsonb_build_object(
    'vat_pct', jsonb_build_array(so.vat_pct, p_vat_pct),
    'balance_terms', jsonb_build_array(so.balance_terms, p_balance_terms),
    'balance_net_days', jsonb_build_array(so.balance_net_days, coalesce(v_days, so.balance_net_days))), p_reason);
end
$$;

-- Client and currency
create or replace function public.correct_order_client(p_order uuid, p_client uuid, p_currency text, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  so    public.sales_orders;
  v_cur text := upper(btrim(coalesce(p_currency, '')));
begin
  so := public.order_correction_start(p_order, p_reason);
  if not exists (select 1 from public.clients where id = p_client) then
    raise exception 'Unknown client';
  end if;
  if v_cur !~ '^[A-Z]{3}$' then
    raise exception 'Currency is a three-letter code, e.g. EUR';
  end if;
  if p_client = so.client_id and v_cur = so.currency::text then
    raise exception 'Nothing to correct';
  end if;
  if exists (select 1 from public.invoices where order_id = so.id and status = 'issued') then
    raise exception 'An invoice of this order is issued: client and currency no longer change';
  end if;
  if exists (select 1 from public.sales_order_lines where order_id = so.id and (project_id is not null or formula_version_id is not null))
     or exists (select 1 from public.manufacturing_orders mo join public.sales_order_lines l on l.id = mo.sales_order_line_id
                 where l.order_id = so.id and mo.status <> 'cancelled') then
    raise exception 'Products of this order are already tied to recipes or production: the client no longer changes';
  end if;

  update public.sales_orders set client_id = p_client, currency = v_cur where id = so.id;
  if p_client <> so.client_id then
    -- the offers of the order and the recipes made from them go with it
    update public.calc_offers set client_id = p_client
     where id in (select calc_offer_id from public.sales_order_lines where order_id = so.id and calc_offer_id is not null);
    update public.formulas set client_id = p_client
     where calc_offer_id in (select calc_offer_id from public.sales_order_lines where order_id = so.id and calc_offer_id is not null)
       and client_id is distinct from p_client;
  end if;
  perform public.order_correction_finish(so.id, 'client', jsonb_build_object(
    'client', jsonb_build_array((select legal_name from public.clients where id = so.client_id),
                                (select legal_name from public.clients where id = p_client)),
    'currency', jsonb_build_array(so.currency, v_cur)), p_reason);
end
$$;

revoke execute on function
  public.order_correction_start(uuid, text),
  public.order_correction_cancel_mos(uuid),
  public.order_correction_finish(uuid, text, jsonb, text)
from public, anon, authenticated;

revoke execute on function
  public.correct_order_line(uuid, integer, numeric, text),
  public.correct_order_remove_line(uuid, text),
  public.correct_order_add_offer(uuid, uuid, text),
  public.correct_order_add_service(uuid, text, integer, numeric, text),
  public.correct_order_terms(uuid, numeric, public.balance_terms, integer, text),
  public.correct_order_client(uuid, uuid, text, text)
from public, anon;
grant execute on function
  public.correct_order_line(uuid, integer, numeric, text),
  public.correct_order_remove_line(uuid, text),
  public.correct_order_add_offer(uuid, uuid, text),
  public.correct_order_add_service(uuid, text, integer, numeric, text),
  public.correct_order_terms(uuid, numeric, public.balance_terms, integer, text),
  public.correct_order_client(uuid, uuid, text, text)
to authenticated;
