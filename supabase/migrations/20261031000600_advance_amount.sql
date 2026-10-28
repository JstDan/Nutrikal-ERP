-- The advance is confirmed as the amount received from the bank (VAT included, currency of the
-- order), not a percent (owner, 28 Oct 2026). sales_orders.deposit_amount keeps it; deposit_pct
-- follows from it (net advance / net order total) for the two-payment logic and the task titles.
-- The advance invoice takes its base from the amount: amount / (1 + VAT %).

alter table public.sales_orders add column deposit_amount numeric(14, 2) check (deposit_amount > 0);
comment on column public.sales_orders.deposit_amount is 'Advance received (gross, VAT included); null = only the deposit %';

-- A deposit % typed by hand afterwards drops the amount (the % then wins again)
create or replace function public.sales_orders_deposit_amount_guard()
returns trigger
language plpgsql
as $$
begin
  if new.deposit_pct is distinct from old.deposit_pct and new.deposit_amount is not distinct from old.deposit_amount then
    new.deposit_amount := null;
  end if;
  return new;
end
$$;
create trigger sales_orders_deposit_amount_guard before update on public.sales_orders
  for each row execute function public.sales_orders_deposit_amount_guard();

/** Net and gross total of an order (lines rounded as on the invoice). */
create or replace function public.order_totals(p_order uuid, out net numeric, out gross numeric)
language sql stable security definer set search_path = public
as $$
  select n, round(n * (1 + coalesce(so.vat_pct, 0) / 100), 2)
    from public.sales_orders so,
         lateral (select coalesce(sum(round(l.quantity * l.unit_price, 2)), 0) as n
                    from public.sales_order_lines l where l.order_id = so.id) t
   where so.id = p_order
$$;
revoke execute on function public.order_totals(uuid) from public, anon;
grant execute on function public.order_totals(uuid) to authenticated;

drop function public.confirm_order_payment(uuid, text, numeric, uuid);

/**
 * Admin confirms the first payment: p_received 'advance' (p_amount = the amount received, VAT
 * included) or 'full'. An unpaid order becomes confirmed; an order paid before the task manager
 * keeps its status. The board is made from p_template (default template when null). Returns the
 * board; when the order already has one, nothing changes and that board is returned.
 */
