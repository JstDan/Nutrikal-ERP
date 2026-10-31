-- =====================================================================
-- More control over invoices (owner, Oct 2026):
--  - a proforma from a draft without an order, on its own series, so no
--    number of the legal series is used until the invoice is issued
--  - the legal basis of 0 % VAT, printed on the invoice
--  - payments on invoices of orders too
--  - a new draft from an earlier invoice, by hand
-- =====================================================================

alter table public.invoices
  add column proforma_no text unique,
  add column proforma_date date,
  add column vat_basis text;

/** The proforma number of a draft: given once. */
create or replace function public.proforma_from_draft(p_invoice uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  inv public.invoices;
begin
  perform public.require_role('admin', 'sales');
  select * into inv from public.invoices where id = p_invoice for update;
  if inv.id is null or inv.status <> 'draft' or inv.kind <> 'invoice' or inv.order_id is not null then
    raise exception 'A proforma is made from a draft invoice without an order';
  end if;
  if not exists (select 1 from public.invoice_lines where invoice_id = p_invoice) then
    raise exception 'An invoice without lines cannot be issued';
  end if;
  if inv.proforma_no is not null then
    return inv.proforma_no;
  end if;
  update public.invoices set proforma_no = public.next_number('proforma'), proforma_date = current_date
   where id = p_invoice returning proforma_no into inv.proforma_no;
  return inv.proforma_no;
end
$$;

drop function public.set_client_invoice_terms(uuid, numeric, date, date, text, text);
create function public.set_client_invoice_terms(p_invoice uuid, p_vat_pct numeric, p_tax_date date, p_due date, p_method text, p_notes text, p_vat_basis text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  update public.invoices
     set vat_pct = coalesce(p_vat_pct, vat_pct), tax_point_date = p_tax_date, due_date = p_due,
         payment_method = coalesce(p_method, payment_method), notes = nullif(btrim(coalesce(p_notes, '')), ''),
         vat_basis = nullif(btrim(coalesce(p_vat_basis, '')), '')
   where id = p_invoice and status = 'draft' and order_id is null and kind = 'invoice';
  if not found then
    raise exception 'Only a draft invoice without an order is changed here';
  end if;
end
$$;

-- An invoice without an order at 0 % VAT says why
create or replace function public.invoices_vat_basis()
returns trigger language plpgsql set search_path = public
as $$
begin
  if old.status = 'draft' and new.status = 'issued' and new.kind = 'invoice' and new.order_id is null
     and new.vat_pct = 0 and new.vat_basis is null then
    raise exception 'Choose the basis for 0 %% VAT';
  end if;
  return new;
end
$$;
create trigger invoices_vat_basis before update on public.invoices
  for each row execute function public.invoices_vat_basis();

/** True when the order already records the payment of this invoice. */
create or replace function public.invoice_paid_by_order(p_invoice uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case i.purpose when 'advance' then so.deposit_received_on is not null
                        when 'final' then so.balance_received_on is not null
                        else coalesce(so.balance_received_on, so.deposit_received_on) is not null end
    from public.invoices i join public.sales_orders so on so.id = i.order_id
   where i.id = p_invoice
$$;
revoke execute on function public.invoice_paid_by_order(uuid) from public, anon;
grant execute on function public.invoice_paid_by_order(uuid) to authenticated;

create or replace function public.invoice_open_amount(p_invoice uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select case when coalesce(public.invoice_paid_by_order(i.id), false) then 0 else
         i.total
         - coalesce((select sum(n.total) from public.invoices n where n.corrects_invoice_id = i.id and n.kind = 'credit_note' and n.status = 'issued'), 0)
         + coalesce((select sum(n.total) from public.invoices n where n.corrects_invoice_id = i.id and n.kind = 'debit_note' and n.status = 'issued'), 0)
         - coalesce((select sum(p.amount) from public.invoice_payments p where p.invoice_id = i.id), 0) end
    from public.invoices i where i.id = p_invoice and public.has_role('admin', 'sales')
$$;

create or replace function public.add_invoice_payment(p_invoice uuid, p_paid_on date, p_amount numeric, p_method text, p_note text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  inv public.invoices;
begin
  perform public.require_role('admin');
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or inv.status <> 'issued' or inv.kind <> 'invoice' then
    raise exception 'Payments are recorded on an issued invoice';
  end if;
  if p_paid_on is null or coalesce(p_amount, 0) <= 0 then
    raise exception 'Enter the date and the amount';
  end if;
  if p_amount > public.invoice_open_amount(p_invoice) then
    raise exception 'The payment is more than what is left to pay';
  end if;
  insert into public.invoice_payments (invoice_id, paid_on, amount, method, note)
  values (p_invoice, p_paid_on, p_amount, coalesce(p_method, 'bank'), nullif(btrim(coalesce(p_note, '')), ''));
end
$$;

/** A new draft with the lines and terms of an earlier invoice without an order. Only by hand: nothing repeats by itself. */
create or replace function public.copy_client_invoice(p_invoice uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  inv  public.invoices;
  v_id uuid;
begin
  perform public.require_role('admin', 'sales');
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or inv.kind <> 'invoice' or inv.order_id is not null then
    raise exception 'Only an invoice without an order is copied';
  end if;
  v_id := public.create_client_invoice(inv.client_id, inv.vat_pct, null, inv.payment_method, inv.buyer ->> 'customer_ref', inv.notes);
  update public.invoices set vat_basis = inv.vat_basis where id = v_id;
  insert into public.invoice_lines (invoice_id, sort_order, kind, description, quantity, unit_price, amount)
  select v_id, sort_order, 'service', description, quantity, unit_price, amount
    from public.invoice_lines where invoice_id = p_invoice;
  return v_id;
end
$$;

create or replace function public.begin_document_send(p_kind text, p_ref uuid, p_to text, p_cc text, p_subject text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_ok boolean;
  v_id uuid;
begin
  perform public.require_role('admin', 'sales');
  if coalesce(p_to, '') !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
     or (nullif(btrim(coalesce(p_cc, '')), '') is not null and p_cc !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$') then
    raise exception 'Enter a valid e-mail address';
  end if;
  if nullif(btrim(coalesce(p_subject, '')), '') is null then
    raise exception 'Enter the subject';
  end if;
  v_ok := case p_kind
    when 'calc_offer' then exists (select 1 from public.calc_offers where id = p_ref)
    when 'proforma' then exists (select 1 from public.sales_orders where id = p_ref)
      or exists (select 1 from public.invoices where id = p_ref and proforma_no is not null)
    when 'invoice' then exists (select 1 from public.invoices where id = p_ref and status = 'issued')
    when 'delivery_note' then exists (select 1 from public.dispatches where id = p_ref)
    else false end;
  if not v_ok then
    raise exception 'This document cannot be sent';
  end if;
  insert into public.document_sends (kind, ref_id, recipient, cc, subject)
  values (p_kind, p_ref, btrim(p_to), nullif(btrim(coalesce(p_cc, '')), ''), btrim(p_subject))
  returning id into v_id;
  return v_id;
end
$$;

revoke execute on function public.proforma_from_draft(uuid) from public, anon;
revoke execute on function public.set_client_invoice_terms(uuid, numeric, date, date, text, text, text) from public, anon;
revoke execute on function public.copy_client_invoice(uuid) from public, anon;
grant execute on function public.proforma_from_draft(uuid) to authenticated;
grant execute on function public.set_client_invoice_terms(uuid, numeric, date, date, text, text, text) to authenticated;
grant execute on function public.copy_client_invoice(uuid) to authenticated;
