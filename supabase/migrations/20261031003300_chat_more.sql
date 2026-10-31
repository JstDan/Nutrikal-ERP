-- =====================================================================
-- Chat (owner, Oct 2026): direct messages, a channel for the partner,
-- attachments, mentions and reactions.
--  - Production sees only channels of kind external: never the others and no
--    direct messages. What is written there is seen by the partner, so no
--    client names and prices belong in it.
--  - The accountant writes in the chat: outside a read-only transaction
--    has_role() gives the accountant nothing, so only the chat rules below
--    let anything through. All other data stays closed to writing.
-- =====================================================================

alter table public.chat_channels
  add column kind text not null default 'team' check (kind in ('team', 'external', 'direct'));
-- The name of a direct conversation holds two ids
alter table public.chat_channels drop constraint chat_channels_name_check;
alter table public.chat_channels add constraint chat_channels_name_check check (btrim(name) <> '' and length(name) <= 100);
alter table public.chat_messages
  add column edited_at timestamptz,
  add column mentions uuid[] not null default '{}';

create table public.chat_channel_members (
  channel_id  uuid not null references public.chat_channels (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  primary key (channel_id, user_id)
);

create table public.chat_attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references public.chat_messages (id) on delete cascade,
  file_name     text not null,
  storage_path  text not null unique,
  mime          text,
  size_bytes    bigint not null default 0
);
create index chat_attachments_message_idx on public.chat_attachments (message_id);

create table public.chat_reactions (
  message_id  uuid not null references public.chat_messages (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  emoji       text not null check (length(emoji) between 1 and 32),
  primary key (message_id, user_id, emoji)
);

/** Who may be in a channel. Written once: every rule below asks this. */
create or replace function public.chat_can(p_channel uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case c.kind
           when 'direct' then exists (select 1 from public.chat_channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
           when 'external' then public.current_app_role() is not null
           else coalesce(public.current_app_role() <> 'production', false) end
    from public.chat_channels c where c.id = p_channel
$$;
revoke execute on function public.chat_can(uuid) from public, anon;
grant execute on function public.chat_can(uuid) to authenticated;

drop policy chat_channels_select on public.chat_channels;
drop policy chat_messages_select on public.chat_messages;
drop policy chat_messages_insert on public.chat_messages;
create policy chat_channels_select on public.chat_channels for select to authenticated using (public.chat_can(id));
create policy chat_messages_select on public.chat_messages for select to authenticated using (public.chat_can(channel_id));
create policy chat_messages_insert on public.chat_messages for insert to authenticated
  with check (author_id = auth.uid() and public.chat_can(channel_id));
create policy chat_messages_update on public.chat_messages for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

alter table public.chat_channel_members enable row level security;
alter table public.chat_attachments enable row level security;
alter table public.chat_reactions enable row level security;
create policy chat_channel_members_select on public.chat_channel_members for select to authenticated using (public.chat_can(channel_id));
create policy chat_attachments_select on public.chat_attachments for select to authenticated
  using (exists (select 1 from public.chat_messages m where m.id = message_id and public.chat_can(m.channel_id)));
create policy chat_attachments_insert on public.chat_attachments for insert to authenticated
  with check (exists (select 1 from public.chat_messages m where m.id = message_id and m.author_id = auth.uid()));
create policy chat_reactions_select on public.chat_reactions for select to authenticated
  using (exists (select 1 from public.chat_messages m where m.id = message_id and public.chat_can(m.channel_id)));
create policy chat_reactions_insert on public.chat_reactions for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.chat_messages m where m.id = message_id and public.chat_can(m.channel_id)));
create policy chat_reactions_delete on public.chat_reactions for delete to authenticated using (user_id = auth.uid());

do $$
declare
  v text;
begin
  select pg_get_constraintdef(oid) into v from pg_constraint where conname = 'notifications_kind_check';
  execute 'alter table public.notifications drop constraint notifications_kind_check';
  execute 'alter table public.notifications add constraint notifications_kind_check '
    || replace(v, $q$'materials_short'::text$q$, $q$'materials_short'::text, 'chat_mention'::text$q$);
end
$$;

/** The people one can write to or mention. In a partner channel the partner too. */
create or replace function public.chat_people(p_channel uuid default null)
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name from public.profiles p
   where p.is_active and p.role <> 'developer' and p.id <> auth.uid()
     and public.current_app_role() is not null
     and (public.current_app_role() <> 'production' or p_channel is not null)
     and (p.role <> 'production' or (select kind from public.chat_channels where id = p_channel) = 'external')
     and (p_channel is null or public.chat_can(p_channel))
     and ((select kind from public.chat_channels where id = p_channel) is distinct from 'direct'
          or exists (select 1 from public.chat_channel_members m where m.channel_id = p_channel and m.user_id = p.id))
   order by lower(p.full_name)
$$;

/** The direct conversation with a person: found or started. Not with the partner. */
create or replace function public.chat_open_direct(p_user uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_me  uuid := auth.uid();
  v_key text;
  v_id  uuid;
begin
  if public.current_app_role() is null or public.current_app_role() = 'production'
     or (select role from public.profiles where id = p_user and is_active) is not distinct from null
     or (select role from public.profiles where id = p_user) = 'production' or p_user = v_me then
    raise exception 'Not allowed for this person' using errcode = '42501';
  end if;
  v_key := 'direct:' || least(v_me::text, p_user::text) || ':' || greatest(v_me::text, p_user::text);
  select id into v_id from public.chat_channels where name = v_key;
  if v_id is null then
    insert into public.chat_channels (name, kind) values (v_key, 'direct') returning id into v_id;
    insert into public.chat_channel_members (channel_id, user_id) values (v_id, v_me), (v_id, p_user);
  end if;
  return v_id;
end
$$;

/** A message with its mentions: only people of the channel are told. */
create or replace function public.chat_post(p_channel uuid, p_body text, p_mentions uuid[] default '{}')
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id   uuid;
  v_name text;
  v_kind text;
  m      uuid;
begin
  if not coalesce(public.chat_can(p_channel), false) then
    raise exception 'Not allowed in this channel' using errcode = '42501';
  end if;
  insert into public.chat_messages (channel_id, body, mentions) values (p_channel, btrim(p_body), coalesce(p_mentions, '{}')) returning id into v_id;
  select full_name into v_name from public.profiles where id = auth.uid();
  select case when kind = 'direct' then '' else name end into v_kind from public.chat_channels where id = p_channel;
  foreach m in array coalesce(p_mentions, '{}') loop
    continue when m = auth.uid();
    continue when not exists (select 1 from public.chat_people(p_channel) x where x.id = m);
    insert into public.notifications (user_id, kind, params, link)
    values (m, 'chat_mention', jsonb_build_object('by', v_name, 'channel', v_kind), '/chat?c=' || p_channel);
  end loop;
  return v_id;
end
$$;

drop function public.chat_feed(uuid, timestamptz);
create function public.chat_feed(p_channel uuid)
returns table (id uuid, author_id uuid, author text, body text, created_at timestamptz, edited_at timestamptz, attachments jsonb, reactions jsonb)
language sql stable security definer set search_path = public
as $$
  select * from (
    select m.id, m.author_id, p.full_name, m.body, m.created_at, m.edited_at,
           coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'mime', a.mime, 'size', a.size_bytes))
                       from public.chat_attachments a where a.message_id = m.id), '[]'::jsonb),
           coalesce((select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'n', r.n, 'mine', r.mine))
                       from (select x.emoji, count(*) as n, bool_or(x.user_id = auth.uid()) as mine
                               from public.chat_reactions x where x.message_id = m.id group by x.emoji) r), '[]'::jsonb)
      from public.chat_messages m join public.profiles p on p.id = m.author_id
     where coalesce(public.chat_can(p_channel), false) and m.channel_id = p_channel
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
   where public.chat_can(m.channel_id) and m.author_id <> auth.uid() and m.created_at > coalesce(r.read_at, '-infinity')
   group by m.channel_id
