-- =====================================================================
-- Chat like Slack (owner, Nov 2026): replies in a thread under a message,
-- and pinned messages of a channel.
--  - A reply belongs to one message of the same channel (one level only);
--    the channel shows the message with the number of replies, the thread
--    shows them all. Replies do not make the channel unread: the people of
--    the thread (who wrote the message or a reply, and who is mentioned)
--    are notified instead.
--  - Anyone who may read a channel pins or unpins its messages.
--  - The rules of who sees a channel do not change (chat_can).
-- =====================================================================

alter table public.chat_messages
  add column parent_id uuid references public.chat_messages (id) on delete cascade,
  add column pinned_at timestamptz,
  add column pinned_by uuid references public.profiles (id) on delete set null;
create index chat_messages_parent_idx on public.chat_messages (parent_id, created_at) where parent_id is not null;

/** A reply stays in the channel of its message, and a reply has no replies of its own. */
create or replace function public.chat_messages_parent_check()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.parent_id is not null and not exists (
       select 1 from public.chat_messages p where p.id = new.parent_id and p.channel_id = new.channel_id and p.parent_id is null) then
    raise exception 'A reply goes under a message of the same channel';
  end if;
  return new;
end
$$;
create trigger chat_messages_parent_check before insert or update of parent_id, channel_id on public.chat_messages
  for each row execute function public.chat_messages_parent_check();

do $$
declare
  v text;
begin
  select pg_get_constraintdef(oid) into v from pg_constraint where conname = 'notifications_kind_check';
  execute 'alter table public.notifications drop constraint notifications_kind_check';
  execute 'alter table public.notifications add constraint notifications_kind_check '
    || replace(v, $q$'chat_mention'::text$q$, $q$'chat_mention'::text, 'chat_reply'::text$q$);
end
$$;

/** A message (p_parent: a reply in its thread) with its mentions; only people of the channel are told. */
drop function public.chat_post(uuid, text, uuid[]);
create function public.chat_post(p_channel uuid, p_body text, p_mentions uuid[] default '{}', p_parent uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id   uuid;
  v_name text;
  v_kind text;
  m      uuid;
  v_link text := '/chat?c=' || p_channel;
begin
  if not coalesce(public.chat_can(p_channel), false) then
    raise exception 'Not allowed in this channel' using errcode = '42501';
  end if;
  insert into public.chat_messages (channel_id, body, mentions, parent_id)
  values (p_channel, btrim(p_body), coalesce(p_mentions, '{}'), p_parent) returning id into v_id;
  select full_name into v_name from public.profiles where id = auth.uid();
  select case when kind = 'direct' then '' else name end into v_kind from public.chat_channels where id = p_channel;
  if p_parent is not null then
    v_link := v_link || '&t=' || p_parent;
  end if;
  foreach m in array coalesce(p_mentions, '{}') loop
    continue when m = auth.uid();
    continue when not exists (select 1 from public.chat_people(p_channel) x where x.id = m);
    insert into public.notifications (user_id, kind, params, link)
    values (m, 'chat_mention', jsonb_build_object('by', v_name, 'channel', v_kind), v_link);
  end loop;
  -- A reply: the others of the thread are told (once per reply; the mentioned ones already were)
  if p_parent is not null then
    insert into public.notifications (user_id, kind, params, link)
    select distinct x.author_id, 'chat_reply', jsonb_build_object('by', v_name, 'channel', v_kind), v_link
      from public.chat_messages x
     where (x.id = p_parent or x.parent_id = p_parent)
       and x.author_id <> auth.uid()
       and not (x.author_id = any (coalesce(p_mentions, '{}')))
       and exists (select 1 from public.chat_people(p_channel) y where y.id = x.author_id);
  end if;
  return v_id;
end
$$;

/** Pins or unpins a message, for everyone of the channel. */
create or replace function public.chat_pin(p_message uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_channel uuid;
begin
  select channel_id into v_channel from public.chat_messages where id = p_message;
  if v_channel is null or not coalesce(public.chat_can(v_channel), false) then
    raise exception 'Not allowed in this channel' using errcode = '42501';
  end if;
  update public.chat_messages
     set pinned_at = case when p_on then coalesce(pinned_at, now()) end,
         pinned_by = case when p_on then coalesce(pinned_by, auth.uid()) end
   where id = p_message;
end
$$;

/** One message as the chat shows it: files, reactions, and for a message its replies. */
drop function public.chat_feed(uuid);
create function public.chat_feed(p_channel uuid, p_thread uuid default null)
returns table (id uuid, author_id uuid, author text, body text, created_at timestamptz, edited_at timestamptz, attachments jsonb, reactions jsonb,
               parent_id uuid, reply_count integer, last_reply_at timestamptz, repliers uuid[], pinned_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select * from (
    select m.id, m.author_id, p.full_name, m.body, m.created_at, m.edited_at,
           coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'mime', a.mime, 'size', a.size_bytes))
                       from public.chat_attachments a where a.message_id = m.id), '[]'::jsonb),
           coalesce((select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'n', r.n, 'mine', r.mine))
                       from (select x.emoji, count(*) as n, bool_or(x.user_id = auth.uid()) as mine
                               from public.chat_reactions x where x.message_id = m.id group by x.emoji) r), '[]'::jsonb),
           m.parent_id,
           (select count(*)::int from public.chat_messages r where r.parent_id = m.id),
           (select max(r.created_at) from public.chat_messages r where r.parent_id = m.id),
           (select array_agg(a.author_id) from (select r.author_id, max(r.created_at) as at from public.chat_messages r
                                                 where r.parent_id = m.id group by r.author_id order by at desc limit 3) a),
           m.pinned_at
      from public.chat_messages m join public.profiles p on p.id = m.author_id
     where coalesce(public.chat_can(p_channel), false) and m.channel_id = p_channel
       and (case when p_thread is null then m.parent_id is null else m.id = p_thread or m.parent_id = p_thread end)
     order by m.created_at desc limit 200
  ) x order by created_at
