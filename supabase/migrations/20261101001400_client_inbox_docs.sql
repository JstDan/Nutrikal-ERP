-- Customer panel, second step (owner, Nov 2026).
-- Conversations stay conversations, but each has a status and a person responsible, so the team works from one inbox.
-- Status changes of an order wait in a queue; the hourly job e-mails them, because they happen in many places.
-- Clients also read proformas and delivery notes, without internal notes.

-- ---------------------------------------------------------------- threads
create table public.client_threads (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  order_id    uuid references public.sales_orders (id) on delete cascade,   -- null: the general conversation
  status      text not null default 'open' check (status in ('open', 'waiting', 'solved')),
  assigned_to uuid references public.profiles (id) on delete set null,
  last_at     timestamptz not null default now()
);
create unique index client_threads_one on public.client_threads (client_id, coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.client_threads enable row level security;
create policy client_threads_select on public.client_threads for select to authenticated
  using (public.has_role('admin', 'sales'));

-- A message from the client opens the thread, an answer leaves it waiting for the client
create or replace function public.client_thread_touch()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.client_threads (client_id, order_id, status, last_at)
  values (new.client_id, new.order_id, case when new.from_client then 'open' else 'waiting' end, new.created_at)
  on conflict (client_id, coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set status = excluded.status, last_at = excluded.last_at;
  -- Whoever answers has read what came before
  if not new.from_client then
    update public.client_messages set read_at = now()
     where client_id = new.client_id and order_id is not distinct from new.order_id and from_client and read_at is null;
  end if;
  return new;
end
$$;
create trigger client_messages_thread after insert on public.client_messages
  for each row execute function public.client_thread_touch();

create or replace function public.client_inbox(p_status text default null)
returns table (id uuid, client_id uuid, client text, order_id uuid, order_code text, status text, assigned_to uuid, assignee text,
               last_at timestamptz, last_body text, last_from_client boolean, unread integer)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  return query
    select t.id, t.client_id, c.legal_name::text, t.order_id, so.code, t.status, t.assigned_to, p.full_name, t.last_at, m.body, m.from_client,
           (select count(*)::int from public.client_messages x
             where x.client_id = t.client_id and x.order_id is not distinct from t.order_id and x.from_client and x.read_at is null)
      from public.client_threads t
      join public.clients c on c.id = t.client_id
      left join public.sales_orders so on so.id = t.order_id
      left join public.profiles p on p.id = t.assigned_to
      left join lateral (select y.body, y.from_client from public.client_messages y
                          where y.client_id = t.client_id and y.order_id is not distinct from t.order_id
                          order by y.created_at desc limit 1) m on true
     where p_status is null or t.status = p_status
     order by case t.status when 'open' then 0 when 'waiting' then 1 else 2 end, t.last_at desc;
end
$$;

create or replace function public.client_thread_set(p_client uuid, p_order uuid, p_status text, p_assigned uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  if p_assigned is not null and not exists (select 1 from public.profiles where id = p_assigned and is_active and role in ('admin', 'sales', 'bookkeeper')) then
    raise exception 'Not someone from the team';
  end if;
  update public.client_threads set status = p_status, assigned_to = p_assigned
   where client_id = p_client and order_id is not distinct from p_order;
end
$$;

create or replace function public.client_team()
returns table (id uuid, full_name text)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  return query select p.id, p.full_name from public.profiles p
   where p.is_active and p.role in ('admin', 'sales', 'bookkeeper') order by lower(p.full_name);
end
$$;

create or replace function public.portal_threads()
returns table (order_id uuid, order_code text, status text, last_at timestamptz, last_body text, unread integer)
language sql stable security definer set search_path = public
as $$
  select t.order_id, so.code, t.status, t.last_at,
         (select y.body from public.client_messages y where y.client_id = t.client_id and y.order_id is not distinct from t.order_id order by y.created_at desc limit 1),
         (select count(*)::int from public.client_messages x
           where x.client_id = t.client_id and x.order_id is not distinct from t.order_id and not x.from_client and x.read_at is null)
    from public.client_threads t left join public.sales_orders so on so.id = t.order_id
   where t.client_id = public.portal_client()
   order by t.last_at desc
$$;

-- ---------------------------------------------------------------- status e-mails
create table public.client_status_mail (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.sales_orders (id) on delete cascade,
  status     text not null,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index client_status_mail_waiting on public.client_status_mail (created_at) where sent_at is null;
alter table public.client_status_mail enable row level security;   -- no policies: only the job reads it

create or replace function public.client_status_queue()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status::text in ('confirmed', 'in_production', 'ready', 'dispatched') then
    insert into public.client_status_mail (order_id, status) values (new.id, new.status::text);
  end if;
  return new;
end
$$;
create trigger sales_orders_status_mail after update of status on public.sales_orders
  for each row execute function public.client_status_queue();

-- What the job sends: to active accounts of the client, only news of the last week. Nothing else can call these.
create or replace function public.client_status_jobs()
returns table (id uuid, status text, code text, email text, locale text)
language sql stable security definer set search_path = public
as $$
  select m.id, m.status, so.code, p.email::text, c.preferred_locale::text
    from public.client_status_mail m
    join public.sales_orders so on so.id = m.order_id
    join public.clients c on c.id = so.client_id
    join public.client_users cu on cu.client_id = c.id
    join public.profiles p on p.id = cu.user_id and p.is_active
   where m.sent_at is null and m.created_at > now() - interval '7 days'
   order by m.created_at
$$;

create or replace function public.client_status_done()
returns void
language sql security definer set search_path = public
as $$ update public.client_status_mail set sent_at = now() where sent_at is null $$;
revoke execute on function public.client_status_jobs(), public.client_status_done() from public, anon, authenticated;

-- ---------------------------------------------------------------- documents
create or replace function public.portal_proforma(p_order uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'doc', jsonb_build_object('code', so.code, 'currency', so.currency, 'vat_pct', so.vat_pct::text, 'created_at', so.created_at::text, 'customer_ref', so.customer_ref,
      'locale', c.preferred_locale, 'client', c.legal_name, 'client_vat', c.vat_number, 'client_company_id', c.company_id, 'client_address', c.address_line1,
      'client_registration', c.registration_address, 'client_city', c.city, 'client_postal', c.postal_code, 'client_country', c.country_code),
    'seller', (select jsonb_build_object('company_name', s.company_name, 'company_id', s.company_id, 'company_vat', s.company_vat, 'company_address', s.company_address,
      'company_email', s.company_email, 'company_phone', s.company_phone, 'bank_name', s.bank_name, 'bank_iban', s.bank_iban, 'bank_bic', s.bank_bic, 'logo_data_url', s.logo_data_url)
      from public.calc_settings s limit 1),
    'rate', public.order_vat_rate(so.id), 'done', public.order_production_done(so.id),
    'pay', jsonb_build_object('transport_amount', so.transport_amount::text, 'deposit_amount', so.deposit_amount::text, 'deposit_pct', so.deposit_pct::text),
    'ordered', (select coalesce(sum(round(l.quantity * l.unit_price, 2)), 0) from public.sales_order_lines l where l.order_id = so.id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'description', coalesce(l.description, f.name, ''), 'quantity', l.quantity, 'unit_price', l.unit_price::text,
        'offer_no', coalesce(co.offer_no, of.code),
        'capsules', case when co.data ->> 'mode' = 'catalog' then
                           case when co.data ->> 'catalogCapsules' ~ '^[0-9]+$' then (co.data ->> 'catalogCapsules')::int
                                else nullif(co.data -> 'catalog' ->> 'capsules_per_container', '')::int end
                         when co.data ->> 'productType' like 'capsules%' and co.data ->> 'quantityPerUnit' ~ '^[0-9]+$' then (co.data ->> 'quantityPerUnit')::int end,
        'produced', (select sum(m.produced_quantity)::int from public.manufacturing_orders m where m.sales_order_line_id = l.id and m.status = 'completed')) order by l.sort_order)
      from public.sales_order_lines l
      left join public.calc_offers co on co.id = l.calc_offer_id
      left join public.offers of on of.id = l.offer_id
      left join public.formula_versions v on v.id = l.formula_version_id
      left join public.formulas f on f.id = v.formula_id
     where l.order_id = so.id), '[]'))
    from public.sales_orders so join public.clients c on c.id = so.client_id
   where so.id = p_order and public.portal_own_order(so.id)
$$;

create or replace function public.portal_delivery(p_dispatch uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'note', jsonb_build_object('code', d.code, 'dispatched_on', d.dispatched_on::text, 'carrier', d.carrier, 'tracking', d.tracking, 'order_code', so.code, 'customer_ref', so.customer_ref,
      'locale', c.preferred_locale, 'client', c.legal_name, 'client_vat', c.vat_number, 'client_company_id', c.company_id, 'client_address', c.address_line1,
      'client_registration', c.registration_address, 'client_city', c.city, 'client_postal', c.postal_code, 'client_country', c.country_code),
    'seller', (select jsonb_build_object('company_name', s.company_name, 'company_id', s.company_id, 'company_vat', s.company_vat, 'company_address', s.company_address,
      'company_email', s.company_email, 'company_phone', s.company_phone, 'logo_data_url', s.logo_data_url) from public.calc_settings s limit 1),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'name_bg', i.name_bg, 'lot_number', lo.lot_number, 'expires_on', lo.expires_on::text, 'quantity', dl.quantity::text) order by i.name, lo.lot_number)
      from public.dispatch_lines dl join public.lots lo on lo.id = dl.lot_id join public.items i on i.id = dl.item_id where dl.dispatch_id = d.id), '[]'))
    from public.dispatches d join public.sales_orders so on so.id = d.order_id join public.clients c on c.id = so.client_id
   where d.id = p_dispatch and public.portal_own_order(so.id)
$$;

do $$
declare
  f text;
begin
  foreach f in array array['client_inbox(text)', 'client_thread_set(uuid, uuid, text, uuid)', 'client_team()', 'portal_threads()', 'portal_proforma(uuid)', 'portal_delivery(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$$;
