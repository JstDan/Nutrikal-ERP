-- The chat, live (owner, Nov 2026: "very much like Slack"): messages arrive at once, who is typing, who is online,
-- voice huddles, saved items, per-channel notification settings and phone notifications for direct messages.
--
-- Live updates go through Supabase Realtime: private broadcast topics, allowed by policies on realtime.messages.
--   chat:<channel>   changes of the channel (a ping; the browser fetches the messages through the app), typing,
--                    huddle presence and the huddle's WebRTC signals; anyone who may read the channel
--   user:<id>        a ping to one person: a new message in one of their channels, a new notification
--   chat-presence    who is online or away; every team account (not clients)
-- The pings carry no message text: what a person sees is still read through the app, as that person.
-- Without Realtime (local development) the helpers below do nothing and the chat polls as before.

-- ------------------------------------------------------------------ live pings
/** Sends a ping on a Realtime topic when Realtime is there; never holds a write up. */
create or replace function public.nk_live(p_topic text, p_event text, p_payload jsonb default '{}')
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    execute 'select realtime.send($1, $2, $3, true)' using p_payload, p_event, p_topic;
  end if;
exception when others then
  null;
end
$$;
revoke execute on function public.nk_live(text, text, jsonb) from public, anon, authenticated;

/** May the signed-in person listen or send on a Realtime topic? */
create or replace function public.chat_topic_ok(p_topic text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when auth.uid() is null or public.current_app_role() is null or public.current_app_role() = 'client' then false
    when p_topic = 'chat-presence' then true
    when p_topic = 'user:' || auth.uid()::text then true
    when p_topic ~ '^chat:[0-9a-fA-F-]{36}$' then coalesce(public.chat_can(substr(p_topic, 6)::uuid), false)
    else false end
$$;
revoke execute on function public.chat_topic_ok(text) from public, anon;
grant execute on function public.chat_topic_ok(text) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists nk_chat_listen on realtime.messages';
    execute 'drop policy if exists nk_chat_send on realtime.messages';
    execute 'create policy nk_chat_listen on realtime.messages for select to authenticated using (public.chat_topic_ok(realtime.topic()))';
    execute 'create policy nk_chat_send on realtime.messages for insert to authenticated with check (public.chat_topic_ok(realtime.topic()) and realtime.topic() <> ''user:'' || auth.uid()::text)';
  end if;
end
$$;

/** The people who see a channel (active team accounts; the writer too). */
create or replace function public.chat_audience(p_channel uuid)
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select p.id from public.profiles p join public.chat_channels c on c.id = p_channel
   where p.is_active and p.role <> 'client'
     and case c.kind
           when 'direct' then exists (select 1 from public.chat_channel_members m where m.channel_id = c.id and m.user_id = p.id)
           when 'external' then true
           else p.role <> 'production' end
$$;
revoke execute on function public.chat_audience(uuid) from public, anon, authenticated;

create or replace function public.chat_live_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r public.chat_messages;
  u uuid;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  perform public.nk_live('chat:' || r.channel_id, 'change', jsonb_build_object('parent', r.parent_id));
  if tg_op = 'INSERT' then
    for u in select public.chat_audience(r.channel_id) loop
      perform public.nk_live('user:' || u, 'chat', jsonb_build_object('channel', r.channel_id));
    end loop;
  end if;
  return null;
end
$$;
create trigger chat_messages_live after insert or update or delete on public.chat_messages
  for each row execute function public.chat_live_message();

/** Reactions and files belong to a message: its channel is told. */
create or replace function public.chat_live_part()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_message uuid;
  v_channel uuid;
  v_parent uuid;
begin
  if tg_op = 'DELETE' then v_message := old.message_id; else v_message := new.message_id; end if;
  select channel_id, parent_id into v_channel, v_parent from public.chat_messages where id = v_message;
  if v_channel is not null then
    perform public.nk_live('chat:' || v_channel, 'change', jsonb_build_object('parent', v_parent));
  end if;
  return null;
end
$$;
create trigger chat_reactions_live after insert or delete on public.chat_reactions
  for each row execute function public.chat_live_part();
create trigger chat_attachments_live after insert or delete on public.chat_attachments
  for each row execute function public.chat_live_part();

/** A new notification: the bell of that person is drawn again at once. */
create or replace function public.notifications_live()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.nk_live('user:' || new.user_id, 'notify', jsonb_build_object('kind', new.kind));
  return null;
end
$$;
create trigger notifications_live after insert on public.notifications
  for each row execute function public.notifications_live();

-- ------------------------------------------------------------------ saved items
create table public.chat_saved (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
alter table public.chat_saved enable row level security;
-- One's own, and only of messages one may still read (production: the partner channels; clients: none)
create policy chat_saved_own on public.chat_saved for all to authenticated
  using (user_id = auth.uid() and public.chat_can((select m.channel_id from public.chat_messages m where m.id = message_id)))
  with check (user_id = auth.uid() and public.chat_can((select m.channel_id from public.chat_messages m where m.id = message_id)));
grant select, insert, delete on public.chat_saved to authenticated;

/** Saves a message for later, or takes it off the list. */
create or replace function public.chat_save(p_message uuid, p_on boolean)
returns void
language plpgsql security invoker set search_path = public
as $$
begin
  if p_on then
    insert into public.chat_saved (message_id) values (p_message) on conflict do nothing;
  else
    delete from public.chat_saved where message_id = p_message and user_id = auth.uid();
  end if;
end
$$;
revoke execute on function public.chat_save(uuid, boolean) from public, anon;
grant execute on function public.chat_save(uuid, boolean) to authenticated;

/** One's saved messages, newest saved first, with their channel. */
create or replace function public.chat_saved_list()
returns table (id uuid, channel_id uuid, channel text, kind text, author_id uuid, author text, body text, created_at timestamptz, parent_id uuid, saved_at timestamptz)
language sql stable security invoker set search_path = public
as $$
  select m.id, m.channel_id, l.name, l.kind::text, m.author_id, coalesce(p.full_name, '?'), m.body, m.created_at, m.parent_id, s.created_at
    from public.chat_saved s
    join public.chat_messages m on m.id = s.message_id
    join public.chat_channel_list() l on l.id = m.channel_id
    left join public.profiles p on p.id = m.author_id
   where s.user_id = auth.uid()
   order by s.created_at desc
   limit 200
$$;
revoke execute on function public.chat_saved_list() from public, anon;
grant execute on function public.chat_saved_list() to authenticated;

-- ------------------------------------------------------------------ notification settings per channel
-- all: every message (the default of direct messages); mentions: mentions and replies to one's threads
-- (the default of channels); none: nothing from the channel.
create table public.chat_prefs (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  channel_id uuid not null references public.chat_channels (id) on delete cascade,
  notify     text not null check (notify in ('all', 'mentions', 'none')),
  primary key (user_id, channel_id)
);
alter table public.chat_prefs enable row level security;
create policy chat_prefs_own on public.chat_prefs for all to authenticated
  using (user_id = auth.uid() and public.chat_can(channel_id))
  with check (user_id = auth.uid() and public.chat_can(channel_id));
grant select, insert, update, delete on public.chat_prefs to authenticated;

create or replace function public.chat_notify_level(p_channel uuid, p_user uuid default auth.uid())
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select notify from public.chat_prefs where user_id = p_user and channel_id = p_channel),
    (select case when kind = 'direct' then 'all' else 'mentions' end from public.chat_channels where id = p_channel))
