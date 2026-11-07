-- =====================================================================
-- Customer panel: reorder and label approval (owner, Nov 2026).
--
-- Reorder: on one of its orders the client asks for the same products
-- again, with the quantities it wants and a note. It is a request, not an
-- order: the team makes the order from it in one step (a copy of the old
-- order with the new quantities, the old prices, to be checked) or declines
-- it with a reason. The client sees the state of its requests.
--
-- Label approval: the team sends a label file of the order (a client file)
-- to the client for approval; the client approves it or asks for changes
-- with a comment. Who and when is kept. An approval ticks the order task
-- "Label approved by the client" when the order has its task board.
--
--                         admin  sales/bookkeeper  designer  client (its own orders)
-- reorder: ask             —      —                 —         yes
-- reorder: make / decline  yes    yes               —         —
-- label: send to approve   yes    yes               yes       —
-- label: approve / changes —      —                 —         yes
-- =====================================================================

create table public.client_reorders (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients (id) on delete cascade,
  source_order_id  uuid not null references public.sales_orders (id) on delete cascade,
  lines            jsonb not null,           -- [{line_id, description, quantity}]
  note             text check (length(note) <= 2000),
  status           text not null default 'new' check (status in ('new', 'done', 'declined')),
  new_order_id     uuid references public.sales_orders (id) on delete set null,
  reason           text,
  asked_by         uuid default auth.uid() references public.profiles (id) on delete set null,
  asked_at         timestamptz not null default now(),
  handled_by       uuid references public.profiles (id) on delete set null,
  handled_at       timestamptz
);
create index client_reorders_order_idx on public.client_reorders (source_order_id, asked_at desc);

create table public.label_approvals (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.sales_orders (id) on delete cascade,
  client_file_id  uuid not null references public.client_files (id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'changes')),
  note            text check (length(note) <= 2000),          -- from the team
  client_comment  text check (length(client_comment) <= 4000),
  requested_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  requested_at    timestamptz not null default now(),
  decided_by      uuid references public.profiles (id) on delete set null,
  decided_name    text,
  decided_at      timestamptz
);
create index label_approvals_order_idx on public.label_approvals (order_id, requested_at desc);
select public.enable_audit('public.client_reorders');
select public.enable_audit('public.label_approvals');

alter table public.client_reorders enable row level security;
alter table public.label_approvals enable row level security;
create policy client_reorders_select on public.client_reorders for select to authenticated using (public.has_role('admin', 'sales'));
create policy label_approvals_select on public.label_approvals for select to authenticated using (public.has_role('admin', 'sales', 'designer'));
revoke all on public.client_reorders, public.label_approvals from anon, authenticated;
grant select on public.client_reorders, public.label_approvals to authenticated;

do $$
declare
  v text;
begin
  select pg_get_constraintdef(oid) into v from pg_constraint where conname = 'notifications_kind_check';
  execute 'alter table public.notifications drop constraint notifications_kind_check';
  execute 'alter table public.notifications add constraint notifications_kind_check '
    || replace(v, $q$'client_message'::text$q$, $q$'client_message'::text, 'client_reorder'::text, 'label_decision'::text$q$);
end
$$;

