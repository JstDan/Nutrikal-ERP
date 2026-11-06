-- Any VAT rate on a draft invoice of an order, and the reason when no VAT is charged (owner, Nov 2026).
-- Before this the draft only had "with VAT" (the order's rate) or "without VAT".
-- The reason is the text printed on the invoice; it is kept only at 0 %.

create or replace function public.set_invoice_vat_rate(p_invoice uuid, p_rate numeric, p_basis text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  inv    public.invoices;
  so     public.sales_orders;
  v_rate numeric := coalesce(p_rate, 0);
begin
  perform public.require_role('admin', 'sales');
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if inv.status <> 'draft' then
    raise exception 'An issued invoice cannot be changed; issue a credit or debit note';
  end if;
  if v_rate < 0 or v_rate > 100 then
    raise exception 'The VAT rate must be between 0 and 100 %%';
  end if;
  if v_rate = 0 and nullif(btrim(coalesce(p_basis, '')), '') is null then
    raise exception 'Choose the basis for 0 %% VAT';
  end if;
  update public.invoices
     set vat_pct = v_rate,
         vat_basis = case when v_rate = 0 then btrim(p_basis) end
   where id = p_invoice;
  -- The advance invoice of an amount received (VAT included) recomputes its base for the new rate
  select * into so from public.sales_orders where id = inv.order_id;
  if inv.purpose = 'advance' and so.deposit_amount is not null then
    update public.invoice_lines
       set unit_price = round(so.deposit_amount / (1 + v_rate / 100), 2), amount = round(so.deposit_amount / (1 + v_rate / 100), 2)
     where invoice_id = p_invoice and kind = 'advance';
  end if;
end
$$;
revoke execute on function public.set_invoice_vat_rate(uuid, numeric, text) from public, anon;
grant execute on function public.set_invoice_vat_rate(uuid, numeric, text) to authenticated;
