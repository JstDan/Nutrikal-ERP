-- =====================================================================
-- Nutri AI on the open catalog (owner, Nov 2026). Visitors write through
-- catalog_chat_turn() and catalog_chat_reply() only; Admin and Sales read
-- the conversations. Chats without an enquiry go after 12 months.
--                     admin   sales   accountant  production/design
-- conversations       read    read    read        —
-- Limits: 30 questions a chat, 40 a visitor a day, 500 a day in all.
-- visitor_key is a daily hash, not an address.
-- =====================================================================

create table public.catalog_chats (
  id           uuid primary key default gen_random_uuid(),
  visitor_key  text not null,
  locale       text not null default 'en',
  enquiry_id   uuid references public.catalog_enquiries (id) on delete set null,
  created_at   timestamptz not null default now(),
  last_at      timestamptz not null default now()
);
create index catalog_chats_last_idx on public.catalog_chats (last_at desc);

create table public.catalog_chat_messages (
  id          bigint generated always as identity primary key,
  chat_id     uuid not null references public.catalog_chats (id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  body        text not null,
  created_at  timestamptz not null default now()
);
create index catalog_chat_messages_chat_idx on public.catalog_chat_messages (chat_id, id);
create index catalog_chat_messages_day_idx on public.catalog_chat_messages (created_at) where role = 'user';

alter table public.catalog_chats enable row level security;
alter table public.catalog_chat_messages enable row level security;
create policy catalog_chats_read on public.catalog_chats for select to authenticated using (public.has_role('admin', 'sales'));
create policy catalog_chat_messages_read on public.catalog_chat_messages for select to authenticated using (public.has_role('admin', 'sales'));
revoke all on public.catalog_chats, public.catalog_chat_messages from anon, authenticated;
grant select on public.catalog_chats, public.catalog_chat_messages to authenticated;

-- A question: checked against the limits, saved, and answered with the conversation so far
create or replace function public.catalog_chat_turn(p_chat uuid, p_visitor text, p_locale text, p_text text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_text text := trim(p_text);
begin
  if coalesce(length(v_text), 0) not between 1 and 1000 or coalesce(length(p_visitor), 0) not between 1 and 128 then
    raise exception 'catalog_invalid';
  end if;
  select id into v_id from catalog_chats where id = p_chat;

  if (select count(*) from catalog_chat_messages where role = 'user' and created_at > now() - interval '1 day') >= 500
     or (select count(*) from catalog_chat_messages m join catalog_chats c on c.id = m.chat_id
          where m.role = 'user' and m.created_at > now() - interval '1 day' and c.visitor_key = p_visitor) >= 40
     or (v_id is not null and (select count(*) from catalog_chat_messages where role = 'user' and chat_id = v_id) >= 30) then
    raise exception 'catalog_chat_limit';
  end if;

  if v_id is null then
    insert into catalog_chats (visitor_key, locale) values (p_visitor, left(coalesce(p_locale, 'en'), 5)) returning id into v_id;
  end if;
  insert into catalog_chat_messages (chat_id, role, body) values (v_id, 'user', v_text);
  update catalog_chats set last_at = now() where id = v_id;

  return jsonb_build_object('chat', v_id, 'history', (
    select coalesce(jsonb_agg(jsonb_build_object('role', x.role, 'content', x.body) order by x.id), '[]')
      from (select id, role, body from catalog_chat_messages where chat_id = v_id order by id desc limit 20) x));
end
$$;

create or replace function public.catalog_chat_reply(p_chat uuid, p_text text)
returns void
language sql security definer set search_path = public
as $$
  insert into catalog_chat_messages (chat_id, role, body)
  select id, 'assistant', left(p_text, 8000) from catalog_chats where id = p_chat;
$$;

-- The enquiry that came out of a conversation
create or replace function public.catalog_chat_link(p_chat uuid, p_number text)
returns void
language sql security definer set search_path = public
as $$
  update catalog_chats c set enquiry_id = e.id
    from catalog_enquiries e
   where c.id = p_chat and c.enquiry_id is null and e.number = p_number;
$$;

create or replace function public.catalog_chat_purge()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_n integer;
begin
  delete from catalog_chats where enquiry_id is null and last_at < now() - interval '12 months';
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke execute on function public.catalog_chat_turn(uuid, text, text, text) from public, authenticated;
revoke execute on function public.catalog_chat_reply(uuid, text) from public, authenticated;
revoke execute on function public.catalog_chat_link(uuid, text) from public, authenticated;
revoke execute on function public.catalog_chat_purge() from public, anon, authenticated;
grant execute on function public.catalog_chat_turn(uuid, text, text, text) to anon;
grant execute on function public.catalog_chat_reply(uuid, text) to anon;
grant execute on function public.catalog_chat_link(uuid, text) to anon;
