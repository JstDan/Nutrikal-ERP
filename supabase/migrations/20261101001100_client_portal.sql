-- Customer panel (owner, Nov 2026). A client account belongs to one client and has no rights on any
-- table: has_role() is false for it, so every existing rule refuses it. It reads and writes only
-- through the portal_ functions below, each limited to its own client and to chosen columns.
-- Files and certificates appear only once the team has shared them; issued invoices appear by themselves.

create table public.client_users (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  client_id  uuid not null references public.clients (id) on delete cascade,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index client_users_client_idx on public.client_users (client_id);
alter table public.client_users enable row level security;
create policy client_users_select on public.client_users for select to authenticated
  using (public.has_role('admin', 'sales'));

alter table public.client_files
  add column shared_with_client boolean not null default false,
  add column shared_at timestamptz,
  add column shared_by uuid references public.profiles (id);
alter table public.lots
  add column coa_shared boolean not null default false;

create table public.client_messages (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  order_id    uuid references public.sales_orders (id) on delete cascade,   -- null: the general conversation
  sender_id   uuid references public.profiles (id) on delete set null,
  from_client boolean not null,
  body        text not null check (length(trim(body)) between 1 and 4000),
  read_at     timestamptz,                                                   -- by the other side
  created_at  timestamptz not null default now()
);
create index client_messages_thread_idx on public.client_messages (client_id, order_id, created_at);
alter table public.client_messages enable row level security;
create policy client_messages_select on public.client_messages for select to authenticated
  using (public.has_role('admin', 'sales'));

-- ---------------------------------------------------------------- who is asking
create or replace function public.portal_client()
returns uuid
language sql stable security definer set search_path = public
as $$
  select cu.client_id from public.client_users cu join public.profiles p on p.id = cu.user_id
   where cu.user_id = auth.uid() and p.is_active and p.role = 'client'
$$;

-- An order the client may see: their own, once it is no longer a draft
create or replace function public.portal_own_order(p_order uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.sales_orders so
                  where so.id = p_order and so.client_id = public.portal_client() and so.status <> 'draft')
$$;

-- ---------------------------------------------------------------- helpers, not callable by anyone signed in
-- The value of an order without VAT, as it is invoiced: the units produced once every batch is made, plus transport
create or replace function public.portal_order_value(p_order uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce((
           select sum(round((case when l.kind <> 'service' and exists (select 1 from public.manufacturing_orders m where m.sales_order_line_id = l.id)
                                       and not exists (select 1 from public.sales_order_lines x where x.order_id = l.order_id and x.kind <> 'service'
                                                          and not exists (select 1 from public.manufacturing_orders m where m.sales_order_line_id = x.id and m.status = 'completed'))
                                  then coalesce((select sum(m.produced_quantity) from public.manufacturing_orders m where m.sales_order_line_id = l.id and m.status = 'completed'), l.quantity)
                                  else l.quantity end) * l.unit_price, 2))
             from public.sales_order_lines l where l.order_id = p_order), 0)
         + coalesce((select so.transport_amount from public.sales_orders so where so.id = p_order), 0)
$$;

-- Still to pay on an order, VAT included. Invoices of orders are issued after the payment, so this is what a client owes on them.
create or replace function public.portal_order_due(p_order uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select case when so.status in ('draft', 'cancelled') or so.balance_received_on is not null then 0
              when so.deposit_received_on is null then x.gross
              when not public.order_paid_in_two(so.id) then 0
              else greatest(x.gross - coalesce(so.deposit_amount, round(x.gross * so.deposit_pct / 100, 2)), 0) end
    from public.sales_orders so,
         lateral (select round(public.portal_order_value(so.id) * (1 + coalesce(so.vat_pct, 0) / 100), 2) as gross) x
   where so.id = p_order
$$;

create or replace function public.portal_invoice_open(p_invoice uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select case when coalesce(public.invoice_paid_by_order(i.id), false) then 0 else
         i.total
         - coalesce((select sum(n.total) from public.invoices n where n.corrects_invoice_id = i.id and n.kind = 'credit_note' and n.status = 'issued'), 0)
         + coalesce((select sum(n.total) from public.invoices n where n.corrects_invoice_id = i.id and n.kind = 'debit_note' and n.status = 'issued'), 0)
         - coalesce((select sum(p.amount) from public.invoice_payments p where p.invoice_id = i.id), 0) end
    from public.invoices i where i.id = p_invoice
$$;
revoke execute on function public.portal_order_value(uuid), public.portal_order_due(uuid), public.portal_invoice_open(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- reading
create or replace function public.portal_me()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('client', c.legal_name, 'unread',
           (select count(*) from public.client_messages m where m.client_id = c.id and not m.from_client and m.read_at is null))
    from public.clients c where c.id = public.portal_client()
$$;

create or replace function public.portal_orders()
returns table (id uuid, code text, status text, customer_ref text, requested_date date, created_at timestamptz,
               dispatched_at timestamptz, currency text, value numeric, due numeric, products integer, unread integer)
language sql stable security definer set search_path = public
as $$
  select so.id, so.code, so.status::text, so.customer_ref, so.requested_date, so.created_at, so.dispatched_at, so.currency::text,
         public.portal_order_value(so.id), public.portal_order_due(so.id),
         (select count(*)::int from public.sales_order_lines l where l.order_id = so.id and l.kind <> 'service'),
         (select count(*)::int from public.client_messages m where m.order_id = so.id and not m.from_client and m.read_at is null)
    from public.sales_orders so
   where so.client_id = public.portal_client() and so.status <> 'draft'
   order by so.created_at desc
$$;

create or replace function public.portal_order(p_order uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', so.id, 'code', so.code, 'status', so.status, 'customer_ref', so.customer_ref, 'requested_date', so.requested_date,
    'currency', so.currency, 'value', public.portal_order_value(so.id), 'due', public.portal_order_due(so.id), 'deposit_pct', so.deposit_pct,
    'confirmed_at', so.confirmed_at, 'deposit_received_on', so.deposit_received_on, 'balance_received_on', so.balance_received_on,
    'dispatched_at', so.dispatched_at,
    'production_started_at', (select min(coalesce(m.started_at, m.released_at)) from public.manufacturing_orders m join public.sales_order_lines l on l.id = m.sales_order_line_id where l.order_id = so.id and m.status in ('in_production', 'completed')),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('description', coalesce(l.description, f.name, ''), 'kind', l.kind, 'quantity', l.quantity, 'unit_price', l.unit_price) order by l.sort_order)
                         from public.sales_order_lines l
                         left join public.formula_versions v on v.id = l.formula_version_id
                         left join public.formulas f on f.id = v.formula_id
                        where l.order_id = so.id), '[]'),
    'batches', coalesce((select jsonb_agg(jsonb_build_object('lot_id', lo.id, 'lot_number', lo.lot_number, 'quantity', m.produced_quantity, 'produced_on', m.produced_on,
                                                             'expires_on', lo.expires_on, 'released', lo.qc_status = 'released',
                                                             'coa', lo.coa_shared and lo.coa_path is not null) order by m.produced_on)
                           from public.manufacturing_orders m join public.sales_order_lines l on l.id = m.sales_order_line_id
                           join public.lots lo on lo.id = m.finished_lot_id
                          where l.order_id = so.id and m.status = 'completed'), '[]'),
    'dispatches', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'dispatched_on', d.dispatched_on, 'carrier', d.carrier, 'tracking', d.tracking) order by d.dispatched_on)
                              from public.dispatches d where d.order_id = so.id), '[]'))
    from public.sales_orders so
   where so.id = p_order and public.portal_own_order(so.id)
