-- =====================================================================
-- Gmail, read only (owner, Oct 2026): one shared mailbox, connected once by
-- Admin. Mail to and from known clients is kept; everything else is skipped.
-- Admin and Sales read it. Production has no access. The token of the
-- connection is encrypted by the app and no user can read it.
-- =====================================================================

create table public.gmail_connection (
  id             boolean primary key default true check (id),
  email          text not null,
  token_enc      text not null,
  sync_from      date not null,
  page_token     text,
  last_sync_at   timestamptz,
  last_error     text,
  connected_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  connected_at   timestamptz not null default now()
);
-- No policies: reached only through the functions below
alter table public.gmail_connection enable row level security;

create table public.client_emails (
  id              uuid primary key default gen_random_uuid(),
  gmail_id        text not null unique,
  thread_id       text not null,
  client_id       uuid not null references public.clients (id) on delete cascade,
  direction       text not null check (direction in ('in', 'out')),
  from_address    text not null,
  to_addresses    text,
  subject         text,
  snippet         text,
  body            text,
  has_attachments boolean not null default false,
  sent_at         timestamptz not null
);
create index client_emails_client_idx on public.client_emails (client_id, sent_at desc);
create index client_emails_thread_idx on public.client_emails (thread_id, sent_at desc);

alter table public.client_emails enable row level security;
create policy client_emails_select on public.client_emails for select to authenticated
  using (public.has_role('admin', 'sales'));

/** Threads whose last message came from the client: they wait for an answer. */
create view public.emails_waiting_reply with (security_invoker = true) as
  select e.id, e.thread_id, e.client_id, c.legal_name as client, e.from_address, e.subject, e.snippet, e.sent_at
    from (select distinct on (thread_id) * from public.client_emails order by thread_id, sent_at desc) e
    join public.clients c on c.id = e.client_id
   where e.direction = 'in';
revoke insert, update, delete, truncate, references, trigger on public.emails_waiting_reply from anon, authenticated, service_role;

create or replace function public.gmail_status(out email text, out last_sync_at timestamptz, out last_error text, out messages bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin');
  select g.email, g.last_sync_at, g.last_error into email, last_sync_at, last_error from public.gmail_connection g;
  select count(*) into messages from public.client_emails;
end
$$;

create or replace function public.gmail_connect(p_email text, p_token_enc text, p_months integer default 12)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin');
  insert into public.gmail_connection (email, token_enc, sync_from)
  values (p_email, p_token_enc, (current_date - make_interval(months => p_months))::date)
  on conflict (id) do update set email = excluded.email, token_enc = excluded.token_enc, sync_from = excluded.sync_from,
    page_token = null, last_error = null, connected_by = auth.uid(), connected_at = now();
end
$$;

create or replace function public.gmail_disconnect()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin');
  delete from public.gmail_connection;
end
$$;

/** The client of an address: an exact e-mail of the client or a contact, else the same company domain. */
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
          and lower(split_part(p_address, '@', 2)) not in
            ('gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'abv.bg', 'mail.bg', 'gmx.com', 'gmx.de', 'nutrikal.com'))
   order by email = lower(p_address) desc limit 1
$$;

-- For the sync job only: no signed-in user calls these
create or replace function public.gmail_job_state()
returns table (email text, token_enc text, sync_from date, page_token text)
language sql stable security definer set search_path = public
as $$ select email, token_enc, sync_from, page_token from public.gmail_connection $$;

/** p_mails: [{gmail_id, thread_id, direction, from_address, to_addresses, parties: [address], subject, snippet, body, has_attachments, sent_at}]. */
create or replace function public.gmail_job_save(p_mails jsonb)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  m        jsonb;
  v_client uuid;
  v_n      integer := 0;
begin
  for m in select * from jsonb_array_elements(p_mails) loop
    select public.client_of_address(a) into v_client
      from jsonb_array_elements_text(m -> 'parties') a
     where public.client_of_address(a) is not null limit 1;
    continue when v_client is null;
    insert into public.client_emails (gmail_id, thread_id, client_id, direction, from_address, to_addresses, subject, snippet, body, has_attachments, sent_at)
    values (m ->> 'gmail_id', m ->> 'thread_id', v_client, m ->> 'direction', m ->> 'from_address', m ->> 'to_addresses',
            m ->> 'subject', m ->> 'snippet', m ->> 'body', coalesce((m ->> 'has_attachments')::boolean, false), (m ->> 'sent_at')::timestamptz)
    on conflict (gmail_id) do nothing;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;

create or replace function public.gmail_job_done(p_page_token text, p_sync_from date, p_error text)
returns void
language sql security definer set search_path = public
as $$
  update public.gmail_connection
     set page_token = p_page_token, sync_from = coalesce(p_sync_from, sync_from), last_error = left(p_error, 500),
         last_sync_at = case when p_error is null then now() else last_sync_at end
$$;

revoke execute on function public.gmail_status() from public, anon;
revoke execute on function public.gmail_connect(text, text, integer) from public, anon;
revoke execute on function public.gmail_disconnect() from public, anon;
revoke execute on function public.client_of_address(text) from public, anon, authenticated;
revoke execute on function public.gmail_job_state() from public, anon, authenticated;
revoke execute on function public.gmail_job_save(jsonb) from public, anon, authenticated;
revoke execute on function public.gmail_job_done(text, date, text) from public, anon, authenticated;
grant execute on function public.gmail_status() to authenticated;
grant execute on function public.gmail_connect(text, text, integer) to authenticated;
grant execute on function public.gmail_disconnect() to authenticated;
