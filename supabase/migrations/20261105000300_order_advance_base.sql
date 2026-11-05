-- The final proforma deducts the advance as a line, at its tax base (owner, Nov 2026): the base
-- comes from the advance invoice of the order (its subtotal; a draft: the sum of its lines),
-- never from the amount received divided by the VAT. Null when there is no advance invoice yet.
-- The team that reads invoices, or the client of the order in the customer panel; nobody else
-- (Production, other clients) gets anything.
create or replace function public.order_advance_base(p_order uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(i.subtotal, (select sum(l.amount) from public.invoice_lines l where l.invoice_id = i.id))
    from public.invoices i
   where i.order_id = p_order and i.kind = 'invoice' and i.purpose = 'advance'
     and (public.has_role('admin', 'sales', 'bookkeeper', 'accountant') or public.portal_own_order(p_order))
$$;

revoke execute on function public.order_advance_base(uuid) from public, anon;
grant execute on function public.order_advance_base(uuid) to authenticated;