$$;

create or replace function public.portal_invoices()
returns table (id uuid, kind text, number text, issue_date date, due_date date, currency text, total numeric, open_amount numeric, order_id uuid, order_code text)
language sql stable security definer set search_path = public
as $$
  select i.id, i.kind::text, i.number, i.issue_date, i.due_date, i.currency::text, i.total,
         case when i.kind = 'invoice' then public.portal_invoice_open(i.id) end, i.order_id, so.code
    from public.invoices i left join public.sales_orders so on so.id = i.order_id
   where i.client_id = public.portal_client() and i.status = 'issued'
   order by i.issue_date desc, i.number desc
$$;

-- An issued invoice with what its document needs, from the same columns as the staff page
create or replace function public.portal_invoice(p_invoice uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', i.id, 'kind', i.kind, 'status', i.status, 'number', i.number, 'issue_date', i.issue_date, 'tax_point_date', i.tax_point_date,
    'currency', i.currency, 'vat_pct', i.vat_pct::text, 'locale', i.locale, 'seller', i.seller, 'buyer', i.buyer, 'notes', i.notes,
    'subtotal', i.subtotal::text, 'vat_amount', i.vat_amount::text, 'total', i.total::text, 'order_id', i.order_id, 'order_code', so.code,
    'client_id', i.client_id, 'due_date', i.due_date, 'payment_method', i.payment_method, 'vat_basis', i.vat_basis,
    'proforma_no', i.proforma_no, 'proforma_date', i.proforma_date, 'reason', i.reason, 'corrects_invoice_id', i.corrects_invoice_id,
    'corrects_number', o.number, 'corrects_date', o.issue_date,
    'open_amount', case when i.kind = 'invoice' then public.portal_invoice_open(i.id) end,
    'logo', (select s.logo_data_url from public.calc_settings s limit 1),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'description', l.description, 'offer_no', l.offer_no, 'capsules', l.capsules,
                                                           'quantity', l.quantity::text, 'unit_price', l.unit_price::text, 'amount', l.amount::text) order by l.sort_order)
                         from public.invoice_lines l where l.invoice_id = i.id), '[]'),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('paid_on', p.paid_on, 'amount', p.amount) order by p.paid_on)
                            from public.invoice_payments p where p.invoice_id = i.id), '[]'))
    from public.invoices i
    left join public.sales_orders so on so.id = i.order_id
    left join public.invoices o on o.id = i.corrects_invoice_id
   where i.id = p_invoice and i.client_id = public.portal_client() and i.status = 'issued'
