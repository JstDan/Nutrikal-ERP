-- =====================================================================
-- Nutrikal ERP + CRM — Boards (like Trello) for planning the team's own
-- work (owner, Nov 2026). Not tied to an order: anyone of the team makes
-- a personal board or one for a team and invites people.
--
-- Boards > lists > cards. A card has a title, description, people
-- (assignees), labels, a due date, done, a checklist, comments with
-- @mentions, files and optionally a link to a client, a project or an
-- order. Cards and lists are archived (restored later) or deleted.
--
-- Access (owner, Nov 2026):
--   - a board is seen by its members and by Admin (the accountant reads
--     what Admin reads, in read-only transactions, so changes nothing);
--   - members change everything on it (Admin too);
--   - members are the Nutrikal team only: admin, sales, bookkeeper,
--     designer. Production and client accounts have no access to any
--     table of the boards (cards talk about clients and prices).
-- Positions are fractions (a card dropped between two others takes the
-- middle), so a move changes one row.
-- =====================================================================

-- Who may use boards at all
create or replace function public.board_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_role('admin', 'sales', 'designer')
$$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.boards (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (btrim(name) <> '' and length(name) <= 100),
  color        text not null default 'blue' check (color in ('blue', 'green', 'orange', 'purple', 'red', 'teal', 'grey')),
  created_by   uuid not null default auth.uid() references public.profiles (id),
  created_at   timestamptz not null default now(),
  archived_at  timestamptz
);

