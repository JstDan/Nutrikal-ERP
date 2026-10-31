-- =====================================================================
-- Invoices without an order (owner, Oct 2026): services and anything else
-- billed directly to a client, with free lines, a due date, a way of payment
-- and recorded payments. Numbers stay in the one series. An issued invoice
-- stays locked: payments are kept apart and do not change it.
-- =====================================================================

alter table public.invoices
  alter column order_id drop not null,
  add column due_date date,
  add column payment_method text not null default 'bank' check (payment_method in ('bank', 'cash', 'card'));

create table public.invoice_payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  paid_on     date not null,
  amount      numeric(14, 2) not null check (amount > 0),
  method      text not null default 'bank' check (method in ('bank', 'cash', 'card')),
  note        text,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index invoice_payments_invoice_idx on public.invoice_payments (invoice_id, paid_on);
select public.enable_audit('public.invoice_payments');

-- Admin and Sales read. Production never sees it. Written only by the functions below.
alter table public.invoice_payments enable row level security;
create policy invoice_payments_select on public.invoice_payments for select to authenticated
  using (public.has_role('admin', 'sales'));
revoke insert, update, delete, truncate, references, trigger on public.invoice_payments from anon, authenticated;

create or replace function public.client_invoice_parties(p_client uuid, p_ref text, out seller jsonb, out buyer jsonb)
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('name', s.company_name, 'company_id', s.company_id, 'vat', s.company_vat,
           'address', s.company_address, 'email', s.company_email, 'phone', s.company_phone,
           'bank_name', s.bank_name, 'iban', s.bank_iban, 'bic', s.bank_bic),
         jsonb_build_object('name', c.legal_name, 'company_id', c.company_id, 'vat', c.vat_number,
           'address', coalesce(nullif(c.registration_address, ''), c.address_line1), 'city', c.city,
           'postal_code', c.postal_code, 'country', c.country_code, 'customer_ref', nullif(btrim(coalesce(p_ref, '')), ''),
           'registration', nullif(c.registration_address, '') is not null)
    from public.clients c
    left join lateral (select * from public.calc_settings limit 1) s on true
   where c.id = p_client
$$;
revoke execute on function public.client_invoice_parties(uuid, text) from public, anon, authenticated;