$$;

-- What the team shared: files of the client and certificates of their batches
create or replace function public.portal_documents(p_order uuid default null)
returns table (kind text, id uuid, name text, category text, note text, shared_at timestamptz, order_id uuid, order_code text)
language sql stable security definer set search_path = public
as $$
  select 'file', f.id, f.file_name, f.category, f.note, f.shared_at, f.order_id, so.code
    from public.client_files f left join public.sales_orders so on so.id = f.order_id
   where f.client_id = public.portal_client() and f.shared_with_client
     and (p_order is null or f.order_id = p_order)
  union all
  select 'coa', lo.id, lo.lot_number, 'coa', null, lo.updated_at, so.id, so.code
    from public.lots lo
    join public.manufacturing_orders m on m.finished_lot_id = lo.id
    join public.sales_order_lines l on l.id = m.sales_order_line_id
    join public.sales_orders so on so.id = l.order_id
   where so.client_id = public.portal_client() and so.status <> 'draft' and lo.coa_shared and lo.coa_path is not null
     and (p_order is null or so.id = p_order)
   order by 6 desc
$$;

create or replace function public.portal_file(p_file uuid)
returns table (file_name text, storage_path text)
language sql stable security definer set search_path = public
as $$
  select f.file_name, f.storage_path from public.client_files f
   where f.id = p_file and f.client_id = public.portal_client() and f.shared_with_client
$$;

create or replace function public.portal_coa(p_lot uuid)
returns table (lot_number text, coa_path text)
language sql stable security definer set search_path = public
as $$
  select lo.lot_number, lo.coa_path from public.lots lo
   where lo.id = p_lot and lo.coa_shared and lo.coa_path is not null
     and exists (select 1 from public.manufacturing_orders m join public.sales_order_lines l on l.id = m.sales_order_line_id
                  where m.finished_lot_id = lo.id and public.portal_own_order(l.order_id))
$$;

