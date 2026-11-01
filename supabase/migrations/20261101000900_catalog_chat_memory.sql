-- Nutri AI remembers a visitor's conversation across visits (owner, Nov 2026):
-- the last 40 messages go to the model, and a conversation can hold 100 questions.
-- The limits per visitor and per day stay.

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
     or (v_id is not null and (select count(*) from catalog_chat_messages where role = 'user' and chat_id = v_id) >= 100) then
    raise exception 'catalog_chat_limit';
  end if;

  if v_id is null then
    insert into catalog_chats (visitor_key, locale) values (p_visitor, left(coalesce(p_locale, 'en'), 5)) returning id into v_id;
  end if;
  insert into catalog_chat_messages (chat_id, role, body) values (v_id, 'user', v_text);
  update catalog_chats set last_at = now() where id = v_id;

  return jsonb_build_object('chat', v_id, 'history', (
    select coalesce(jsonb_agg(jsonb_build_object('role', x.role, 'content', x.body) order by x.id), '[]')
      from (select id, role, body from catalog_chat_messages where chat_id = v_id order by id desc limit 40) x));
end
$$;
