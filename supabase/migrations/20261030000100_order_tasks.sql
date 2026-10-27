-- =====================================================================
-- Nutrikal ERP + CRM — Order Task Manager (replaces ClickUp), part 1:
-- schema, access and the task functions.
--
-- Every paid sales order gets one board of tasks by stage (columns in
-- process order). The board is made from a template when admin confirms
-- the first payment (part 2); automatic tasks tick themselves from ERP
-- events (part 3). No deadlines anywhere: the only timestamps are the
-- inherent ones (messages, files, the activity log).
--
-- Access (owner, Oct 2026): admin and sales only. Production has no
-- access to any table, view, function or file of the task manager (it
-- would show client names and commercial steps). Tables are read by
-- staff; every change goes through the functions below, which log it.
-- Templates are written by admin directly (row-level security).
--
--                          admin   sales   production
-- read boards / tasks       yes     yes     —
-- tasks, checklist, chat    yes     yes     —
-- tick an automatic task    yes¹    —       —        ¹ by hand, with a reason
-- columns of a board        yes     yes     —
-- … saved to the template   yes     —       —
-- templates                 yes     read    —
-- =====================================================================

create type public.order_task_status as enum ('todo', 'in_progress', 'waiting', 'done');

-- Rules of the automatic tasks (what ticks them: part 3)
create or replace function public.order_task_rules()
returns text[]
language sql immutable set search_path = public
as $$
  select array['payment_first', 'invoice_advance', 'payment_final', 'invoice_final', 'invoice_full',
               'recipes_approved', 'materials_available', 'shortfall_delivered', 'materials_reserved',
               'packaging_reserved', 'sent_to_production', 'in_production', 'consumption_reported',
               'qc_released', 'coa_ready']
$$;

-- ---------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------
create table public.order_task_templates (
  id          uuid primary key default gen_random_uuid(),
  name_bg     text not null check (btrim(name_bg) <> ''),
  name_en     text,
  is_default  boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index order_task_templates_one_default on public.order_task_templates (is_default) where is_default;

create table public.order_task_template_columns (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.order_task_templates (id) on delete cascade,
  system_key   text check (system_key in ('payments', 'formula', 'design', 'materials', 'production', 'dispatch')),
  name_bg      text not null check (btrim(name_bg) <> ''),
  name_en      text,
  color        text check (color in ('grey', 'blue', 'purple', 'orange', 'teal')),
  position     integer not null default 0,
  hidden       boolean not null default false,
  unique (template_id, system_key)
);
create index order_task_template_columns_idx on public.order_task_template_columns (template_id, position);

create table public.order_task_template_items (
  id                 uuid primary key default gen_random_uuid(),
  template_id        uuid not null references public.order_task_templates (id) on delete cascade,
  column_id          uuid not null references public.order_task_template_columns (id) on delete cascade,
  key                text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  title_bg           text not null check (btrim(title_bg) <> ''),
  title_en           text,
  auto_rule          text check (auto_rule = any (public.order_task_rules())),
  prefill_rule       text check (prefill_rule in ('recipe_unchanged')),   -- a manual task ticked once at the start
  default_checklist  jsonb not null default '[]' check (jsonb_typeof(default_checklist) = 'array'),  -- [{"bg": "…", "en": "…"}]
  depends_on         text[] not null default '{}',                         -- keys of items of the same template
  condition          text check (condition in ('payment:split', 'payment:full', 'service:free_sale', 'service:label_design')),
  position           integer not null default 0,
  unique (template_id, key),
  check (auto_rule is null or prefill_rule is null)
);
create index order_task_template_items_idx on public.order_task_template_items (column_id, position);

create trigger order_task_templates_updated_at before update on public.order_task_templates
  for each row execute function public.set_updated_at();
select public.enable_audit('public.order_task_templates');
select public.enable_audit('public.order_task_template_columns');
select public.enable_audit('public.order_task_template_items');

-- One default template; system columns keep their key and are never deleted;
-- an item belongs to a column of its own template
create or replace function public.order_task_templates_default()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.is_default then
    update public.order_task_templates set is_default = false where id <> new.id and is_default;
    new.active := true;
  end if;
  return new;
end
$$;
create trigger order_task_templates_default before insert or update of is_default on public.order_task_templates
  for each row execute function public.order_task_templates_default();

create or replace function public.order_task_template_columns_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.system_key is not null and exists (select 1 from public.order_task_templates where id = old.template_id) then
      raise exception 'System columns cannot be deleted; hide them instead';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.system_key is distinct from old.system_key or new.template_id <> old.template_id) then
    raise exception 'The stage of a system column cannot be changed';
  end if;
  return new;
end
$$;
create trigger order_task_template_columns_guard before update or delete on public.order_task_template_columns
  for each row execute function public.order_task_template_columns_guard();

create or replace function public.order_task_template_items_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.order_task_template_columns where id = new.column_id and template_id = new.template_id) then
    raise exception 'The column belongs to another template';
  end if;
  return new;
end
$$;
create trigger order_task_template_items_guard before insert or update on public.order_task_template_items
  for each row execute function public.order_task_template_items_guard();