-- ---------------------------------------------------------------- messages
create or replace function public.portal_feed(p_order uuid default null)
returns table (id uuid, from_client boolean, author text, body text, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select m.id, m.from_client, coalesce(p.full_name, ''), m.body, m.created_at
    from public.client_messages m left join public.profiles p on p.id = m.sender_id
   where m.client_id = public.portal_client() and m.order_id is not distinct from p_order
     and (p_order is null or public.portal_own_order(p_order))
   order by m.created_at
$$;

create or replace function public.portal_post(p_order uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_client uuid := public.portal_client();
  v_id uuid;
  v_code text;
  v_name text;
  r public.app_role;
begin
  if v_client is null or (p_order is not null and not public.portal_own_order(p_order)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if (select count(*) from public.client_messages where sender_id = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'portal_busy';
  end if;
  insert into public.client_messages (client_id, order_id, sender_id, from_client, body)
  values (v_client, p_order, auth.uid(), true, trim(p_body)) returning id into v_id;
  select legal_name into v_name from public.clients where id = v_client;
  select code into v_code from public.sales_orders where id = p_order;
  foreach r in array array['admin', 'sales', 'bookkeeper']::public.app_role[] loop
    perform public.notify_role(r, 'client_message', jsonb_build_object('client', v_name, 'code', v_code),
      coalesce('/orders/' || p_order::text, '/clients/' || v_client::text));
  end loop;
  return v_id;
end
$$;

create or replace function public.portal_mark_read(p_order uuid default null)
returns void
language sql security definer set search_path = public
as $$
  update public.client_messages m set read_at = now()
   where m.client_id = public.portal_client() and m.order_id is not distinct from p_order and not m.from_client and m.read_at is null
$$;

-- ---------------------------------------------------------------- the team's side
create or replace function public.client_message_send(p_client uuid, p_order uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.require_role('admin', 'sales');
  if p_order is not null and not exists (select 1 from public.sales_orders where id = p_order and client_id = p_client) then
    raise exception 'Order of another client';
  end if;
  insert into public.client_messages (client_id, order_id, sender_id, from_client, body)
  values (p_client, p_order, auth.uid(), false, trim(p_body)) returning id into v_id;
  return v_id;
end
$$;

create or replace function public.client_messages_read(p_client uuid, p_order uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  update public.client_messages m set read_at = now()
   where m.client_id = p_client and m.order_id is not distinct from p_order and m.from_client and m.read_at is null;
end
$$;

create or replace function public.client_file_share(p_file uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  update public.client_files set shared_with_client = p_on,
         shared_at = case when p_on then now() end, shared_by = case when p_on then auth.uid() end
   where id = p_file;
end
$$;

create or replace function public.lot_coa_share(p_lot uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  update public.lots set coa_shared = p_on where id = p_lot;
end
$$;

-- Accounts of a client. Admin connects them; the sign-in account itself is made by the server.
create or replace function public.client_user_connect(p_user uuid, p_client uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin');
  if not exists (select 1 from public.profiles where id = p_user and role = 'client') then
    raise exception 'Not a client account';
  end if;
  insert into public.client_users (user_id, client_id) values (p_user, p_client);
end
$$;

create or replace function public.client_user_list(p_client uuid)
returns table (user_id uuid, full_name text, email text, is_active boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  return query select p.id, p.full_name, p.email::text, p.is_active
    from public.client_users cu join public.profiles p on p.id = cu.user_id
   where cu.client_id = p_client order by p.full_name;
end
$$;

create or replace function public.client_user_active(p_user uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin');
  update public.profiles set is_active = p_active where id = p_user and role = 'client';
end
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'portal_client()', 'portal_own_order(uuid)', 'portal_me()', 'portal_orders()', 'portal_order(uuid)', 'portal_invoices()', 'portal_invoice(uuid)',
    'portal_documents(uuid)', 'portal_file(uuid)', 'portal_coa(uuid)', 'portal_feed(uuid)', 'portal_post(uuid, text)', 'portal_mark_read(uuid)',
    'client_message_send(uuid, uuid, text)', 'client_messages_read(uuid, uuid)', 'client_file_share(uuid, boolean)', 'lot_coa_share(uuid, boolean)',
    'client_user_connect(uuid, uuid)', 'client_user_list(uuid)', 'client_user_active(uuid, boolean)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$$;

-- ---------------------------------------------------------------- rules that accepted any account
-- These were written for staff and Production only, so a client account is shut out by name here
drop policy items_select on public.items;
create policy items_select on public.items for select to authenticated
  using (public.current_app_role() <> 'client');

create or replace function public.chat_member()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.current_app_role() not in ('production', 'client'), false) $$;

create or replace function public.chat_can(p_channel uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case when public.current_app_role() = 'client' then false else
         case c.kind
           when 'direct' then exists (select 1 from public.chat_channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
           when 'external' then public.current_app_role() is not null
           else coalesce(public.current_app_role() <> 'production', false) end end
    from public.chat_channels c where c.id = p_channel
$$;

create or replace function public.chat_people(p_channel uuid default null)
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name from public.profiles p
   where p.is_active and p.role not in ('developer', 'client') and p.id <> auth.uid()
     and public.current_app_role() is not null and public.current_app_role() <> 'client'
     and (public.current_app_role() <> 'production' or p_channel is not null)
     and (p.role <> 'production' or (select kind from public.chat_channels where id = p_channel) = 'external')
     and (p_channel is null or public.chat_can(p_channel))
     and ((select kind from public.chat_channels where id = p_channel) is distinct from 'direct'
          or exists (select 1 from public.chat_channel_members m where m.channel_id = p_channel and m.user_id = p.id))
   order by lower(p.full_name)
$$;

-- The notification of a message from a client
do $$
declare
  v text;
begin
  select pg_get_constraintdef(oid) into v from pg_constraint where conname = 'notifications_kind_check';
  execute 'alter table public.notifications drop constraint notifications_kind_check';
  execute 'alter table public.notifications add constraint notifications_kind_check '
    || replace(v, $q$'catalog_enquiry'::text$q$, $q$'catalog_enquiry'::text, 'client_message'::text$q$);
end
$$;
