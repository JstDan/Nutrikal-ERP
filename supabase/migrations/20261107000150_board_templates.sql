-- =====================================================================
-- Boards from a template (owner, Nov 2026): a new board can start from a
-- ready template (lists, labels, sample cards with checklists; the texts
-- come from the app in the user's language) or as a copy of a board one
-- sees (its open lists, labels, cards and checklists; no comments, files,
-- people or dates).
--
-- p_spec: {"labels": [{"name", "color"}],
--          "lists":  [{"name", "cards": [{"title", "description", "checklist": [text], "labels": [label index]}]}]}
-- =====================================================================

create or replace function public.create_board_from(p_name text, p_color text, p_spec jsonb, p_members uuid[] default '{}')
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_id     uuid := gen_random_uuid();
  v_labels uuid[] := '{}';
  v_list   uuid;
  v_card   uuid;
  l        record;
  c        record;
  i        record;
  x        record;
begin
  if not public.board_staff() then
    raise exception 'Not allowed for role %', coalesce(public.current_app_role()::text, 'anonymous') using errcode = '42501';
  end if;
  -- No RETURNING: the creator becomes a member only after the row is in (and may see it then)
  insert into public.boards (id, name, color) values (v_id, btrim(p_name), coalesce(p_color, 'blue'));

  for x in select e.value, e.ordinality from jsonb_array_elements(coalesce(p_spec -> 'labels', '[]')) with ordinality e loop
    insert into public.board_labels (board_id, name, color)
    values (v_id, left(coalesce(x.value ->> 'name', ''), 40), coalesce(x.value ->> 'color', 'grey')) returning id into v_card;
    v_labels := v_labels || v_card;
  end loop;
  if cardinality(v_labels) = 0 then
    insert into public.board_labels (board_id, color)
    select v_id, c from unnest(array['green', 'yellow', 'orange', 'red', 'purple', 'blue']) c;
  end if;

  for l in select e.value, e.ordinality from jsonb_array_elements(coalesce(p_spec -> 'lists', '[]')) with ordinality e loop
    continue when nullif(btrim(l.value ->> 'name'), '') is null;
    insert into public.board_lists (board_id, name, position) values (v_id, left(btrim(l.value ->> 'name'), 100), l.ordinality)
    returning id into v_list;
    for c in select e.value, e.ordinality from jsonb_array_elements(coalesce(l.value -> 'cards', '[]')) with ordinality e loop
      continue when nullif(btrim(c.value ->> 'title'), '') is null;
      v_card := gen_random_uuid();
      insert into public.board_cards (id, list_id, title, description, position)
      values (v_card, v_list, left(btrim(c.value ->> 'title'), 300), left(coalesce(c.value ->> 'description', ''), 10000), c.ordinality);
      insert into public.board_checklist_items (card_id, text, position)
      select v_card, left(btrim(t.value #>> '{}'), 500), t.ordinality
        from jsonb_array_elements(coalesce(c.value -> 'checklist', '[]')) with ordinality t
       where nullif(btrim(t.value #>> '{}'), '') is not null;
      for i in select (e.value #>> '{}')::int as n from jsonb_array_elements(coalesce(c.value -> 'labels', '[]')) e loop
        if i.n between 1 and cardinality(v_labels) then
          insert into public.board_card_labels (card_id, label_id) values (v_card, v_labels[i.n]) on conflict do nothing;
        end if;
      end loop;
    end loop;
  end loop;

  insert into public.board_members (board_id, user_id)
  select v_id, u from unnest(coalesce(p_members, '{}')) u where u <> auth.uid()
  on conflict do nothing;
  return v_id;
end
$$;
revoke execute on function public.create_board_from(text, text, jsonb, uuid[]) from public, anon;
grant execute on function public.create_board_from(text, text, jsonb, uuid[]) to authenticated;

/** A copy of a board one sees: open lists, labels, cards and their checklists (not done), nothing else. */
create or replace function public.copy_board(p_board uuid, p_name text, p_members uuid[] default '{}')
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_spec  jsonb;
  v_color text;
begin
  select color into v_color from public.boards where id = p_board;
  if not found then
    raise exception 'Board not found';
  end if;
  with lb as (
    select id, row_number() over (order by color, name, id) as n, name, color from public.board_labels where board_id = p_board
  )
  select jsonb_build_object(
    'labels', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'color', color) order by n) from lb), '[]'),
    'lists', coalesce((
      select jsonb_agg(jsonb_build_object('name', l.name, 'cards', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'title', c.title, 'description', c.description,
                 'checklist', coalesce((select jsonb_agg(i.text order by i.position) from public.board_checklist_items i where i.card_id = c.id), '[]'),
                 'labels', coalesce((select jsonb_agg(lb.n) from public.board_card_labels cl join lb on lb.id = cl.label_id where cl.card_id = c.id), '[]'))
               order by c.position)
          from public.board_cards c where c.list_id = l.id and c.archived_at is null), '[]')) order by l.position)
        from public.board_lists l where l.board_id = p_board and l.archived_at is null), '[]'))
    into v_spec;
  return public.create_board_from(p_name, v_color, v_spec, p_members);
end
$$;
revoke execute on function public.copy_board(uuid, text, uuid[]) from public, anon;
grant execute on function public.copy_board(uuid, text, uuid[]) to authenticated;
