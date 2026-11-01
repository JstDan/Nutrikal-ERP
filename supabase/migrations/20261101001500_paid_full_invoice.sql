-- A full invoice is paid by the one payment of the order. With an advance and a balance only the balance
-- settles it, also if the terms of the order changed after the invoice was issued.
create or replace function public.invoice_paid_by_order(p_invoice uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case i.purpose when 'advance' then so.deposit_received_on is not null
                        when 'final' then so.balance_received_on is not null
                        else so.balance_received_on is not null
                             or (so.deposit_received_on is not null and not public.order_paid_in_two(so.id)) end
    from public.invoices i join public.sales_orders so on so.id = i.order_id
   where i.id = p_invoice
$$;