-- ---------------------------------------------------------------------
-- Reorder
-- ---------------------------------------------------------------------
/** The client asks for one of its orders again: quantities per line (0 leaves a line out) and a note. */
create or replace function public.portal_reorder(p_order uuid, p_lines jsonb, p_note text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  so      public.sales_orders;
  v_lines jsonb;
  v_id    uuid;
  r       public.app_role;
begin
  select * into so from public.sales_orders where id = p_order and client_id = public.portal_client() and status not in ('draft', 'cancelled');
  if not found then
    raise exception 'Order not found';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('line_id', l.id, 'description', coalesce(nullif(l.description, ''), co.product_name, f.name, ''),
                                               'quantity', (x.value ->> 'quantity')::numeric) order by l.sort_order), '[]')
    into v_lines
    from jsonb_array_elements(coalesce(p_lines, '[]')) x
    join public.sales_order_lines l on l.id = (x.value ->> 'line_id')::uuid and l.order_id = p_order
    left join public.calc_offers co on co.id = l.calc_offer_id
    left join public.formula_versions v on v.id = l.formula_version_id
    left join public.formulas f on f.id = v.formula_id
   where (x.value ->> 'quantity')::numeric > 0;
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'Enter the quantity of at least one product';
  end if;
  insert into public.client_reorders (client_id, source_order_id, lines, note)
  values (so.client_id, p_order, v_lines, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  foreach r in array array['admin', 'sales', 'bookkeeper']::public.app_role[] loop
    perform public.notify_role(r, 'client_reorder',
      jsonb_build_object('client', (select legal_name from public.clients where id = so.client_id), 'code', so.code),
      '/orders/' || p_order::text);
  end loop;
  return v_id;
end
$$;

/** The lines of one of the client's orders, to ask for them again (named as on the order). */
create or replace function public.portal_order_lines(p_order uuid)
returns table (id uuid, description text, quantity numeric)
language sql stable security definer set search_path = public
as $$
  select l.id, coalesce(nullif(l.description, ''), co.product_name, f.name, ''), l.quantity
    from public.sales_order_lines l
    join public.sales_orders so on so.id = l.order_id
    left join public.calc_offers co on co.id = l.calc_offer_id
    left join public.formula_versions v on v.id = l.formula_version_id
    left join public.formulas f on f.id = v.formula_id
   where l.order_id = p_order and so.client_id = public.portal_client() and so.status not in ('draft', 'cancelled')
   order by l.sort_order
$$;

/** The client's requests on one order, newest first. */
create or replace function public.portal_reorders(p_order uuid)
returns table (id uuid, lines jsonb, note text, status text, asked_at timestamptz, reason text, new_code text)
language sql stable security definer set search_path = public
as $$
  select r.id, r.lines, r.note, r.status, r.asked_at, r.reason, (select code from public.sales_orders where id = r.new_order_id)
    from public.client_reorders r
   where r.source_order_id = p_order and r.client_id = public.portal_client()
   order by r.asked_at desc
$$;

/** The team makes the order from a request: the old order's terms with only the asked lines and quantities, at the old prices (to be checked). */
create or replace function public.make_order_from_reorder(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  rq     public.client_reorders;
  so     public.sales_orders;
  v_new  uuid;
begin
  perform public.require_role('admin', 'sales');
  select * into rq from public.client_reorders where id = p_id for update;
  if not found or rq.status <> 'new' then
    raise exception 'The request is already handled';
  end if;
  -- As copy_order: the old order's terms and lines, only the lines asked for, with the asked quantities and the old prices
  select * into so from public.sales_orders where id = rq.source_order_id;
  insert into public.sales_orders (client_id, currency, status, deposit_pct, balance_terms, balance_net_days, vat_pct, notes)
  values (so.client_id, so.currency, 'unpaid', so.deposit_pct, so.balance_terms, so.balance_net_days, so.vat_pct, so.notes)
  returning id into v_new;
  perform set_config('nk.order_create', 'on', true);
  insert into public.sales_order_lines (order_id, kind, offer_id, calc_offer_id, project_id, formula_version_id,
                                        description, quantity, unit_price, sort_order)
  select v_new, l.kind, l.offer_id, l.calc_offer_id,
         case when l.kind = 'offer' then l.project_id end,
         case when l.kind = 'offer' then l.formula_version_id end,
         l.description, (x.value ->> 'quantity')::numeric, l.unit_price, l.sort_order
    from jsonb_array_elements(rq.lines) x
    join public.sales_order_lines l on l.id = (x.value ->> 'line_id')::uuid and l.order_id = rq.source_order_id;
  perform set_config('nk.order_create', 'off', true);
  update public.client_reorders set status = 'done', new_order_id = v_new, handled_by = auth.uid(), handled_at = now() where id = p_id;
  return v_new;
end
$$;

create or replace function public.decline_reorder(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Enter the reason; the client sees it';
  end if;
  update public.client_reorders set status = 'declined', reason = btrim(p_reason), handled_by = auth.uid(), handled_at = now()
   where id = p_id and status = 'new';
  if not found then
    raise exception 'The request is already handled';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Label approval
-- ---------------------------------------------------------------------
/** The team sends a label file of the order's client for approval; the file is shared with the client. */
create or replace function public.request_label_approval(p_order uuid, p_file uuid, p_note text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.require_role('admin', 'sales', 'designer');
  if not exists (select 1 from public.client_files f join public.sales_orders so on so.client_id = f.client_id where f.id = p_file and so.id = p_order) then
    raise exception 'The file is not one of this client';
  end if;
  if exists (select 1 from public.label_approvals where client_file_id = p_file and order_id = p_order and status = 'pending') then
    raise exception 'This file already waits for the client';
  end if;
  update public.client_files set shared_with_client = true where id = p_file;
  insert into public.label_approvals (order_id, client_file_id, note) values (p_order, p_file, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return v_id;
end
$$;

/** The labels of one of the client's orders and their state. */
create or replace function public.portal_labels(p_order uuid)
returns table (id uuid, file_id uuid, file_name text, status text, note text, client_comment text, requested_at timestamptz, decided_at timestamptz, decided_name text)
language sql stable security definer set search_path = public
as $$
  select a.id, f.id, f.file_name, a.status, a.note, a.client_comment, a.requested_at, a.decided_at, a.decided_name
    from public.label_approvals a
    join public.client_files f on f.id = a.client_file_id
    join public.sales_orders so on so.id = a.order_id
   where a.order_id = p_order and so.client_id = public.portal_client()
   order by a.requested_at desc
$$;

/** The client approves a label or asks for changes (a comment is then required); the team is told. */
create or replace function public.portal_label_decide(p_id uuid, p_approve boolean, p_comment text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a      public.label_approvals;
  so     public.sales_orders;
  v_name text := (select full_name from public.profiles where id = auth.uid());
  r      public.app_role;
  t      record;
begin
  select a2.* into a from public.label_approvals a2 join public.sales_orders s on s.id = a2.order_id
   where a2.id = p_id and s.client_id = public.portal_client() for update of a2;
  if not found then
    raise exception 'Not found';
  end if;
  if a.status <> 'pending' then
    raise exception 'This label is already answered';
  end if;
  if not p_approve and nullif(btrim(coalesce(p_comment, '')), '') is null then
    raise exception 'Write what should change';
  end if;
  update public.label_approvals
     set status = case when p_approve then 'approved' else 'changes' end, client_comment = nullif(btrim(coalesce(p_comment, '')), ''),
         decided_by = auth.uid(), decided_name = v_name, decided_at = now()
   where id = p_id;
  select * into so from public.sales_orders where id = a.order_id;
  foreach r in array array['admin', 'sales', 'designer']::public.app_role[] loop
    perform public.notify_role(r, 'label_decision',
      jsonb_build_object('client', (select legal_name from public.clients where id = so.client_id), 'code', so.code,
                         'file', (select file_name from public.client_files where id = a.client_file_id), 'approved', p_approve),
      '/orders/' || so.id::text);
  end loop;
  -- An approval ticks "Label approved by the client" on the order's task board
  if p_approve then
    for t in select ot.id, ot.status from public.order_tasks ot join public.order_task_boards b on b.id = ot.board_id
              where b.sales_order_id = so.id and ot.template_key = 'label_approved' and ot.status <> 'done' loop
      update public.order_tasks set status = 'done', completed_at = now(), completed_by = auth.uid() where id = t.id;
      perform public.order_task_log(t.id, 'status', jsonb_build_object('from', t.status, 'to', 'done', 'by', v_name), true);
    end loop;
  end if;
end
$$;

revoke execute on function public.portal_reorder(uuid, jsonb, text), public.portal_reorders(uuid), public.portal_order_lines(uuid), public.make_order_from_reorder(uuid),
  public.decline_reorder(uuid, text), public.request_label_approval(uuid, uuid, text), public.portal_labels(uuid),
  public.portal_label_decide(uuid, boolean, text) from public, anon;
grant execute on function public.portal_reorder(uuid, jsonb, text), public.portal_reorders(uuid), public.portal_order_lines(uuid), public.make_order_from_reorder(uuid),
  public.decline_reorder(uuid, text), public.request_label_approval(uuid, uuid, text), public.portal_labels(uuid),
  public.portal_label_decide(uuid, boolean, text) to authenticated;