create function public.confirm_order_payment(
  p_order uuid, p_received text, p_amount numeric default null, p_template uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  so      public.sales_orders;
  v_board uuid;
  v_mode  text;
  v_pct   numeric;
  v_tot   record;
begin
  perform public.require_role('admin');
  select * into so from public.sales_orders where id = p_order for update;
  if not found then
    raise exception 'Order not found';
  end if;
  select id into v_board from public.order_task_boards where sales_order_id = p_order;
  if v_board is not null then
    return v_board;
  end if;
  if p_received not in ('advance', 'full') then
    raise exception 'Choose what was received: an advance or 100%%';
  end if;
  v_mode := case when p_received = 'full' then 'full' else 'split' end;
  if v_mode = 'full' then
    v_pct := 100;
    p_amount := null;
  else
    select * into v_tot from public.order_totals(p_order);
    if p_amount is null or p_amount <= 0 then
      raise exception 'Enter the advance received';
    end if;
    p_amount := round(p_amount, 2);
    if p_amount >= v_tot.gross then
      raise exception 'The advance (%) must be less than the order total with VAT (%)', p_amount, v_tot.gross;
    end if;
    v_pct := least(greatest(round(p_amount / v_tot.gross * 100, 2), 0.01), 99.99);
  end if;

  if so.status = 'unpaid' then
    update public.sales_orders
       set status = 'confirmed', deposit_pct = v_pct, deposit_amount = p_amount, deposit_received_on = current_date,
           balance_received_on = case when v_mode = 'full' then current_date end
     where id = p_order;
  elsif so.status in ('confirmed', 'in_production', 'ready') then
    update public.sales_orders
       set deposit_pct = v_pct, deposit_amount = p_amount, deposit_received_on = coalesce(deposit_received_on, current_date),
           balance_received_on = case when v_mode = 'full' then coalesce(balance_received_on, current_date) else balance_received_on end
     where id = p_order;
  else
    raise exception 'The payment of a % order is not confirmed here', so.status;
  end if;
  return public.create_order_task_board(p_order, p_template, v_mode, v_pct);
end
$$;
revoke execute on function public.confirm_order_payment(uuid, text, numeric, uuid) from public, anon;
grant execute on function public.confirm_order_payment(uuid, text, numeric, uuid) to authenticated;

/**
 * An invoice of a paid order: the existing one of that purpose, or a new draft.
 * p_purpose: 'full' (paid at once), 'advance' or 'final'; null = the one due now.
 */
create or replace function public.create_order_invoice(p_order uuid, p_purpose text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  so      public.sales_orders;
  v_two   boolean;
  v_id    uuid;
  v_loc   text;
  v_base  numeric;
  adv     public.invoices;
  p       record;
begin
  perform public.require_role('admin', 'sales');
  select * into so from public.sales_orders where id = p_order;
  if not found then
    raise exception 'Order not found';
  end if;
  v_two := public.order_paid_in_two(p_order);
  select * into adv from public.invoices where order_id = p_order and kind = 'invoice' and purpose = 'advance';
  if p_purpose is null then
    p_purpose := case when not v_two then 'full'
                      when so.balance_received_on is not null and adv.status = 'issued' then 'final'
                      else 'advance' end;
  end if;
  if p_purpose not in ('full', 'advance', 'final') then
    raise exception 'Unknown kind of invoice';
  end if;
  select id into v_id from public.invoices where order_id = p_order and kind = 'invoice' and purpose = p_purpose;
  if v_id is not null then
    return v_id;
  end if;
  if so.status in ('draft', 'unpaid', 'cancelled') then
    raise exception 'The invoice is issued once the payment is confirmed';
  end if;
  if (p_purpose = 'full') = v_two then
    raise exception 'This order is paid with an advance and a final payment';
  end if;
  if p_purpose = 'advance' and so.deposit_received_on is null then
    raise exception 'The advance invoice is issued once the advance is received';
  end if;
  if p_purpose = 'final' then
    if so.balance_received_on is null then
      raise exception 'The final invoice is issued once the final payment is confirmed';
    end if;
    if adv.status is distinct from 'issued' then
      raise exception 'Issue the advance invoice first';
    end if;
  end if;

  select * into p from public.invoice_parties(p_order);
  select case when c.preferred_locale = 'bg' then 'bg' else 'en' end into v_loc from public.clients c where c.id = so.client_id;
  insert into public.invoices (kind, purpose, order_id, client_id, tax_point_date, currency, vat_pct, locale, seller, buyer, notes)
  values ('invoice', p_purpose, so.id, so.client_id,
          case p_purpose when 'advance' then so.deposit_received_on when 'final' then so.balance_received_on
                         else coalesce(so.balance_received_on, so.deposit_received_on, current_date) end,
          so.currency, coalesce(so.vat_pct, 0), v_loc, p.seller, p.buyer, so.notes)
  returning id into v_id;

  if p_purpose = 'advance' then
    if so.deposit_amount is not null then
      -- The amount received includes VAT: the base is amount / (1 + VAT %)
      v_base := round(so.deposit_amount / (1 + coalesce(so.vat_pct, 0) / 100), 2);
      insert into public.invoice_lines (invoice_id, sort_order, kind, description, quantity, unit_price, amount)
      values (v_id, 0, 'advance',
              case when v_loc = 'bg' then 'Авансово плащане по поръчка ' || so.code
                   else 'Advance payment for order ' || so.code end,
              1, v_base, v_base);
      return v_id;
    end if;
    select coalesce(sum(round(l.quantity * l.unit_price, 2)), 0) into v_base from public.sales_order_lines l where l.order_id = p_order;
    insert into public.invoice_lines (invoice_id, sort_order, kind, description, quantity, unit_price, amount)
    values (v_id, 0, 'advance',
            case when v_loc = 'bg' then 'Авансово плащане ' || trim_scale(so.deposit_pct) || '% по поръчка ' || so.code
                 else 'Advance payment ' || trim_scale(so.deposit_pct) || '% for order ' || so.code end,
            1, round(v_base * so.deposit_pct / 100, 2), round(v_base * so.deposit_pct / 100, 2));
    return v_id;
  end if;

  insert into public.invoice_lines (invoice_id, sort_order, kind, description, offer_no, capsules, quantity, unit_price, amount)
  select v_id, l.sort_order, l.kind, coalesce(l.description, f.name, ''), coalesce(co.offer_no, of.code),
         case
           when co.data ->> 'mode' = 'catalog' then
             case when co.data ->> 'catalogCapsules' ~ '^[0-9]+$' then (co.data ->> 'catalogCapsules')::int
                  else nullif(co.data -> 'catalog' ->> 'capsules_per_container', '')::int end
           when co.data ->> 'productType' like 'capsules%' and co.data ->> 'quantityPerUnit' ~ '^[0-9]+$'
             then (co.data ->> 'quantityPerUnit')::int
         end,
         l.quantity, l.unit_price, round(l.quantity * l.unit_price, 2)
    from public.sales_order_lines l
    left join public.calc_offers co on co.id = l.calc_offer_id
    left join public.offers of on of.id = l.offer_id
    left join public.formula_versions v on v.id = l.formula_version_id
    left join public.formulas f on f.id = v.formula_id
   where l.order_id = p_order;

  -- The final invoice deducts the advance invoiced
  if p_purpose = 'final' then
    insert into public.invoice_lines (invoice_id, sort_order, kind, description, quantity, unit_price, amount)
    values (v_id, 100000, 'advance',
            case when v_loc = 'bg' then 'Приспадане на аванс по фактура № ' || adv.number || ' от ' || to_char(adv.issue_date, 'DD.MM.YYYY')
                 else 'Less advance invoiced, invoice No ' || adv.number || ' of ' || to_char(adv.issue_date, 'DD.MM.YYYY') end,
            1, -adv.subtotal, -adv.subtotal);
  end if;
  return v_id;
end
$$;

-- The first task of the board shows the amount received instead of the derived %
create or replace function public.confirm_order_payment_title()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  so public.sales_orders;
begin
  if new.auto_rule = 'payment_first' then
    select s.* into so from public.order_task_boards b join public.sales_orders s on s.id = b.sales_order_id where b.id = new.board_id;
    if so.deposit_amount is not null then
      new.title := 'Аванс ' || replace(to_char(so.deposit_amount, 'FM9999999990.00'), '.', ',') || ' ' || case so.currency when 'EUR' then '€' else so.currency end;
      new.title_en := 'Advance ' || to_char(so.deposit_amount, 'FM9999999990.00') || ' ' || case so.currency when 'EUR' then '€' else so.currency end;
    end if;
  end if;
  return new;
end
$$;
create trigger order_tasks_advance_title before insert on public.order_tasks
  for each row execute function public.confirm_order_payment_title();

-- ---------------------------------------------------------------------
-- "Проформа за финално плащане" between "Фактура за аванс" and "Финално плащане" (owner, 28 Oct 2026):
-- a manual task of orders paid with an advance, in every template and on the open boards
-- ---------------------------------------------------------------------
do $$
declare
  c record;
  v_pos integer;
begin
  for c in
    select tc.id, tc.template_id from public.order_task_template_columns tc
     where tc.system_key = 'payments'
       and not exists (select 1 from public.order_task_template_items i where i.template_id = tc.template_id and i.key = 'proforma_final')
  loop
    select position into v_pos from public.order_task_template_items where column_id = c.id and key = 'payment_final';
    v_pos := coalesce(v_pos, (select coalesce(max(position), 0) + 1 from public.order_task_template_items where column_id = c.id));
    update public.order_task_template_items set position = position + 1 where column_id = c.id and position >= v_pos;
    insert into public.order_task_template_items (template_id, column_id, key, title_bg, title_en, condition, position)
    values (c.template_id, c.id, 'proforma_final', 'Проформа за финално плащане', 'Final payment proforma', 'payment:split', v_pos);
  end loop;

  for c in
    select oc.id, oc.board_id from public.order_task_columns oc
      join public.order_task_boards b on b.id = oc.board_id
     where oc.system_key = 'payments' and b.payment_mode = 'split'
       and not exists (select 1 from public.order_tasks t where t.board_id = oc.board_id and t.template_key = 'proforma_final')
       and exists (select 1 from public.order_tasks t where t.board_id = oc.board_id and t.auto_rule = 'payment_final' and t.status <> 'done')
  loop
    select position into v_pos from public.order_tasks where board_id = c.board_id and auto_rule = 'payment_final';
    update public.order_tasks set position = position + 1 where column_id = c.id and position >= v_pos;
    insert into public.order_tasks (board_id, column_id, template_key, title, title_en, kind, position)
    values (c.board_id, c.id, 'proforma_final', 'Проформа за финално плащане', 'Final payment proforma', 'manual', v_pos);
  end loop;
end
$$;
