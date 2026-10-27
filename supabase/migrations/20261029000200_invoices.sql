-- =====================================================================
-- Nutrikal ERP + CRM — invoices of paid orders (Phase 4, first part)
-- Owner, Oct 2026: once the payment of an order is confirmed, "Export
-- invoice" replaces "Export proforma"; the invoice is kept under Invoices.
--
-- Decisions (CLAUDE.md): FINAL invoices; one 10-digit series shared by
-- invoices, credit and debit notes (number_series 'invoice'); the number
-- can be changed on a draft before issue (gap / duplicate checked, audit
-- log); locked once issued; corrections only through credit / debit notes
-- (kind is ready for them, not built yet). The data maps to EN 16931:
-- seller and buyer snapshots (name, address, country, VAT and company
-- ids), currency, issue and tax point dates, lines, VAT rate and totals,
-- payment means.
--
-- Owner, Oct 2026: an order paid with an advance gets two invoices — the
-- advance invoice (the advance %, once the first payment is confirmed),
-- then the final (balance) invoice: every line of the order less the
-- advance invoiced, printable once the final payment is confirmed. An
-- order paid 100 % at once gets one full invoice. Advance = a deposit
-- between 0 and 100 % on the order.
--
-- Flow: create_order_invoice(order, purpose) opens the order's draft of
-- that purpose (one each) with its lines; issue_invoice(draft, number,
-- date) takes the number, fixes seller, buyer and totals and locks it.
--
--                    admin   sales   production
-- read                yes     yes     —
-- open a draft        yes     yes     —
-- issue (next no.)    yes     yes     —
-- issue (other no.)   yes     —       —
-- change an issued    —       —       —
-- =====================================================================

create type public.invoice_kind as enum ('invoice', 'credit_note', 'debit_note');
create type public.invoice_status as enum ('draft', 'issued');

create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  kind            public.invoice_kind not null default 'invoice',
  status          public.invoice_status not null default 'draft',
  purpose         text not null default 'full' check (purpose in ('full', 'advance', 'final')),
  number          text unique check (number ~ '^[0-9]{10}$'),
  order_id        uuid not null references public.sales_orders (id),
  client_id       uuid not null references public.clients (id),
  issue_date      date,
  tax_point_date  date,                       -- date of the taxable event: the payment
  currency        char(3) not null,
  vat_pct         numeric(5, 2) not null default 0 check (vat_pct between 0 and 100),
  locale          text not null default 'en' check (locale in ('bg', 'en')),
  seller          jsonb not null,             -- name, company_id, vat, address, email, phone, bank_name, iban, bic
  buyer           jsonb not null,             -- name, company_id, vat, address, city, postal_code, country, customer_ref
  subtotal        numeric(14, 2),
  vat_amount      numeric(14, 2),
  total           numeric(14, 2),
  notes           text,
  issued_by       uuid references public.profiles (id),
  issued_at       timestamptz,
  created_by      uuid references public.profiles (id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (status = 'draft' or (number is not null and issue_date is not null and total is not null))
);
create unique index invoices_one_per_order on public.invoices (order_id, purpose) where kind = 'invoice';
create index invoices_client_idx on public.invoices (client_id);

create table public.invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  sort_order   integer not null default 0,
  kind         text not null check (kind in ('offer', 'calc_offer', 'service', 'advance')),   -- advance: the advance, or its deduction
  description  text not null,
  offer_no     text,                          -- "according to offer No …"
  capsules     integer,                       -- capsules per jar, for the description
  quantity     numeric(14, 3) not null check (quantity > 0),
  unit_price   numeric(12, 4) not null,
  amount       numeric(14, 2) not null,
  check (kind = 'advance' or unit_price >= 0)
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id, sort_order);

create trigger invoices_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();
select public.enable_audit('public.invoices');
select public.enable_audit('public.invoice_lines');