create or replace function public.create_client_invoice(p_client uuid, p_vat_pct numeric, p_due date, p_method text, p_ref text, p_notes text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id  uuid;
  v_loc text;
  v_bg  boolean;
  p     record;
begin
  perform public.require_role('admin', 'sales');
  select case when preferred_locale = 'bg' then 'bg' else 'en' end, country_code = 'BG' into v_loc, v_bg from public.clients where id = p_client;
  if v_loc is null then
    raise exception 'Choose the client';
  end if;
  select * into p from public.client_invoice_parties(p_client, p_ref);
  insert into public.invoices (kind, purpose, client_id, currency, vat_pct, locale, seller, buyer, notes, due_date, payment_method)
  values ('invoice', 'full', p_client, 'EUR',
          -- Empty: the rule of new orders, Bulgarian clients pay VAT, others 0 %; the person sets it when it differs
          coalesce(p_vat_pct, case when v_bg then coalesce((select default_vat_rate from public.company_settings limit 1), 20) else 0 end),
          v_loc, p.seller, p.buyer,
          nullif(btrim(coalesce(p_notes, '')), ''), p_due, coalesce(p_method, 'bank'))
  returning id into v_id;
  return v_id;
end
$$;

/** The terms of a draft invoice without an order. */
create or replace function public.set_client_invoice_terms(p_invoice uuid, p_vat_pct numeric, p_tax_date date, p_due date, p_method text, p_notes text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  update public.invoices
     set vat_pct = coalesce(p_vat_pct, vat_pct), tax_point_date = p_tax_date, due_date = p_due,
         payment_method = coalesce(p_method, payment_method), notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_invoice and status = 'draft' and order_id is null and kind = 'invoice';
  if not found then
    raise exception 'Only a draft invoice without an order is changed here';
  end if;
end
$$;

create or replace function public.issue_invoice(p_invoice uuid, p_number text, p_issue_date date, p_confirm_number boolean default false)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  inv      public.invoices;
  v_next   text := public.next_invoice_number();
  v_sub    numeric(14, 2);
  v_vat    numeric(14, 2);
  p        record;
begin
  perform public.require_role('admin', 'sales');
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if inv.status <> 'draft' then
    raise exception 'The invoice is already issued';
  end if;
  p_number := btrim(coalesce(p_number, ''));
  if p_number !~ '^[0-9]{10}$' then
    raise exception 'The invoice number must have 10 digits';
  end if;
  if exists (select 1 from public.invoices where number = p_number) then
    raise exception 'Invoice number % is already used', p_number;
  end if;
  if p_number <> v_next then
    if not public.has_role('admin') then
      raise exception 'Only admin can issue with a number other than the next one (%)', v_next using errcode = '42501';
    end if;
    if not p_confirm_number then
      raise exception 'Number % is not the next one of the series (%): confirm it to issue', p_number, v_next;
    end if;
  end if;
  if p_issue_date is null then
    raise exception 'The issue date is required';
  end if;
  if not exists (select 1 from public.invoice_lines where invoice_id = p_invoice) then
    raise exception 'An invoice without lines cannot be issued';
  end if;

  select coalesce(sum(amount), 0) into v_sub from public.invoice_lines where invoice_id = p_invoice;
  v_vat := round(v_sub * inv.vat_pct / 100, 2);
  if inv.order_id is not null then
    select * into p from public.invoice_parties(inv.order_id);
  else
    select * into p from public.client_invoice_parties(inv.client_id, inv.buyer ->> 'customer_ref');
  end if;

  update public.invoices
     set status = 'issued', number = p_number, issue_date = p_issue_date, seller = p.seller, buyer = p.buyer,
         tax_point_date = coalesce(tax_point_date, p_issue_date),
         subtotal = v_sub, vat_amount = v_vat, total = v_sub + v_vat, issued_by = auth.uid(), issued_at = now()
   where id = p_invoice;
  -- The series continues after the highest number issued
  update public.number_series set next_number = greatest(next_number, p_number::bigint + 1) where key = 'invoice';
  return p_number;
end
$$;

-- Lines: credit and debit notes, and invoices without an order. Lines of an order come from the order.
create or replace function public.invoice_lines_editable(p_invoice uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.invoices where id = p_invoice and (kind <> 'invoice' or order_id is null)) $$;
revoke execute on function public.invoice_lines_editable(uuid) from public, anon, authenticated;

create or replace function public.save_note_line(p_note uuid, p_line uuid, p_description text, p_quantity numeric, p_unit_price numeric)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  if not public.invoice_lines_editable(p_note) then
    raise exception 'Only the lines of a credit or debit note can be changed';
  end if;
  if nullif(btrim(coalesce(p_description, '')), '') is null or coalesce(p_quantity, 0) <= 0 or p_unit_price is null then
    raise exception 'Enter the description, quantity and price';
  end if;
  if p_line is null then
    insert into public.invoice_lines (invoice_id, sort_order, kind, description, quantity, unit_price, amount)
    values (p_note, (select count(*) from public.invoice_lines where invoice_id = p_note), 'service',
            btrim(p_description), p_quantity, p_unit_price, round(p_quantity * p_unit_price, 2));
  else
    update public.invoice_lines
       set description = btrim(p_description), quantity = p_quantity, unit_price = p_unit_price,
           amount = round(p_quantity * p_unit_price, 2)
     where id = p_line and invoice_id = p_note;
  end if;
end
$$;

create or replace function public.delete_note_line(p_note uuid, p_line uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  if not public.invoice_lines_editable(p_note) then
    raise exception 'Only the lines of a credit or debit note can be changed';
  end if;
  delete from public.invoice_lines where id = p_line and invoice_id = p_note;
end
$$;

create or replace function public.delete_invoice_note(p_note uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  if not public.invoice_lines_editable(p_note) then
    raise exception 'Only a draft note can be deleted';
  end if;
  delete from public.invoices where id = p_note;   -- invoices_guard refuses an issued one
end
$$;

/** What is still to pay: the total, corrected by issued notes, less the payments. */
create or replace function public.invoice_open_amount(p_invoice uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select i.total
         - coalesce((select sum(n.total) from public.invoices n where n.corrects_invoice_id = i.id and n.kind = 'credit_note' and n.status = 'issued'), 0)
         + coalesce((select sum(n.total) from public.invoices n where n.corrects_invoice_id = i.id and n.kind = 'debit_note' and n.status = 'issued'), 0)
         - coalesce((select sum(p.amount) from public.invoice_payments p where p.invoice_id = i.id), 0)
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
  if inv.id is null or inv.status <> 'issued' or inv.kind <> 'invoice' or inv.order_id is not null then
    raise exception 'Payments are recorded on an issued invoice without an order';
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

create or replace function public.delete_invoice_payment(p_payment uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin');
  delete from public.invoice_payments where id = p_payment;
end
$$;

revoke execute on function public.create_client_invoice(uuid, numeric, date, text, text, text) from public, anon;
revoke execute on function public.set_client_invoice_terms(uuid, numeric, date, date, text, text) from public, anon;
revoke execute on function public.invoice_open_amount(uuid) from public, anon;
revoke execute on function public.add_invoice_payment(uuid, date, numeric, text, text) from public, anon;
revoke execute on function public.delete_invoice_payment(uuid) from public, anon;
grant execute on function public.create_client_invoice(uuid, numeric, date, text, text, text) to authenticated;
grant execute on function public.set_client_invoice_terms(uuid, numeric, date, date, text, text) to authenticated;
grant execute on function public.invoice_open_amount(uuid) to authenticated;
grant execute on function public.add_invoice_payment(uuid, date, numeric, text, text) to authenticated;
grant execute on function public.delete_invoice_payment(uuid) to authenticated;
