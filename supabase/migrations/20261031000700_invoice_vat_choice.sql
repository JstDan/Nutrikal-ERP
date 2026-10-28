-- With or without VAT on each draft invoice (owner, 28 Oct 2026): a tick on the draft before it is
-- issued. With VAT = the order's rate, or the company's default rate when the order has none.
-- The advance invoice of an amount received (VAT included) recomputes its base for the new rate.

/** The VAT rate an order's documents take when "with VAT" is ticked. */
create or replace function public.order_vat_rate(p_order uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(nullif((select vat_pct from public.sales_orders where id = p_order), 0),
                  (select default_vat_rate from public.company_settings limit 1), 20)
$$;
revoke execute on function public.order_vat_rate(uuid) from public, anon;
grant execute on function public.order_vat_rate(uuid) to authenticated;

create or replace function public.set_invoice_vat(p_invoice uuid, p_with_vat boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  inv    public.invoices;
  so     public.sales_orders;
  v_rate numeric;
begin
  perform public.require_role('admin', 'sales');
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if inv.status <> 'draft' then
    raise exception 'An issued invoice cannot be changed; issue a credit or debit note';
  end if;
  select * into so from public.sales_orders where id = inv.order_id;
  v_rate := case when p_with_vat then public.order_vat_rate(inv.order_id) else 0 end;
  update public.invoices set vat_pct = v_rate where id = p_invoice;
  if inv.purpose = 'advance' and so.deposit_amount is not null then
    update public.invoice_lines
       set unit_price = round(so.deposit_amount / (1 + v_rate / 100), 2), amount = round(so.deposit_amount / (1 + v_rate / 100), 2)
     where invoice_id = p_invoice and kind = 'advance';
  end if;
end
$$;
revoke execute on function public.set_invoice_vat(uuid, boolean) from public, anon;
grant execute on function public.set_invoice_vat(uuid, boolean) to authenticated;
