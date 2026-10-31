-- =====================================================================
-- Owner, Oct 2026:
--  - design uploads files: its transactions are no longer read only, and it
--    has no write rights except client_files
--  - more rights for the bookkeeper: dispatch, invoice numbers, the admin
--    dashboard and the accounting export
--  - client files, on a client and optionally on an order
--  - chat with channels. Not for Production: the channels talk about clients.
-- =====================================================================

create or replace function public.app_session_start()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_app_role() = 'accountant' then
    perform set_config('transaction_read_only', 'on', true);
  end if;
end
$$;

do $$
declare
  f record;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('dispatch_order', 'issue_invoice', 'admin_dashboard', 'admin_production_costs')
  loop
    execute replace(replace(pg_get_functiondef(f.oid),
      $q$require_role('admin')$q$, $q$require_role('admin', 'bookkeeper')$q$),
      $q$has_role('admin')$q$, $q$has_role('admin', 'bookkeeper')$q$);
  end loop;
end
$$;

-- ---------------------------------------------------------------- files
alter table public.client_files
  add column order_id uuid references public.sales_orders (id) on delete set null,
  add column mime text,
  add column size_bytes bigint not null default 0,
  add column note text;
create index client_files_order_idx on public.client_files (order_id);

-- Admin, Sales, Bookkeeper and Design. Production has no access.
drop policy client_files_select on public.client_files;
drop policy client_files_insert on public.client_files;
drop policy client_files_delete on public.client_files;
create policy client_files_select on public.client_files for select to authenticated
  using (public.has_role('admin', 'sales', 'designer'));
create policy client_files_insert on public.client_files for insert to authenticated
  with check (uploaded_by = auth.uid() and public.has_role('admin', 'sales', 'designer'));
create policy client_files_delete on public.client_files for delete to authenticated
  using (public.has_role('admin') or (uploaded_by = auth.uid() and public.has_role('sales', 'designer')));

-- ----------------------------------------------------------------- chat
create or replace function public.chat_member()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.current_app_role() <> 'production', false) $$;

create table public.chat_channels (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique check (btrim(name) <> '' and length(name) <= 60),
  description  text,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create table public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references public.chat_channels (id) on delete cascade,
  author_id   uuid not null default auth.uid() references public.profiles (id),
  body        text not null check (btrim(body) <> '' and length(body) <= 4000),
  created_at  timestamptz not null default now()
);
create index chat_messages_channel_idx on public.chat_messages (channel_id, created_at desc);
create table public.chat_reads (
  channel_id  uuid not null references public.chat_channels (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  read_at     timestamptz not null default now(),
  primary key (channel_id, user_id)
);

alter table public.chat_channels enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads enable row level security;
create policy chat_channels_select on public.chat_channels for select to authenticated using (public.chat_member());
create policy chat_channels_admin on public.chat_channels for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy chat_messages_select on public.chat_messages for select to authenticated using (public.chat_member());
create policy chat_messages_insert on public.chat_messages for insert to authenticated
  with check (author_id = auth.uid() and public.chat_member());
create policy chat_messages_delete on public.chat_messages for delete to authenticated
  using (author_id = auth.uid() or public.has_role('admin'));
create policy chat_reads_own on public.chat_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

/** Messages of a channel with the name of the author; everyone in the chat sees who wrote. */
create or replace function public.chat_feed(p_channel uuid, p_after timestamptz default null)
returns table (id uuid, author_id uuid, author text, body text, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select * from (
    select m.id, m.author_id, p.full_name, m.body, m.created_at
      from public.chat_messages m join public.profiles p on p.id = m.author_id
     where public.chat_member() and m.channel_id = p_channel and (p_after is null or m.created_at > p_after)
     order by m.created_at desc limit 200
  ) x order by created_at
$$;

create or replace function public.chat_unread()
returns table (channel_id uuid, unread bigint)
language sql stable security definer set search_path = public
as $$
  select m.channel_id, count(*)
    from public.chat_messages m
    left join public.chat_reads r on r.channel_id = m.channel_id and r.user_id = auth.uid()
   where public.chat_member() and m.author_id <> auth.uid() and m.created_at > coalesce(r.read_at, '-infinity')
   group by m.channel_id
$$;

revoke execute on function public.chat_feed(uuid, timestamptz) from public, anon;
revoke execute on function public.chat_unread() from public, anon;
grant execute on function public.chat_feed(uuid, timestamptz) to authenticated;
grant execute on function public.chat_unread() to authenticated;

insert into public.chat_channels (name, description) values
  ('общи', 'Всичко за фирмата'),
  ('продажби', 'Клиенти, оферти и поръчки'),
  ('дизайн', 'Етикети и опаковки'),
  ('счетоводство', 'Фактури и плащания');