-- ---------------------------------------------------------------------
-- Boards: one per sales order
-- ---------------------------------------------------------------------
create table public.order_task_boards (
  id              uuid primary key default gen_random_uuid(),
  sales_order_id  uuid not null unique references public.sales_orders (id) on delete cascade,
  template_id     uuid references public.order_task_templates (id) on delete set null,
  payment_mode    text not null check (payment_mode in ('split', 'full')),   -- advance + balance, or 100% at once
  created_by      uuid default auth.uid() references public.profiles (id),
  created_at      timestamptz not null default now()
);

create table public.order_task_columns (
  id                  uuid primary key default gen_random_uuid(),
  board_id            uuid not null references public.order_task_boards (id) on delete cascade,
  template_column_id  uuid references public.order_task_template_columns (id) on delete set null,
  system_key          text check (system_key in ('payments', 'formula', 'design', 'materials', 'production', 'dispatch')),
  name_bg             text not null check (btrim(name_bg) <> ''),
  name_en             text,
  color               text check (color in ('grey', 'blue', 'purple', 'orange', 'teal')),
  position            integer not null default 0,
  hidden              boolean not null default false,
  created_by          uuid default auth.uid() references public.profiles (id),
  created_at          timestamptz not null default now(),
  unique (board_id, system_key)
);
create index order_task_columns_board_idx on public.order_task_columns (board_id, position);

create table public.order_tasks (
  id               uuid primary key default gen_random_uuid(),
  board_id         uuid not null references public.order_task_boards (id) on delete cascade,
  column_id        uuid not null references public.order_task_columns (id),
  template_key     text,                                   -- the template item it came from
  title            text not null check (btrim(title) <> '' and length(title) <= 300),
  title_en         text,                                   -- English title (template tasks); falls back to title
  description      text not null default '' check (length(description) <= 10000),
  kind             text not null default 'manual' check (kind in ('auto', 'manual')),
  auto_rule        text check (auto_rule = any (public.order_task_rules())),
  prefill_rule     text check (prefill_rule in ('recipe_unchanged')),
  status           public.order_task_status not null default 'todo',
  assignee_id      uuid references public.profiles (id),
  position         integer not null default 0,
  note             jsonb,                                  -- short state of an automatic task: {"key": …, …params}
  completed_at     timestamptz,
  completed_by     uuid references public.profiles (id),
  override         boolean not null default false,         -- admin ticked an automatic task by hand
  override_reason  text,
  created_by       uuid default auth.uid() references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((kind = 'auto') = (auto_rule is not null)),
  check (not override or (kind = 'auto' and nullif(btrim(override_reason), '') is not null)),
  check ((status = 'done') = (completed_at is not null))
);
create index order_tasks_board_idx  on public.order_tasks (board_id);
create index order_tasks_column_idx on public.order_tasks (column_id, position);
create index order_tasks_assignee_idx on public.order_tasks (assignee_id) where status <> 'done';
create trigger order_tasks_updated_at before update on public.order_tasks
  for each row execute function public.set_updated_at();

create table public.order_task_checklist_items (
  id        uuid primary key default gen_random_uuid(),
  task_id   uuid not null references public.order_tasks (id) on delete cascade,
  text      text not null check (btrim(text) <> '' and length(text) <= 500),
  text_en   text,
  done      boolean not null default false,
  done_by   uuid references public.profiles (id),
  done_at   timestamptz,
  position  integer not null default 0
);
create index order_task_checklist_items_task_idx on public.order_task_checklist_items (task_id, position);

-- "This task waits for that one"
create table public.order_task_dependencies (
  task_id             uuid not null references public.order_tasks (id) on delete cascade,
  depends_on_task_id  uuid not null references public.order_tasks (id) on delete cascade,
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);
create index order_task_dependencies_on_idx on public.order_task_dependencies (depends_on_task_id);

-- Links to ERP records (shown as chips)
create table public.order_task_links (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.order_tasks (id) on delete cascade,
  entity_type  text not null check (entity_type in (
                 'sales_order', 'manufacturing_order', 'formula_version', 'purchase_request',
                 'expected_delivery', 'lot', 'invoice')),
  entity_id    uuid not null,
  label        text not null,                             -- code at the time of linking, e.g. MO-00012
  is_auto      boolean not null default false,            -- added by the automatic rules
  created_by   uuid default auth.uid() references public.profiles (id),
  created_at   timestamptz not null default now(),
  unique (task_id, entity_type, entity_id)
);

-- Raw-material availability snapshots of an order (part 3 writes them)
create table public.order_task_material_checks (
  id               bigint generated always as identity primary key,
  board_id         uuid not null references public.order_task_boards (id) on delete cascade,
  checked_at       timestamptz not null default now(),
  source           text not null,                         -- manual, board_created, reservation, stock, delivery, qc, order
  cause_order_id   uuid references public.sales_orders (id) on delete set null,
  recipe_versions  jsonb not null default '[]',           -- [{"id", "code", "version"}]
  lines            jsonb not null default '[]',           -- per material: required, free, incoming, status …
  total            integer not null default 0,
  ok               integer not null default 0
);
create index order_task_material_checks_board_idx on public.order_task_material_checks (board_id, id desc);

create table public.order_task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.order_tasks (id) on delete cascade,
  author_id   uuid not null references public.profiles (id),
  body        text not null default '' check (length(body) <= 5000),
  mentions    uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles (id)
);
create index order_task_comments_task_idx on public.order_task_comments (task_id, created_at);