$$;
revoke execute on function public.chat_notify_level(uuid, uuid) from public, anon, authenticated;

/** One's own setting for a channel (the default when nothing is set). */
create or replace function public.chat_my_notify(p_channel uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select case when public.chat_can(p_channel) then public.chat_notify_level(p_channel, auth.uid()) end
$$;
revoke execute on function public.chat_my_notify(uuid) from public, anon;
grant execute on function public.chat_my_notify(uuid) to authenticated;

create or replace function public.chat_set_notify(p_channel uuid, p_level text)
returns void
language plpgsql security invoker set search_path = public
as $$
begin
  insert into public.chat_prefs (channel_id, notify) values (p_channel, p_level)
  on conflict (user_id, channel_id) do update set notify = excluded.notify;
end
$$;
revoke execute on function public.chat_set_notify(uuid, text) from public, anon;
grant execute on function public.chat_set_notify(uuid, text) to authenticated;

-- ------------------------------------------------------------------ notifications of the chat
do $$
declare
  v text;
begin
  select pg_get_constraintdef(oid) into v from pg_constraint where conname = 'notifications_kind_check';
  execute 'alter table public.notifications drop constraint notifications_kind_check';
  execute 'alter table public.notifications add constraint notifications_kind_check '
    || replace(v, $q$'chat_reply'::text$q$, $q$'chat_reply'::text, 'chat_message'::text, 'chat_huddle'::text$q$);
end
$$;

/**
 * A message (p_parent: a reply in its thread). Who is told follows their setting for the channel:
 * mentioned → chat_mention; in the thread → chat_reply; "all" → chat_message; "none" → nothing.
 * The notification carries the first words of the message for the phone.
 */
create or replace function public.chat_post(p_channel uuid, p_body text, p_mentions uuid[] default '{}', p_parent uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id    uuid;
  v_name  text;
  v_kind  text;
  v_link  text := '/chat?c=' || p_channel;
  v_text  text;
  v_level text;
  v_note  text;
  m       uuid;
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
  v_text := left(regexp_replace(btrim(p_body), '\s+', ' ', 'g'), 160);
  for m in select x.id from public.chat_people(p_channel) x loop
    v_level := public.chat_notify_level(p_channel, m);
    continue when v_level = 'none';
    v_note := case
      when m = any (coalesce(p_mentions, '{}')) then 'chat_mention'
      when p_parent is not null and exists (select 1 from public.chat_messages x
             where (x.id = p_parent or x.parent_id = p_parent) and x.author_id = m and x.id <> v_id) then 'chat_reply'
      when v_level = 'all' then 'chat_message'
    end;
    continue when v_note is null;
    insert into public.notifications (user_id, kind, params, link)
    values (m, v_note, jsonb_build_object('by', v_name, 'channel', v_kind, 'text', v_text), v_link);
  end loop;
  return v_id;
end
$$;

/** Someone started a huddle in a direct conversation: the other person is rung (at most once in two minutes). */
create or replace function public.chat_huddle_ring(p_channel uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name text;
begin
  if not coalesce(public.chat_can(p_channel), false) then
    raise exception 'Not allowed in this channel' using errcode = '42501';
  end if;
  if (select kind from public.chat_channels where id = p_channel) <> 'direct' then
    return;
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.notifications (user_id, kind, params, link)
  select x.id, 'chat_huddle', jsonb_build_object('by', v_name, 'channel', ''), '/chat?c=' || p_channel || '&huddle=1'
    from public.chat_people(p_channel) x
   where public.chat_notify_level(p_channel, x.id) <> 'none'
     and not exists (select 1 from public.notifications n where n.user_id = x.id and n.kind = 'chat_huddle'
                       and n.link like '/chat?c=' || p_channel || '%' and n.created_at > now() - interval '2 minutes');
end
$$;
revoke execute on function public.chat_huddle_ring(uuid) from public, anon;
grant execute on function public.chat_huddle_ring(uuid) to authenticated;

-- ------------------------------------------------------------------ pushes: claimed once, sent within seconds
/**
 * The notifications to push now, marked as pushed in the same step, so the minute job and the push right after a
 * chat message never send one twice. p_min_age: a notification read within that time (the person is looking) is not pushed.
 */
create or replace function public.push_claim(p_min_age interval default '0 seconds')
returns table (notification_id bigint, kind text, params jsonb, link text, locale text, subscription_id uuid, endpoint text, p256dh text, auth text)
language sql volatile security definer set search_path = public
as $$
  with c as (
    update public.notifications n set pushed_at = now()
     where n.id in (select x.id from public.notifications x
                     where x.pushed_at is null and x.read_at is null
                       and x.created_at > now() - interval '2 hours' and x.created_at <= now() - p_min_age
                     order by x.id limit 200 for update skip locked)
    returning n.id, n.user_id, n.kind, n.params, n.link)
  select c.id, c.kind, c.params, c.link, coalesce(p.locale::text, 'bg'), s.id, s.endpoint, s.p256dh, s.auth
    from c
    join public.profiles p on p.id = c.user_id and p.is_active
    join public.push_subscriptions s on s.user_id = c.user_id
$$;
revoke execute on function public.push_claim(interval) from public, anon, authenticated;