$$;

/** Unread: the messages of a channel, not the replies in its threads (those notify the people of the thread). */
create or replace function public.chat_unread()
returns table (channel_id uuid, unread bigint)
language sql stable security definer set search_path = public
as $$
  select m.channel_id, count(*)
    from public.chat_messages m
    left join public.chat_reads r on r.channel_id = m.channel_id and r.user_id = auth.uid()
   where public.chat_can(m.channel_id) and m.author_id <> auth.uid() and m.parent_id is null
     and m.created_at > coalesce(r.read_at, '-infinity')
   group by m.channel_id
$$;

/** Found messages; a reply names its thread. */
drop function public.chat_search(text);
create function public.chat_search(p_term text)
returns table (id uuid, channel_id uuid, channel text, author text, body text, created_at timestamptz, thread_id uuid)
language sql stable security definer set search_path = public
as $$
  select m.id, m.channel_id, l.name, p.full_name, m.body, m.created_at, m.parent_id
    from public.chat_messages m
    join public.chat_channel_list() l on l.id = m.channel_id
    join public.profiles p on p.id = m.author_id
   where length(btrim(coalesce(p_term, ''))) >= 2 and m.body ilike '%' || p_term || '%'
   order by m.created_at desc limit 30
$$;

revoke execute on function public.chat_post(uuid, text, uuid[], uuid) from public, anon;
revoke execute on function public.chat_pin(uuid, boolean) from public, anon;
revoke execute on function public.chat_feed(uuid, uuid) from public, anon;
revoke execute on function public.chat_search(text) from public, anon;
revoke execute on function public.chat_messages_parent_check() from public, anon;
grant execute on function public.chat_post(uuid, text, uuid[], uuid) to authenticated;
grant execute on function public.chat_pin(uuid, boolean) to authenticated;
grant execute on function public.chat_feed(uuid, uuid) to authenticated;
grant execute on function public.chat_search(text) to authenticated;
