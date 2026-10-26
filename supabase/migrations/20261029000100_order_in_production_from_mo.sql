-- =====================================================================
-- Nutrikal ERP + CRM — an order is "in production" when Production has it
-- Before: "Start production" on a sales order only changed its status; no
-- manufacturing order existed, so Production saw nothing (owner, Oct 2026).
-- Now:
--   * release_mo (admin sends a manufacturing order to Production) moves
--     its confirmed sales order to in_production;
--   * a sales order goes to in_production only when one of its
--     manufacturing orders has been sent to Production;
--   * an order put in production by hand with nothing sent goes back to
--     confirmed (the only way back from in_production).
-- =====================================================================

/** True when a manufacturing order of one of the order's lines is at Production (sent, started or done). */
create or replace function public.order_sent_to_production(p_order uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.manufacturing_orders mo
      join public.sales_order_lines l on l.id = mo.sales_order_line_id
     where l.order_id = p_order and mo.status in ('released', 'in_production', 'completed'))
$$;
revoke execute on function public.order_sent_to_production(uuid) from public, anon;

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
      (old.status = 'in_production' and new.status in ('ready', 'cancelled', 'confirmed')) or
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
        raise exception 'Only admin confirms the payment' using errcode = '42501';
      end if;
      -- The proforma is for the full amount: paid in full
      new.deposit_received_on := coalesce(new.deposit_received_on, current_date);
      new.balance_received_on := coalesce(new.balance_received_on, current_date);
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
    elsif new.status = 'draft' then
      new.confirmed_at := null;
    elsif new.status = 'dispatched' then
      new.dispatched_at := now();
    end if;
  end if;
  return new;
end
$$;

-- Scheduled -> Waiting at Production (Admin); its sales order is now in production
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
  update public.sales_orders so set status = 'in_production'
    from public.sales_order_lines l
   where l.id = mo.sales_order_line_id and so.id = l.order_id and so.status = 'confirmed';
  perform public.notify_role('production', 'mo_sent',
    jsonb_build_object('code', mo.code, 'quantity', mo.quantity, 'planned_date', mo.planned_date),
    '/factory/orders/' || p_mo);
end
$$;

-- Orders put in production by hand with nothing sent to Production go back to confirmed
update public.sales_orders set status = 'confirmed'
 where status = 'in_production' and not public.order_sent_to_production(id);