-- An issued invoice never changes (corrections: credit / debit notes)
create or replace function public.invoices_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'issued' then
      raise exception 'An issued invoice cannot be deleted';
    end if;
    return old;
  end if;
  if old.status = 'issued' then
    raise exception 'An issued invoice cannot be changed; issue a credit or debit note';
  end if;
  return new;
end
$$;
create trigger invoices_guard before update or delete on public.invoices
  for each row execute function public.invoices_guard();

create or replace function public.invoice_lines_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from public.invoices
              where id = case when tg_op = 'INSERT' then new.invoice_id else old.invoice_id end and status = 'issued') then
    raise exception 'An issued invoice cannot be changed; issue a credit or debit note';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
create trigger invoice_lines_guard before insert or update or delete on public.invoice_lines
  for each row execute function public.invoice_lines_guard();

-- Seller (calculator settings, as on the proforma) and buyer (the client) as they are now
create or replace function public.invoice_parties(p_order uuid, out seller jsonb, out buyer jsonb)
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('name', s.company_name, 'company_id', s.company_id, 'vat', s.company_vat,
           'address', s.company_address, 'email', s.company_email, 'phone', s.company_phone,
           'bank_name', s.bank_name, 'iban', s.bank_iban, 'bic', s.bank_bic),
         jsonb_build_object('name', c.legal_name, 'company_id', c.company_id, 'vat', c.vat_number,
           'address', coalesce(nullif(c.registration_address, ''), c.address_line1), 'city', c.city,
           'postal_code', c.postal_code, 'country', c.country_code, 'customer_ref', so.customer_ref,
           'registration', nullif(c.registration_address, '') is not null)
    from public.sales_orders so
    join public.clients c on c.id = so.client_id
    left join lateral (select * from public.calc_settings limit 1) s on true
   where so.id = p_order
$$;
revoke execute on function public.invoice_parties(uuid) from public, anon, authenticated;

/** True when the order is paid with an advance and a balance (two invoices). */
create or replace function public.order_paid_in_two(p_order uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select deposit_pct > 0 and deposit_pct < 100 from public.sales_orders where id = p_order), false)
$$;
revoke execute on function public.order_paid_in_two(uuid) from public, anon;

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

/** The next number of the shared invoice series (10 digits), without taking it. */
create or replace function public.next_invoice_number()
returns text
language sql stable security definer set search_path = public
as $$
  select prefix || lpad(next_number::text, pad_length, '0') from public.number_series where key = 'invoice' and public.is_staff()
$$;

/**
 * Issues a draft: number (the next of the series; another one only by admin, confirmed, never a duplicate),
 * issue date, seller and buyer as they are now, totals; then it is locked. The series continues after the number.
 */
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
  select * into p from public.invoice_parties(inv.order_id);

  update public.invoices
     set status = 'issued', number = p_number, issue_date = p_issue_date, seller = p.seller, buyer = p.buyer,
         subtotal = v_sub, vat_amount = v_vat, total = v_sub + v_vat, issued_by = auth.uid(), issued_at = now()
   where id = p_invoice;
  -- The series continues after the highest number issued
  update public.number_series set next_number = greatest(next_number, p_number::bigint + 1) where key = 'invoice';
  return p_number;
end
$$;

-- Access: staff read; every change goes through the functions above
alter table public.invoices      enable row level security;
alter table public.invoice_lines enable row level security;
create policy invoices_select on public.invoices for select to authenticated using (public.is_staff());
create policy invoice_lines_select on public.invoice_lines for select to authenticated
  using (public.is_staff());
revoke insert, update, delete, truncate, references, trigger on public.invoices, public.invoice_lines from anon, authenticated;
grant select on public.invoices, public.invoice_lines to authenticated;

revoke execute on function public.create_order_invoice(uuid, text) from public, anon;
grant execute on function public.create_order_invoice(uuid, text) to authenticated;
revoke execute on function public.next_invoice_number() from public, anon;
grant execute on function public.next_invoice_number() to authenticated;
revoke execute on function public.issue_invoice(uuid, text, date, boolean) from public, anon;
grant execute on function public.issue_invoice(uuid, text, date, boolean) to authenticated;