create table public.board_members (
  board_id  uuid not null references public.boards (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  added_by  uuid default auth.uid() references public.profiles (id),
  added_at  timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index board_members_user_idx on public.board_members (user_id);

create table public.board_lists (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.boards (id) on delete cascade,
  name         text not null check (btrim(name) <> '' and length(name) <= 100),
  position     double precision not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index board_lists_board_idx on public.board_lists (board_id, position);

create table public.board_labels (
  id        uuid primary key default gen_random_uuid(),
  board_id  uuid not null references public.boards (id) on delete cascade,
  name      text not null default '' check (length(name) <= 40),
  color     text not null check (color in ('green', 'yellow', 'orange', 'red', 'purple', 'blue', 'teal', 'grey'))
);
create index board_labels_board_idx on public.board_labels (board_id);

create table public.board_cards (
  id               uuid primary key default gen_random_uuid(),
  board_id         uuid not null references public.boards (id) on delete cascade,
  list_id          uuid not null references public.board_lists (id) on delete cascade,
  title            text not null check (btrim(title) <> '' and length(title) <= 300),
  description      text not null default '' check (length(description) <= 10000),
  position         double precision not null default 0,
  due_on           date,
  done_at          timestamptz,
  done_by          uuid references public.profiles (id),
  archived_at      timestamptz,
  client_id        uuid references public.clients (id) on delete set null,
  project_id       uuid references public.projects (id) on delete set null,
  sales_order_id   uuid references public.sales_orders (id) on delete set null,
  due_notified_on  date,                                   -- the due date the reminder went out for
  created_by       uuid not null default auth.uid() references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index board_cards_list_idx on public.board_cards (list_id, position);
create index board_cards_board_idx on public.board_cards (board_id);
create index board_cards_due_idx on public.board_cards (due_on) where done_at is null and archived_at is null;
create trigger board_cards_updated_at before update on public.board_cards
  for each row execute function public.set_updated_at();

-- People on a card (assignees)
create table public.board_card_members (
  card_id  uuid not null references public.board_cards (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (card_id, user_id)
);
create index board_card_members_user_idx on public.board_card_members (user_id);

create table public.board_card_labels (
  card_id   uuid not null references public.board_cards (id) on delete cascade,
  label_id  uuid not null references public.board_labels (id) on delete cascade,
  primary key (card_id, label_id)
);

create table public.board_checklist_items (
  id        uuid primary key default gen_random_uuid(),
  card_id   uuid not null references public.board_cards (id) on delete cascade,
  text      text not null check (btrim(text) <> '' and length(text) <= 500),
  done      boolean not null default false,
  done_by   uuid references public.profiles (id),
  done_at   timestamptz,
  position  double precision not null default 0
);
create index board_checklist_items_card_idx on public.board_checklist_items (card_id, position);

create table public.board_comments (
  id          uuid primary key default gen_random_uuid(),
  card_id     uuid not null references public.board_cards (id) on delete cascade,
  author_id   uuid not null default auth.uid() references public.profiles (id),
  body        text not null check (btrim(body) <> '' and length(body) <= 5000),
  mentions    uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);
create index board_comments_card_idx on public.board_comments (card_id, created_at);

-- Bucket board-files: {board_id}/{card_id}/{uuid}-{name}
create table public.board_files (
  id            uuid primary key default gen_random_uuid(),
  card_id       uuid not null references public.board_cards (id) on delete cascade,
  storage_path  text not null unique,
  name          text not null check (btrim(name) <> '' and length(name) <= 200),
  size          bigint not null check (size > 0 and size <= 26214400),
  mime          text,
  uploaded_by   uuid not null default auth.uid() references public.profiles (id),
  created_at    timestamptz not null default now()
);
create index board_files_card_idx on public.board_files (card_id, created_at);

create or replace function public.can_see_board(p_board uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.board_staff() and (
    public.has_role('admin')
    or exists (select 1 from public.board_members m where m.board_id = p_board and m.user_id = auth.uid()))
$$;

create or replace function public.can_edit_board(p_board uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.board_staff() and (
    public.has_role('admin')
    or exists (select 1 from public.board_members m where m.board_id = p_board and m.user_id = auth.uid()))
$$;

-- The board of a card (for the policies of the card's parts)
create or replace function public.board_of_card(p_card uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select board_id from public.board_cards where id = p_card
$$;

-- ---------------------------------------------------------------------
-- Rules kept by triggers
-- ---------------------------------------------------------------------
-- Members are the team: active admin, sales, bookkeeper or designer accounts;
-- a board keeps at least one member
create or replace function public.board_members_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.profiles where id = new.user_id and is_active
                     and role in ('admin', 'sales', 'bookkeeper', 'designer')) then
      raise exception 'Only the Nutrikal team can be members of a board';
    end if;
    return new;
  end if;
  if exists (select 1 from public.boards where id = old.board_id)
     and not exists (select 1 from public.board_members where board_id = old.board_id and user_id <> old.user_id) then
    raise exception 'A board keeps at least one member';
  end if;
  -- Someone who leaves a board leaves its cards too
  delete from public.board_card_members cm using public.board_cards c
   where cm.card_id = c.id and c.board_id = old.board_id and cm.user_id = old.user_id;
  return old;
end
$$;
create trigger board_members_guard before insert or delete on public.board_members
  for each row execute function public.board_members_guard();

-- The creator is the first member
create or replace function public.boards_first_member()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.board_members (board_id, user_id, added_by) values (new.id, new.created_by, new.created_by)
  on conflict do nothing;
  return new;
end
$$;
create trigger boards_first_member after insert on public.boards
  for each row execute function public.boards_first_member();

create or replace function public.boards_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end
$$;
create trigger boards_guard before insert or update on public.boards
  for each row execute function public.boards_guard();

-- A card belongs to the board of its list (moving to a list of another board moves it there);
-- done records who and when; the creator never changes
create or replace function public.board_cards_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  select board_id into new.board_id from public.board_lists where id = new.list_id;
  if new.board_id is null then
    raise exception 'List not found';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.done_by := case when new.done_at is not null then auth.uid() end;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if new.done_at is null then
      new.done_by := null;
    elsif old.done_at is null then
      new.done_by := auth.uid();
    else
      new.done_at := old.done_at;
      new.done_by := old.done_by;
    end if;
    -- A new due date is reminded again; only the reminder job marks one as sent
    if new.due_on is distinct from old.due_on then
      new.due_notified_on := null;
    elsif current_setting('nk.board_due_job', true) is distinct from 'on' then
      new.due_notified_on := old.due_notified_on;
    end if;
  end if;
  return new;
end
$$;
create trigger board_cards_guard before insert or update on public.board_cards
  for each row execute function public.board_cards_guard();

-- Moved to another board: labels of the old board go, people who are not members there go
create or replace function public.board_cards_moved()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.board_id <> old.board_id then
    delete from public.board_card_labels where card_id = new.id;
    delete from public.board_card_members cm where cm.card_id = new.id
       and not exists (select 1 from public.board_members m where m.board_id = new.board_id and m.user_id = cm.user_id);
  end if;
  return new;
end
$$;
create trigger board_cards_moved after update on public.board_cards
  for each row execute function public.board_cards_moved();

-- Card people are members of the board; tell them they were added
create or replace function public.board_card_members_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  c public.board_cards;
begin
  select * into c from public.board_cards where id = new.card_id;
  if not exists (select 1 from public.board_members where board_id = c.board_id and user_id = new.user_id) then
    raise exception 'Only members of the board can be added to its cards';
  end if;
  if new.user_id is distinct from auth.uid() then
    insert into public.notifications (user_id, kind, params, link)
    values (new.user_id, 'board_assigned',
            jsonb_build_object('by', (select full_name from public.profiles where id = auth.uid()),
                               'card', c.title, 'board', (select name from public.boards where id = c.board_id)),
            '/boards/' || c.board_id || '?card=' || c.id);
  end if;
  return new;
end
$$;
create trigger board_card_members_guard before insert on public.board_card_members
  for each row execute function public.board_card_members_guard();

create or replace function public.board_card_labels_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.board_labels l join public.board_cards c on c.board_id = l.board_id
                  where l.id = new.label_id and c.id = new.card_id) then
    raise exception 'The label belongs to another board';
  end if;
  return new;
end
$$;
create trigger board_card_labels_guard before insert or update on public.board_card_labels
  for each row execute function public.board_card_labels_guard();

create or replace function public.board_checklist_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.card_id := old.card_id;
    if new.done is distinct from old.done then
      new.done_by := case when new.done then auth.uid() end;
      new.done_at := case when new.done then now() end;
    else
      new.done_by := old.done_by;
      new.done_at := old.done_at;
    end if;
  else
    new.done_by := case when new.done then auth.uid() end;
    new.done_at := case when new.done then now() end;
  end if;
  return new;
end
$$;
create trigger board_checklist_guard before insert or update on public.board_checklist_items
  for each row execute function public.board_checklist_guard();

-- Comments: the author writes as themself; only the text changes on edit.
-- Mentioned members are told; the card's people are told of a new comment.
create or replace function public.board_comments_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.created_at := now();
    new.edited_at := null;
    new.mentions := coalesce(array(
      select distinct u from unnest(new.mentions) u
       where exists (select 1 from public.board_members m join public.board_cards c on c.board_id = m.board_id
                      where c.id = new.card_id and m.user_id = u)
         and u <> auth.uid()), '{}');
  else
    new.id := old.id; new.card_id := old.card_id; new.author_id := old.author_id;
    new.created_at := old.created_at; new.mentions := old.mentions;
    new.edited_at := case when new.body <> old.body then now() else old.edited_at end;
  end if;
  return new;
end
$$;
create trigger board_comments_guard before insert or update on public.board_comments
  for each row execute function public.board_comments_guard();

create or replace function public.board_comments_notify()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  c      public.board_cards;
  v_by   text := (select full_name from public.profiles where id = new.author_id);
  v_link text;
  v_p    jsonb;
begin
  select * into c from public.board_cards where id = new.card_id;
  v_link := '/boards/' || c.board_id || '?card=' || c.id;
  v_p := jsonb_build_object('by', v_by, 'card', c.title, 'board', (select name from public.boards where id = c.board_id));
  insert into public.notifications (user_id, kind, params, link)
  select u, 'board_mention', v_p, v_link from unnest(new.mentions) u;
  insert into public.notifications (user_id, kind, params, link)
  select cm.user_id, 'board_comment', v_p, v_link
    from public.board_card_members cm
   where cm.card_id = c.id and cm.user_id <> new.author_id and not (cm.user_id = any (new.mentions));
  return new;
end
$$;
create trigger board_comments_notify after insert on public.board_comments
  for each row execute function public.board_comments_notify();

create or replace function public.board_files_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_board uuid := public.board_of_card(new.card_id);
begin
  new.uploaded_by := auth.uid();
  new.created_at := now();
  if split_part(new.storage_path, '/', 1) <> v_board::text or split_part(new.storage_path, '/', 2) <> new.card_id::text then
    raise exception 'Invalid file path';
  end if;
  return new;
end
$$;
create trigger board_files_guard before insert on public.board_files
  for each row execute function public.board_files_guard();

revoke execute on function public.board_members_guard(), public.boards_first_member(), public.boards_guard(),
  public.board_cards_guard(), public.board_cards_moved(), public.board_card_members_guard(), public.board_card_labels_guard(),
  public.board_checklist_guard(), public.board_comments_guard(), public.board_comments_notify(), public.board_files_guard()
  from public, anon, authenticated;
revoke execute on function public.board_staff(), public.can_see_board(uuid), public.can_edit_board(uuid), public.board_of_card(uuid)
  from public, anon;
grant execute on function public.board_staff(), public.can_see_board(uuid), public.can_edit_board(uuid), public.board_of_card(uuid)
  to authenticated;

-- ---------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------
alter table public.boards                 enable row level security;
alter table public.board_members          enable row level security;
alter table public.board_lists            enable row level security;
alter table public.board_labels           enable row level security;
alter table public.board_cards            enable row level security;
alter table public.board_card_members     enable row level security;
alter table public.board_card_labels      enable row level security;
alter table public.board_checklist_items  enable row level security;
alter table public.board_comments         enable row level security;
alter table public.board_files            enable row level security;

create policy boards_select on public.boards for select to authenticated using (public.can_see_board(id));
create policy boards_insert on public.boards for insert to authenticated with check (public.board_staff());
create policy boards_update on public.boards for update to authenticated
  using (public.can_edit_board(id)) with check (public.can_edit_board(id));
-- Deleting a board for good: its creator or Admin
create policy boards_delete on public.boards for delete to authenticated
  using (public.can_edit_board(id) and (created_by = auth.uid() or public.has_role('admin')));

create policy board_members_select on public.board_members for select to authenticated using (public.can_see_board(board_id));
create policy board_members_insert on public.board_members for insert to authenticated with check (public.can_edit_board(board_id));
create policy board_members_delete on public.board_members for delete to authenticated using (public.can_edit_board(board_id));

create policy board_lists_select on public.board_lists for select to authenticated using (public.can_see_board(board_id));
create policy board_lists_write on public.board_lists for all to authenticated
  using (public.can_edit_board(board_id)) with check (public.can_edit_board(board_id));

create policy board_labels_select on public.board_labels for select to authenticated using (public.can_see_board(board_id));
create policy board_labels_write on public.board_labels for all to authenticated
  using (public.can_edit_board(board_id)) with check (public.can_edit_board(board_id));

create policy board_cards_select on public.board_cards for select to authenticated using (public.can_see_board(board_id));
create policy board_cards_write on public.board_cards for all to authenticated
  using (public.can_edit_board(board_id)) with check (public.can_edit_board(board_id));

create policy board_card_members_select on public.board_card_members for select to authenticated
  using (public.can_see_board(public.board_of_card(card_id)));
create policy board_card_members_write on public.board_card_members for all to authenticated
  using (public.can_edit_board(public.board_of_card(card_id))) with check (public.can_edit_board(public.board_of_card(card_id)));

create policy board_card_labels_select on public.board_card_labels for select to authenticated
  using (public.can_see_board(public.board_of_card(card_id)));
create policy board_card_labels_write on public.board_card_labels for all to authenticated
  using (public.can_edit_board(public.board_of_card(card_id))) with check (public.can_edit_board(public.board_of_card(card_id)));

create policy board_checklist_items_select on public.board_checklist_items for select to authenticated
  using (public.can_see_board(public.board_of_card(card_id)));
create policy board_checklist_items_write on public.board_checklist_items for all to authenticated
  using (public.can_edit_board(public.board_of_card(card_id))) with check (public.can_edit_board(public.board_of_card(card_id)));

create policy board_comments_select on public.board_comments for select to authenticated
  using (public.can_see_board(public.board_of_card(card_id)));
create policy board_comments_insert on public.board_comments for insert to authenticated
  with check (public.can_edit_board(public.board_of_card(card_id)));
create policy board_comments_update on public.board_comments for update to authenticated
  using (author_id = auth.uid() and public.can_edit_board(public.board_of_card(card_id)))
  with check (author_id = auth.uid());
create policy board_comments_delete on public.board_comments for delete to authenticated
  using (public.can_edit_board(public.board_of_card(card_id)) and (author_id = auth.uid() or public.has_role('admin')));

create policy board_files_select on public.board_files for select to authenticated
  using (public.can_see_board(public.board_of_card(card_id)));
create policy board_files_insert on public.board_files for insert to authenticated
  with check (public.can_edit_board(public.board_of_card(card_id)));
create policy board_files_delete on public.board_files for delete to authenticated
  using (public.can_edit_board(public.board_of_card(card_id)) and (uploaded_by = auth.uid() or public.has_role('admin')));

revoke all on public.boards, public.board_members, public.board_lists, public.board_labels, public.board_cards,
              public.board_card_members, public.board_card_labels, public.board_checklist_items,
              public.board_comments, public.board_files
  from anon, authenticated;
grant select, insert, update, delete on public.boards, public.board_lists, public.board_labels, public.board_cards,
              public.board_card_labels, public.board_checklist_items, public.board_comments
  to authenticated;
grant select, insert, delete on public.board_members, public.board_card_members, public.board_files to authenticated;

-- ---------------------------------------------------------------------
-- A new board: its lists and the six coloured labels, in one step
-- ---------------------------------------------------------------------
create or replace function public.create_board(p_name text, p_color text, p_lists text[], p_members uuid[] default '{}')
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_id uuid;
  n    integer := 0;
  l    text;
begin
  if not public.board_staff() then
    raise exception 'Not allowed for role %', coalesce(public.current_app_role()::text, 'anonymous') using errcode = '42501';
  end if;
  -- No RETURNING: the creator becomes a member only after the row is in (and may see it then)
  v_id := gen_random_uuid();
  insert into public.boards (id, name, color) values (v_id, btrim(p_name), coalesce(p_color, 'blue'));
  foreach l in array coalesce(p_lists, '{}') loop
    if nullif(btrim(l), '') is not null then
      n := n + 1;
      insert into public.board_lists (board_id, name, position) values (v_id, btrim(l), n);
    end if;
  end loop;
  insert into public.board_labels (board_id, color)
  select v_id, c from unnest(array['green', 'yellow', 'orange', 'red', 'purple', 'blue']) c;
  insert into public.board_members (board_id, user_id)
  select v_id, u from unnest(coalesce(p_members, '{}')) u where u <> auth.uid()
  on conflict do nothing;
  return v_id;
end
$$;
revoke execute on function public.create_board(text, text, text[], uuid[]) from public, anon;
grant execute on function public.create_board(text, text, text[], uuid[]) to authenticated;

-- The team that can be invited to a board (names only)
create or replace function public.board_people()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name from public.profiles p
   where public.board_staff() and p.is_active and p.role in ('admin', 'sales', 'bookkeeper', 'designer')
   order by p.full_name
$$;
revoke execute on function public.board_people() from public, anon;
grant execute on function public.board_people() to authenticated;

-- ---------------------------------------------------------------------
-- Notifications: added to a card, mentioned, a comment, due soon
-- ---------------------------------------------------------------------
do $$
declare
  v text;
begin
  select pg_get_constraintdef(oid) into v from pg_constraint where conname = 'notifications_kind_check';
  execute 'alter table public.notifications drop constraint notifications_kind_check';
  execute 'alter table public.notifications add constraint notifications_kind_check '
    || replace(v, $q$'client_message'::text$q$,
               $q$'client_message'::text, 'board_assigned'::text, 'board_mention'::text, 'board_comment'::text, 'board_due'::text$q$);
end
$$;

-- Hourly job: the people of a card due today or tomorrow (Sofia time) are told once per due date;
-- a card without people tells its creator
create or replace function public.board_due_notify()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/Sofia')::date;
  v_n     integer;
begin
  with due as (
    select c.* from public.board_cards c join public.boards b on b.id = c.board_id
     where c.due_on is not null and c.due_on <= v_today + 1
       and c.done_at is null and c.archived_at is null and b.archived_at is null
       and c.due_notified_on is distinct from c.due_on
       and not exists (select 1 from public.board_lists l where l.id = c.list_id and l.archived_at is not null)
  ), sent as (
    insert into public.notifications (user_id, kind, params, link)
    select coalesce(cm.user_id, d.created_by), 'board_due',
           jsonb_build_object('card', d.title, 'board', (select name from public.boards where id = d.board_id), 'due', d.due_on,
                              'overdue', d.due_on < v_today),
           '/boards/' || d.board_id || '?card=' || d.id
      from due d left join public.board_card_members cm on cm.card_id = d.id
     where exists (select 1 from public.profiles p where p.id = coalesce(cm.user_id, d.created_by) and p.is_active)
    returning 1
  )
  select count(*) into v_n from sent;
  perform set_config('nk.board_due_job', 'on', true);
  update public.board_cards c set due_notified_on = c.due_on
   where c.due_on is not null and c.due_on <= v_today + 1 and c.done_at is null and c.archived_at is null
     and c.due_notified_on is distinct from c.due_on;
  perform set_config('nk.board_due_job', 'off', true);
  return v_n;
end
$$;
revoke execute on function public.board_due_notify() from public, anon, authenticated;