create table public.order_task_files (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.order_tasks (id) on delete cascade,
  comment_id    uuid references public.order_task_comments (id) on delete set null,
  storage_path  text not null unique,                     -- bucket order-task-files: {order_id}/{task_id}/{uuid}-{name}
  name          text not null check (btrim(name) <> '' and length(name) <= 200),
  size          bigint not null check (size > 0 and size <= 26214400),
  mime          text,
  uploaded_by   uuid not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles (id)
);
create index order_task_files_task_idx on public.order_task_files (task_id, created_at);

-- When each user last opened a task (unread messages)
create table public.order_task_reads (
  task_id       uuid not null references public.order_tasks (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (task_id, user_id)
);

create table public.order_task_activity (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references public.order_tasks (id) on delete cascade,
  actor_id    uuid references public.profiles (id),       -- null: the system (an automatic rule)
  action      text not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index order_task_activity_task_idx on public.order_task_activity (task_id, id);

-- ---------------------------------------------------------------------
-- Access: staff read; production nothing; changes through the functions
-- ---------------------------------------------------------------------
alter table public.order_task_templates         enable row level security;
alter table public.order_task_template_columns  enable row level security;
alter table public.order_task_template_items    enable row level security;
alter table public.order_task_boards            enable row level security;
alter table public.order_task_columns           enable row level security;
alter table public.order_tasks                  enable row level security;
alter table public.order_task_checklist_items   enable row level security;
alter table public.order_task_dependencies      enable row level security;
alter table public.order_task_links             enable row level security;
alter table public.order_task_material_checks   enable row level security;
alter table public.order_task_comments          enable row level security;
alter table public.order_task_files             enable row level security;
alter table public.order_task_reads             enable row level security;
alter table public.order_task_activity          enable row level security;

create policy order_task_templates_select on public.order_task_templates for select to authenticated using (public.is_staff());
create policy order_task_templates_admin on public.order_task_templates for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy order_task_template_columns_select on public.order_task_template_columns for select to authenticated using (public.is_staff());
create policy order_task_template_columns_admin on public.order_task_template_columns for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy order_task_template_items_select on public.order_task_template_items for select to authenticated using (public.is_staff());
create policy order_task_template_items_admin on public.order_task_template_items for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy order_task_boards_select          on public.order_task_boards          for select to authenticated using (public.is_staff());
create policy order_task_columns_select         on public.order_task_columns         for select to authenticated using (public.is_staff());
create policy order_tasks_select                on public.order_tasks                for select to authenticated using (public.is_staff());
create policy order_task_checklist_items_select on public.order_task_checklist_items for select to authenticated using (public.is_staff());
create policy order_task_dependencies_select    on public.order_task_dependencies    for select to authenticated using (public.is_staff());
create policy order_task_links_select           on public.order_task_links           for select to authenticated using (public.is_staff());
create policy order_task_material_checks_select on public.order_task_material_checks for select to authenticated using (public.is_staff());
create policy order_task_comments_select        on public.order_task_comments        for select to authenticated using (public.is_staff());
create policy order_task_files_select           on public.order_task_files           for select to authenticated using (public.is_staff());
create policy order_task_activity_select        on public.order_task_activity        for select to authenticated using (public.is_staff());
create policy order_task_reads_select           on public.order_task_reads           for select to authenticated
  using (public.is_staff() and user_id = auth.uid());

revoke all on public.order_task_boards, public.order_task_columns, public.order_tasks, public.order_task_checklist_items,
              public.order_task_dependencies, public.order_task_links, public.order_task_material_checks,
              public.order_task_comments, public.order_task_files, public.order_task_reads, public.order_task_activity
  from anon, authenticated;
grant select on public.order_task_boards, public.order_task_columns, public.order_tasks, public.order_task_checklist_items,
               public.order_task_dependencies, public.order_task_links, public.order_task_material_checks,
               public.order_task_comments, public.order_task_files, public.order_task_reads, public.order_task_activity
  to authenticated;
revoke all on public.order_task_templates, public.order_task_template_columns, public.order_task_template_items from anon;
revoke truncate, references, trigger on public.order_task_templates, public.order_task_template_columns, public.order_task_template_items
  from authenticated;

-- Mentions and materials warnings go through the notifications module
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'stock_corrected', 'delivery_received', 'mo_completed', 'mo_sent', 'delivery_ordered',
  'task_mention', 'materials_short'));

-- ---------------------------------------------------------------------
-- Internal helpers (not callable by users)
-- ---------------------------------------------------------------------
create or replace function public.order_task_log(p_task uuid, p_action text, p_payload jsonb default '{}', p_system boolean default false)
returns void
language sql security definer set search_path = public
as $$
  insert into public.order_task_activity (task_id, actor_id, action, payload)
  values (p_task, case when p_system then null else auth.uid() end, p_action, coalesce(p_payload, '{}'))
$$;

-- The task, locked; refused to everyone but staff
create or replace function public.order_task_for_change(p_task uuid)
returns public.order_tasks
language plpgsql security definer set search_path = public
as $$
declare
  t public.order_tasks;
begin
  perform public.require_role('admin', 'sales');
  select * into t from public.order_tasks where id = p_task for update;
  if not found then
    raise exception 'Task not found';
  end if;
  return t;
end
$$;

