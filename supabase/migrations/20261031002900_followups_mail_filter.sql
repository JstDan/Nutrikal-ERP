-- =====================================================================
-- Follow-ups (owner, Oct 2026):
--  - offers without an order after some days wait for a reminder
--  - clients who usually order again by now
-- Mail sync: Gmail is searched for client addresses only, so far fewer
-- messages are read. When the list of addresses changes, it starts over.
-- =====================================================================

alter table public.company_settings add column offer_followup_days integer not null default 7 check (offer_followup_days > 0);

-- Offers a person took out of the list (no interest, answered by phone)
create table public.calc_offer_closed (
  offer_id   uuid primary key references public.calc_offers (id) on delete cascade,
  closed_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  closed_at  timestamptz not null default now()
);
alter table public.calc_offer_closed enable row level security;
create policy calc_offer_closed_select on public.calc_offer_closed for select to authenticated using (public.has_role('admin', 'sales'));
create policy calc_offer_closed_insert on public.calc_offer_closed for insert to authenticated with check (public.has_role('admin', 'sales'));
create policy calc_offer_closed_delete on public.calc_offer_closed for delete to authenticated using (public.has_role('admin', 'sales'));

create view public.offers_waiting with (security_invoker = true) as
  select o.id, o.offer_no, coalesce(c.legal_name, o.company_name, o.receiver_name) as client, o.product_name, o.created_at
    from public.calc_offers o
    left join public.clients c on c.id = o.client_id
   where o.created_at < now() - make_interval(days => (select offer_followup_days from public.company_settings limit 1))
     and o.created_at > now() - interval '60 days'
     and not exists (select 1 from public.calc_offer_closed x where x.offer_id = o.id)
     and not exists (select 1 from public.sales_order_lines l join public.sales_orders so on so.id = l.order_id
                      where l.calc_offer_id = o.id and so.status <> 'cancelled');
revoke insert, update, delete, truncate, references, trigger on public.offers_waiting from anon, authenticated, service_role;

/** Clients with at least two orders and none open, when their usual gap between orders has nearly passed. */
create view public.clients_reorder_due with (security_invoker = true) as
  with o as (
    select client_id, created_at::date as day,
           created_at::date - lag(created_at::date) over (partition by client_id order by created_at) as gap
      from public.sales_orders where status not in ('draft', 'cancelled')
  ), s as (
    select client_id, count(*) as orders, max(day) as last_order, round(avg(gap))::integer as usual_gap
      from o group by client_id having count(*) >= 2 and avg(gap) >= 14
  )
  select c.id as client_id, c.legal_name as client, s.orders, s.last_order, s.usual_gap, s.last_order + s.usual_gap as expected_on
    from s join public.clients c on c.id = s.client_id
   where s.last_order + s.usual_gap <= current_date + 14
     and s.last_order > current_date - 365
     and not exists (select 1 from public.sales_orders so where so.client_id = s.client_id
                      and so.status in ('unpaid', 'confirmed', 'in_production', 'ready'));
revoke insert, update, delete, truncate, references, trigger on public.clients_reorder_due from anon, authenticated, service_role;

-- ---------------------------------------------------------------- Gmail
alter table public.gmail_connection
  add column chunk_no integer not null default 0,
  add column address_key text;

create or replace function public.mail_public_domain(p_domain text)
returns boolean
language sql immutable set search_path = public
as $$
  select lower(p_domain) in ('gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com',
                             'abv.bg', 'mail.bg', 'gmx.com', 'gmx.de', 'nutrikal.com')
$$;

create or replace function public.client_of_address(p_address text)
returns uuid
language sql stable security definer set search_path = public
as $$
  with known as (
    select c.id, lower(c.billing_email::text) as email from public.clients c where c.billing_email is not null
    union all
    select k.client_id, lower(k.email::text) from public.contacts k where k.email is not null
  )
  select id from known
   where email = lower(p_address)
      or (split_part(email, '@', 2) = lower(split_part(p_address, '@', 2))
          and not public.mail_public_domain(split_part(p_address, '@', 2)))
   order by email = lower(p_address) desc limit 1
$$;

/** What to search for: company domains, and full addresses on public mail services. */
create or replace function public.gmail_job_terms()
returns table (term text)
language sql stable security definer set search_path = public
as $$
  with known as (
    select lower(billing_email::text) as email from public.clients where billing_email is not null
    union select lower(email::text) from public.contacts where email is not null
  )
  select distinct case when public.mail_public_domain(split_part(email, '@', 2)) then email else split_part(email, '@', 2) end
    from known where email like '%@%' and email not like '%@nutrikal.com' order by 1
$$;

drop function public.gmail_job_state();
create function public.gmail_job_state()
returns table (email text, token_enc text, sync_from date, page_token text, chunk_no integer, address_key text)
language sql stable security definer set search_path = public
as $$ select email, token_enc, sync_from, page_token, chunk_no, address_key from public.gmail_connection $$;

/** Where the job stands. A new list of addresses starts again from twelve months back. */
create or replace function public.gmail_job_position(p_chunk integer, p_key text, p_restart boolean)
returns void
language sql security definer set search_path = public
as $$
  update public.gmail_connection
     set chunk_no = p_chunk, address_key = p_key,
         page_token = case when p_restart then null else page_token end,
         sync_from = case when p_restart then (current_date - interval '12 months')::date else sync_from end
$$;

revoke execute on function public.gmail_job_terms() from public, anon, authenticated;
revoke execute on function public.gmail_job_state() from public, anon, authenticated;
revoke execute on function public.gmail_job_position(integer, text, boolean) from public, anon, authenticated;