$$;

/** The channels of this person. A direct conversation shows the other person's name. */
create or replace function public.chat_channel_list()
returns table (id uuid, name text, description text, kind text, unread bigint)
language sql stable security definer set search_path = public
as $$
  select c.id,
         case when c.kind = 'direct'
              then (select p.full_name from public.chat_channel_members x join public.profiles p on p.id = x.user_id
                     where x.channel_id = c.id and x.user_id <> auth.uid() limit 1)
              else c.name end,
         c.description, c.kind, coalesce(u.unread, 0)
    from public.chat_channels c left join public.chat_unread() u on u.channel_id = c.id
   where public.chat_can(c.id)
   order by c.kind = 'direct', c.created_at
$$;

create or replace function public.chat_search(p_term text)
returns table (id uuid, channel_id uuid, channel text, author text, body text, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select m.id, m.channel_id, l.name, p.full_name, m.body, m.created_at
    from public.chat_messages m
    join public.chat_channel_list() l on l.id = m.channel_id
    join public.profiles p on p.id = m.author_id
   where length(btrim(coalesce(p_term, ''))) >= 2 and m.body ilike '%' || p_term || '%'
   order by m.created_at desc limit 30
$$;

revoke execute on function public.chat_people(uuid) from public, anon;
revoke execute on function public.chat_open_direct(uuid) from public, anon;
revoke execute on function public.chat_post(uuid, text, uuid[]) from public, anon;
revoke execute on function public.chat_feed(uuid) from public, anon;
revoke execute on function public.chat_channel_list() from public, anon;
revoke execute on function public.chat_search(text) from public, anon;
grant execute on function public.chat_people(uuid) to authenticated;
grant execute on function public.chat_open_direct(uuid) to authenticated;
grant execute on function public.chat_post(uuid, text, uuid[]) to authenticated;
grant execute on function public.chat_feed(uuid) to authenticated;
grant execute on function public.chat_channel_list() to authenticated;
grant execute on function public.chat_search(text) to authenticated;

insert into public.chat_channels (name, description, kind)
values ('партньор', 'С производството. Партньорът вижда всичко тук: без имена на клиенти и цени.', 'external');
