-- =====================================================================
-- Nutrikal ERP + CRM — admin cancels a payment confirmed by mistake
-- A paid order (confirmed, not yet sent to production, no issued
-- invoice) goes back to unpaid, the proforma stage. The payment dates
-- and the advance are cleared, draft invoices of the order are deleted
-- and so is its task board (it is made again, from the chosen template,
-- when the payment is confirmed again). The reason is a note on the
-- client. Only through cancel_order_payment(): the status change
-- confirmed -> unpaid is refused anywhere else.
-- =====================================================================

-- Same as 20261030000200, plus confirmed -> unpaid inside cancel_order_payment()
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
      (old.status = 'dispatched'    and new.status = 'closed') or
      (old.status = 'confirmed'     and new.status = 'unpaid' and current_setting('nk.cancel_payment', true) = 'on')
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

/**
 * Admin: cancels the payment of a confirmed order (confirmed by mistake). Returns the storage
 * paths of the task files that were deleted with the board, for the app to remove from Storage.
 */
create or replace function public.cancel_order_payment(p_order uuid, p_reason text)
returns text[]
language plpgsql security definer set search_path = public
as $$
declare
  so      public.sales_orders;
  v_files text[];
begin
  perform public.require_role('admin');
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Enter the reason for cancelling the payment';
  end if;
  select * into so from public.sales_orders where id = p_order for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if so.status <> 'confirmed' or so.deposit_received_on is null then
    raise exception 'Only the payment of a paid order that is not in production yet can be cancelled';
  end if;
  if public.order_sent_to_production(p_order) then
    raise exception 'Production has this order; its payment cannot be cancelled';
  end if;
  if exists (select 1 from public.invoices where order_id = p_order and status = 'issued') then
    raise exception 'The order has an issued invoice; correct it with a credit note instead';
  end if;

  delete from public.invoices where order_id = p_order and status = 'draft';

  select coalesce(array_agg(f.storage_path), '{}') into v_files
    from public.order_task_files f
    join public.order_tasks t on t.id = f.task_id
    join public.order_task_boards b on b.id = t.board_id
   where b.sales_order_id = p_order;
  delete from public.order_task_boards where sales_order_id = p_order;

  perform set_config('nk.cancel_payment', 'on', true);
  update public.sales_orders
     set status = 'unpaid', deposit_received_on = null, balance_received_on = null, deposit_amount = null
   where id = p_order;
  perform set_config('nk.cancel_payment', 'off', true);

  insert into public.activities (client_id, type, subject, body)
  values (so.client_id, 'note', 'Отменено плащане по поръчка ' || so.code, btrim(p_reason));
  return v_files;
end
$$;

revoke execute on function public.cancel_order_payment(uuid, text) from public, anon;
grant execute on function public.cancel_order_payment(uuid, text) to authenticated;