-- Unfinished tasks this one waits for (titles), empty when it is not blocked
create or replace function public.order_task_blockers(p_task uuid)
returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(t.title order by c.position, t.position), '{}')
    from public.order_task_dependencies d
    join public.order_tasks t on t.id = d.depends_on_task_id
    join public.order_task_columns c on c.id = t.column_id
   where d.task_id = p_task and t.status <> 'done'
$$;

-- Tasks of a column renumbered 1..n, the given task at p_position (manual order)
create or replace function public.order_task_renumber(p_column uuid, p_task uuid default null, p_position integer default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  with ordered as (
    select id, row_number() over (order by position, created_at) as n
      from public.order_tasks where column_id = p_column and id is distinct from p_task
  ), placed as (
    select id, case when p_task is not null and n >= greatest(coalesce(p_position, n + 1), 1) then n + 1 else n end as n
      from ordered
    union all
    select p_task, least(greatest(coalesce(p_position, 2147483646), 1),
                         (select count(*) + 1 from ordered))
     where p_task is not null
  )
  update public.order_tasks t set position = placed.n from placed where t.id = placed.id and t.position is distinct from placed.n;
end
$$;

revoke execute on function public.order_task_log(uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.order_task_for_change(uuid) from public, anon, authenticated;
revoke execute on function public.order_task_blockers(uuid) from public, anon, authenticated;
revoke execute on function public.order_task_renumber(uuid, uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------
/** A manual task at the end of a column (title only; the rest in the task panel). */
create or replace function public.add_order_task(p_column uuid, p_title text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  c     public.order_task_columns;
  v_id  uuid;
begin
  perform public.require_role('admin', 'sales');
  select * into c from public.order_task_columns where id = p_column;
  if not found then
    raise exception 'Column not found';
  end if;
  if nullif(btrim(p_title), '') is null then
    raise exception 'Enter the title of the task';
  end if;
  insert into public.order_tasks (board_id, column_id, title, kind, position)
  values (c.board_id, c.id, btrim(p_title), 'manual',
          coalesce((select max(position) from public.order_tasks where column_id = c.id), 0) + 1)
  returning id into v_id;
  perform public.order_task_log(v_id, 'created', jsonb_build_object('column', c.name_bg));
  return v_id;
end
$$;

/** Title (manual tasks), description and assignee (an active admin or sales user, or none). */
create or replace function public.save_order_task(p_task uuid, p_title text, p_description text, p_assignee uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t public.order_tasks := public.order_task_for_change(p_task);
begin
  if p_assignee is not null and not exists (
       select 1 from public.profiles where id = p_assignee and is_active and role in ('admin', 'sales')) then
    raise exception 'Tasks are assigned to admin or sales users only';
  end if;
  if t.kind = 'manual' and nullif(btrim(p_title), '') is null then
    raise exception 'Enter the title of the task';
  end if;
  update public.order_tasks
     set title = case when kind = 'manual' then btrim(p_title) else title end,
         title_en = case when kind = 'manual' and btrim(p_title) <> title then null else title_en end,
         description = coalesce(p_description, ''), assignee_id = p_assignee
   where id = p_task;
  if t.kind = 'manual' and btrim(p_title) <> t.title then
    perform public.order_task_log(p_task, 'renamed', jsonb_build_object('from', t.title, 'to', btrim(p_title)));
  end if;
  if p_assignee is distinct from t.assignee_id then
    perform public.order_task_log(p_task, 'assigned', jsonb_build_object(
      'to', (select full_name from public.profiles where id = p_assignee)));
  end if;
  if coalesce(p_description, '') <> t.description then
    perform public.order_task_log(p_task, 'described');
  end if;
end
$$;

/** Status of a manual task. Done only once nothing it waits for is open. */
create or replace function public.set_order_task_status(p_task uuid, p_status public.order_task_status)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t         public.order_tasks := public.order_task_for_change(p_task);
  v_blocked text[];
begin
  if t.kind = 'auto' then
    raise exception 'This task ticks itself; admin can mark it by hand with a reason';
  end if;
  if p_status is null or p_status = t.status then
    return;
  end if;
  if p_status = 'done' then
    v_blocked := public.order_task_blockers(p_task);
    if cardinality(v_blocked) > 0 then
      raise exception 'Blocked: waiting for %', array_to_string(v_blocked, ', ');
    end if;
  end if;
  update public.order_tasks
     set status = p_status,
         completed_at = case when p_status = 'done' then now() end,
         completed_by = case when p_status = 'done' then auth.uid() end
   where id = p_task;
  perform public.order_task_log(p_task, 'status', jsonb_build_object('from', t.status, 'to', p_status));
end
$$;

/** Moves a manual task to a column of the same board, at a place (1 = top). */
create or replace function public.move_order_task(p_task uuid, p_column uuid, p_position integer default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t  public.order_tasks := public.order_task_for_change(p_task);
  c  public.order_task_columns;
begin
  if t.kind = 'auto' then
    raise exception 'Automatic tasks stay in their column';
  end if;
  select * into c from public.order_task_columns where id = p_column and board_id = t.board_id;
  if not found then
    raise exception 'The column is not on this board';
  end if;
  if c.id <> t.column_id then
    update public.order_tasks set column_id = c.id where id = p_task;
    perform public.order_task_renumber(t.column_id);
    perform public.order_task_log(p_task, 'moved', jsonb_build_object(
      'from', (select name_bg from public.order_task_columns where id = t.column_id), 'to', c.name_bg));
  end if;
  perform public.order_task_renumber(c.id, p_task, p_position);
end
$$;

/** Deletes a manual task (admin, or the user who added it). */
create or replace function public.delete_order_task(p_task uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t public.order_tasks := public.order_task_for_change(p_task);
begin
  if t.kind = 'auto' or t.template_key is not null then
    raise exception 'Tasks of the template cannot be deleted';
  end if;
  if not public.has_role('admin') and t.created_by is distinct from auth.uid() then
    raise exception 'Only admin or the user who added the task can delete it' using errcode = '42501';
  end if;
  if exists (select 1 from public.order_task_files where task_id = p_task and deleted_at is null) then
    raise exception 'Delete the files of the task first';
  end if;
  delete from public.order_tasks where id = p_task;
  perform public.order_task_renumber(t.column_id);
end
$$;

/** Admin ticks or unticks an automatic task by hand (reason required); the rules then leave it alone. */
create or replace function public.override_order_task(p_task uuid, p_done boolean, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t public.order_tasks := public.order_task_for_change(p_task);
begin
  perform public.require_role('admin');
  if t.kind <> 'auto' then
    raise exception 'Only automatic tasks are marked by hand; change the status instead';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Enter the reason for marking the task by hand';
  end if;
  update public.order_tasks
     set override = true, override_reason = btrim(p_reason),
         status = case when p_done then 'done' else 'todo' end::public.order_task_status,
         completed_at = case when p_done then coalesce(completed_at, now()) end,
         completed_by = case when p_done then coalesce(completed_by, auth.uid()) end
   where id = p_task;
  perform public.order_task_log(p_task, 'override', jsonb_build_object('done', p_done, 'reason', btrim(p_reason)));
end
$$;

-- ---------------------------------------------------------------------
-- Checklist
-- ---------------------------------------------------------------------
create or replace function public.add_order_task_checklist_item(p_task uuid, p_text text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  t    public.order_tasks := public.order_task_for_change(p_task);
  v_id uuid;
begin
  if nullif(btrim(p_text), '') is null then
    raise exception 'Enter the text of the item';
  end if;
  insert into public.order_task_checklist_items (task_id, text, position)
  values (t.id, btrim(p_text), coalesce((select max(position) from public.order_task_checklist_items where task_id = t.id), 0) + 1)
  returning id into v_id;
  return v_id;
end
$$;

/** Ticks, renames (p_text not null) or moves (p_position: 1 = first) a checklist item. */
create or replace function public.update_order_task_checklist_item(
  p_item uuid, p_done boolean default null, p_text text default null, p_position integer default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  i public.order_task_checklist_items;
begin
  perform public.require_role('admin', 'sales');
  select * into i from public.order_task_checklist_items where id = p_item for update;
  if not found then
    raise exception 'Checklist item not found';
  end if;
  if p_text is not null and nullif(btrim(p_text), '') is null then
    raise exception 'Enter the text of the item';
  end if;
  update public.order_task_checklist_items
     set done = coalesce(p_done, done),
         done_by = case when p_done is null then done_by when p_done then auth.uid() end,
         done_at = case when p_done is null then done_at when p_done then now() end,
         text = coalesce(btrim(p_text), text),
         text_en = case when p_text is not null and btrim(p_text) <> text then null else text_en end
   where id = p_item;
  if p_position is not null then
    with ordered as (
      select id, row_number() over (order by position, id) as n
        from public.order_task_checklist_items where task_id = i.task_id and id <> p_item
    ), placed as (
      select id, case when n >= greatest(p_position, 1) then n + 1 else n end as n from ordered
      union all
      select p_item, least(greatest(p_position, 1), (select count(*) + 1 from ordered))
    )
    update public.order_task_checklist_items c set position = placed.n from placed where c.id = placed.id;
  end if;
end
$$;

create or replace function public.delete_order_task_checklist_item(p_item uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  delete from public.order_task_checklist_items where id = p_item;
  if not found then
    raise exception 'Checklist item not found';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Dependencies and links
-- ---------------------------------------------------------------------
/** "p_task waits for p_on" (p_add) or removes it. Same board; no circles. */
create or replace function public.set_order_task_dependency(p_task uuid, p_on uuid, p_add boolean default true)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t   public.order_tasks := public.order_task_for_change(p_task);
  o   public.order_tasks;
begin
  select * into o from public.order_tasks where id = p_on;
  if not found or o.board_id <> t.board_id then
    raise exception 'Both tasks must be on the same board';
  end if;
  if not p_add then
    delete from public.order_task_dependencies where task_id = p_task and depends_on_task_id = p_on;
    if found then
      perform public.order_task_log(p_task, 'dependency_removed', jsonb_build_object('task', o.title));
    end if;
    return;
  end if;
  if p_task = p_on then
    raise exception 'A task cannot wait for itself';
  end if;
  -- p_on must not (indirectly) wait for p_task
  if exists (
    with recursive chain(id) as (
      select depends_on_task_id from public.order_task_dependencies where task_id = p_on
      union
      select d.depends_on_task_id from public.order_task_dependencies d join chain on d.task_id = chain.id
    ) select 1 from chain where id = p_task
  ) then
    raise exception 'This would make the tasks wait for each other';
  end if;
  insert into public.order_task_dependencies (task_id, depends_on_task_id) values (p_task, p_on) on conflict do nothing;
  if found then
    perform public.order_task_log(p_task, 'dependency_added', jsonb_build_object('task', o.title));
  end if;
end
$$;

-- Code of an ERP record for a link chip, or null when it does not exist
create or replace function public.order_task_entity_label(p_type text, p_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select case p_type
    when 'sales_order'         then (select code from public.sales_orders where id = p_id)
    when 'manufacturing_order' then (select code from public.manufacturing_orders where id = p_id)
    when 'formula_version'     then (select f.code || ' v' || v.version from public.formula_versions v
                                       join public.formulas f on f.id = v.formula_id where v.id = p_id)
    when 'purchase_request'    then (select code from public.purchase_requests where id = p_id)
    when 'expected_delivery'   then (select code from public.expected_deliveries where id = p_id)
    when 'lot'                 then (select lot_number from public.lots where id = p_id)
    when 'invoice'             then (select coalesce(number, 'draft') from public.invoices where id = p_id)
  end
$$;
revoke execute on function public.order_task_entity_label(text, uuid) from public, anon, authenticated;

create or replace function public.add_order_task_link(p_task uuid, p_type text, p_entity uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  t       public.order_tasks := public.order_task_for_change(p_task);
  v_label text := public.order_task_entity_label(p_type, p_entity);
  v_id    uuid;
begin
  if v_label is null then
    raise exception 'Record not found';
  end if;
  insert into public.order_task_links (task_id, entity_type, entity_id, label)
  values (t.id, p_type, p_entity, v_label)
  on conflict (task_id, entity_type, entity_id) do update set label = excluded.label
  returning id into v_id;
  perform public.order_task_log(t.id, 'linked', jsonb_build_object('label', v_label));
  return v_id;
end
$$;

create or replace function public.remove_order_task_link(p_link uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  l public.order_task_links;
begin
  perform public.require_role('admin', 'sales');
  delete from public.order_task_links where id = p_link returning * into l;
  if l.id is null then
    raise exception 'Link not found';
  end if;
  perform public.order_task_log(l.task_id, 'unlinked', jsonb_build_object('label', l.label));
end
$$;

-- ---------------------------------------------------------------------
-- Chat, files, read state
-- ---------------------------------------------------------------------
/** A message; mentioned admin / sales users get a notification. */
create or replace function public.post_order_task_comment(p_task uuid, p_body text, p_mentions uuid[] default '{}')
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  t        public.order_tasks;
  v_id     uuid;
  v_order  public.sales_orders;
  v_ment   uuid[];
begin
  perform public.require_role('admin', 'sales');
  select * into t from public.order_tasks where id = p_task;
  if not found then
    raise exception 'Task not found';
  end if;
  select coalesce(array_agg(p.id), '{}') into v_ment
    from public.profiles p
   where p.id = any (coalesce(p_mentions, '{}')) and p.is_active and p.role in ('admin', 'sales') and p.id <> auth.uid();
  insert into public.order_task_comments (task_id, author_id, body, mentions)
  values (p_task, auth.uid(), btrim(coalesce(p_body, '')), v_ment)
  returning id into v_id;

  select so.* into v_order from public.sales_orders so join public.order_task_boards b on b.sales_order_id = so.id
   where b.id = t.board_id;
  insert into public.notifications (user_id, kind, params, link)
  select m, 'task_mention',
         jsonb_build_object('order', v_order.code, 'task', t.title, 'task_en', coalesce(t.title_en, t.title),
                            'by', (select full_name from public.profiles where id = auth.uid())),
         '/orders/' || v_order.id || '?task=' || t.id
    from unnest(v_ment) m;

  insert into public.order_task_reads (task_id, user_id, last_read_at) values (p_task, auth.uid(), now())
  on conflict (task_id, user_id) do update set last_read_at = now();
  return v_id;
end
$$;

/** The author edits their own message. */
create or replace function public.edit_order_task_comment(p_comment uuid, p_body text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  if nullif(btrim(p_body), '') is null then
    raise exception 'The message is empty';
  end if;
  update public.order_task_comments set body = btrim(p_body), edited_at = now()
   where id = p_comment and author_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'Only your own messages can be edited' using errcode = '42501';
  end if;
end
$$;

/** Soft delete: the author, or admin for any message. The text is removed. */
create or replace function public.delete_order_task_comment(p_comment uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  update public.order_task_comments set body = '', deleted_at = now(), deleted_by = auth.uid()
   where id = p_comment and deleted_at is null and (author_id = auth.uid() or public.has_role('admin'));
  if not found then
    raise exception 'Only your own messages can be deleted' using errcode = '42501';
  end if;
end
$$;

-- Files: what the bucket accepts
create or replace function public.order_task_file_allowed(p_name text)
returns boolean
language sql immutable set search_path = public
as $$
  select lower(substring(p_name from '\.([A-Za-z0-9]+)$')) = any (array[
    'pdf', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'ai', 'psd', 'eps', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'zip'])
$$;

-- Storage path {order_id}/{task_id}/{uuid}-{name}: may the signed-in user use it?
create or replace function public.can_access_order_task_path(p_name text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_staff() and exists (
    select 1 from public.order_tasks t join public.order_task_boards b on b.id = t.board_id
     where split_part(p_name, '/', 1) ~* '^[0-9a-f-]{36}$' and split_part(p_name, '/', 2) ~* '^[0-9a-f-]{36}$'
       and b.sales_order_id = split_part(p_name, '/', 1)::uuid and t.id = split_part(p_name, '/', 2)::uuid)
$$;

/** Records an uploaded file (the app uploads it to the bucket at p_path first). */
create or replace function public.add_order_task_file(
  p_task uuid, p_path text, p_name text, p_size bigint, p_mime text, p_comment uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.require_role('admin', 'sales');
  if not public.can_access_order_task_path(p_path) or split_part(p_path, '/', 2) <> p_task::text
     or split_part(p_path, '/', 3) !~* '^[0-9a-f-]{36}-.+' then
    raise exception 'Invalid file path';
  end if;
  if not public.order_task_file_allowed(p_name) then
    raise exception 'This type of file is not allowed';
  end if;
  if p_size is null or p_size <= 0 or p_size > 26214400 then
    raise exception 'A file can be up to 25 MB';
  end if;
  if p_comment is not null and not exists (
       select 1 from public.order_task_comments where id = p_comment and task_id = p_task and author_id = auth.uid()) then
    raise exception 'Message not found';
  end if;
  insert into public.order_task_files (task_id, comment_id, storage_path, name, size, mime, uploaded_by)
  values (p_task, p_comment, p_path, btrim(p_name), p_size, p_mime, auth.uid())
  returning id into v_id;
  perform public.order_task_log(p_task, 'file_added', jsonb_build_object('name', btrim(p_name)));
  return v_id;
end
$$;

/** Removes a file (own; admin any). Returns the storage path to delete from the bucket. */
create or replace function public.delete_order_task_file(p_file uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  f public.order_task_files;
begin
  perform public.require_role('admin', 'sales');
  update public.order_task_files set deleted_at = now(), deleted_by = auth.uid()
   where id = p_file and deleted_at is null and (uploaded_by = auth.uid() or public.has_role('admin'))
  returning * into f;
  if f.id is null then
    raise exception 'Only your own files can be deleted' using errcode = '42501';
  end if;
  perform public.order_task_log(f.task_id, 'file_removed', jsonb_build_object('name', f.name));
  return f.storage_path;
end
$$;

create or replace function public.mark_order_task_read(p_task uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  if not exists (select 1 from public.order_tasks where id = p_task) then
    raise exception 'Task not found';
  end if;
  insert into public.order_task_reads (task_id, user_id, last_read_at) values (p_task, auth.uid(), now())
  on conflict (task_id, user_id) do update set last_read_at = now();
end
$$;

-- ---------------------------------------------------------------------
-- Columns of a board ("this order only", or also saved to the template: admin)
-- ---------------------------------------------------------------------
/** A custom column, inserted before p_before (default: before Documents & dispatch). */
create or replace function public.add_order_task_column(
  p_board uuid, p_name_bg text, p_name_en text default null, p_color text default 'grey',
  p_before uuid default null, p_to_template boolean default false)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  b        public.order_task_boards;
  v_before public.order_task_columns;
  v_pos    integer;
  v_tpos   integer;
  v_tcol   uuid;
  v_id     uuid;
begin
  perform public.require_role('admin', 'sales');
  if p_to_template then
    perform public.require_role('admin');
  end if;
  select * into b from public.order_task_boards where id = p_board;
  if not found then
    raise exception 'Board not found';
  end if;
  if nullif(btrim(p_name_bg), '') is null then
    raise exception 'Enter the name of the column';
  end if;
  perform 1 from public.order_task_columns where board_id = p_board for update;
  if p_before is not null then
    select * into v_before from public.order_task_columns where id = p_before and board_id = p_board;
    if not found then
      raise exception 'The column is not on this board';
    end if;
  else
    select * into v_before from public.order_task_columns where board_id = p_board and system_key = 'dispatch';
  end if;
  v_pos := coalesce(v_before.position, (select coalesce(max(position), 0) + 1 from public.order_task_columns where board_id = p_board));
  update public.order_task_columns set position = position + 1 where board_id = p_board and position >= v_pos;

  if p_to_template and b.template_id is not null then
    select position into v_tpos from public.order_task_template_columns where id = v_before.template_column_id;
    v_tpos := coalesce(v_tpos, (select coalesce(max(position), 0) + 1 from public.order_task_template_columns where template_id = b.template_id));
    update public.order_task_template_columns set position = position + 1 where template_id = b.template_id and position >= v_tpos;
    insert into public.order_task_template_columns (template_id, name_bg, name_en, color, position)
    values (b.template_id, btrim(p_name_bg), nullif(btrim(p_name_en), ''), coalesce(p_color, 'grey'), v_tpos)
    returning id into v_tcol;
  end if;

  insert into public.order_task_columns (board_id, template_column_id, name_bg, name_en, color, position)
  values (p_board, v_tcol, btrim(p_name_bg), nullif(btrim(p_name_en), ''), coalesce(p_color, 'grey'), v_pos)
  returning id into v_id;
  return v_id;
end
$$;

/** Renames, recolours (custom columns) or hides a column. */
create or replace function public.update_order_task_column(
  p_column uuid, p_name_bg text, p_name_en text, p_color text, p_hidden boolean, p_to_template boolean default false)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  c public.order_task_columns;
begin
  perform public.require_role('admin', 'sales');
  if p_to_template then
    perform public.require_role('admin');
  end if;
  select * into c from public.order_task_columns where id = p_column for update;
  if not found then
    raise exception 'Column not found';
  end if;
  if nullif(btrim(p_name_bg), '') is null then
    raise exception 'Enter the name of the column';
  end if;
  update public.order_task_columns
     set name_bg = btrim(p_name_bg), name_en = nullif(btrim(p_name_en), ''),
         color = case when system_key is null then coalesce(p_color, color) end, hidden = coalesce(p_hidden, hidden)
   where id = p_column;
  if p_to_template and c.template_column_id is not null then
    update public.order_task_template_columns
       set name_bg = btrim(p_name_bg), name_en = nullif(btrim(p_name_en), ''),
           color = case when system_key is null then coalesce(p_color, color) end, hidden = coalesce(p_hidden, hidden)
     where id = c.template_column_id;
  end if;
end
$$;

/** Moves a column to a place in the process (1 = first). */
create or replace function public.move_order_task_column(p_column uuid, p_position integer, p_to_template boolean default false)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  c public.order_task_columns;
begin
  perform public.require_role('admin', 'sales');
  if p_to_template then
    perform public.require_role('admin');
  end if;
  select * into c from public.order_task_columns where id = p_column;
  if not found then
    raise exception 'Column not found';
  end if;
  perform 1 from public.order_task_columns where board_id = c.board_id for update;
  with ordered as (
    select id, row_number() over (order by position, created_at) as n
      from public.order_task_columns where board_id = c.board_id and id <> p_column
  ), placed as (
    select id, case when n >= greatest(p_position, 1) then n + 1 else n end as n from ordered
    union all
    select p_column, least(greatest(p_position, 1), (select count(*) + 1 from ordered))
  )
  update public.order_task_columns x set position = placed.n from placed where x.id = placed.id;

  -- The template follows the order of the board's columns that come from it
  if p_to_template then
    update public.order_task_template_columns tc set position = x.position
      from public.order_task_columns x
     where x.board_id = c.board_id and x.template_column_id = tc.id;
  end if;
end
$$;

/** Deletes a custom column: only when empty, or after moving its tasks to p_move_to. */
create or replace function public.delete_order_task_column(p_column uuid, p_move_to uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  c  public.order_task_columns;
  m  public.order_task_columns;
  t  record;
begin
  perform public.require_role('admin', 'sales');
  select * into c from public.order_task_columns where id = p_column for update;
  if not found then
    raise exception 'Column not found';
  end if;
  if c.system_key is not null then
    raise exception 'System columns cannot be deleted; hide them instead';
  end if;
  if exists (select 1 from public.order_tasks where column_id = p_column) then
    if p_move_to is null then
      raise exception 'The column has tasks: choose a column to move them to';
    end if;
    select * into m from public.order_task_columns where id = p_move_to and board_id = c.board_id and id <> p_column;
    if not found then
      raise exception 'The column is not on this board';
    end if;
    for t in select id from public.order_tasks where column_id = p_column order by position loop
      update public.order_tasks
         set column_id = m.id, position = coalesce((select max(position) from public.order_tasks where column_id = m.id), 0) + 1
       where id = t.id;
      perform public.order_task_log(t.id, 'moved', jsonb_build_object('from', c.name_bg, 'to', m.name_bg));
    end loop;
  end if;
  delete from public.order_task_columns where id = p_column;
end
$$;

-- ---------------------------------------------------------------------
-- Grants: staff functions are callable by signed-in users (each checks
-- the role itself, production is refused); helpers are internal.
-- ---------------------------------------------------------------------
revoke execute on function public.order_task_file_allowed(text) from public, anon;
revoke execute on function public.can_access_order_task_path(text) from public, anon;
grant execute on function public.can_access_order_task_path(text) to authenticated;
grant execute on function public.order_task_file_allowed(text) to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'add_order_task(uuid, text)', 'save_order_task(uuid, text, text, uuid)',
    'set_order_task_status(uuid, public.order_task_status)', 'move_order_task(uuid, uuid, integer)',
    'delete_order_task(uuid)', 'override_order_task(uuid, boolean, text)',
    'add_order_task_checklist_item(uuid, text)', 'update_order_task_checklist_item(uuid, boolean, text, integer)',
    'delete_order_task_checklist_item(uuid)', 'set_order_task_dependency(uuid, uuid, boolean)',
    'add_order_task_link(uuid, text, uuid)', 'remove_order_task_link(uuid)',
    'post_order_task_comment(uuid, text, uuid[])', 'edit_order_task_comment(uuid, text)', 'delete_order_task_comment(uuid)',
    'add_order_task_file(uuid, text, text, bigint, text, uuid)', 'delete_order_task_file(uuid)', 'mark_order_task_read(uuid)',
    'add_order_task_column(uuid, text, text, text, uuid, boolean)',
    'update_order_task_column(uuid, text, text, text, boolean, boolean)',
    'move_order_task_column(uuid, integer, boolean)', 'delete_order_task_column(uuid, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$$;
