-- =====================================================================
-- Trash (owner, Nov 2026): what is deleted stays 30 days and Admin can
-- restore it under Settings > Trash; after that it is gone for good (the
-- hourly job, which also removes its files from Storage).
--
-- What is deleted, and by whom (the rules that keep documents legal stay):
--   offer (calculator)  Admin any, others their own; not while an order uses it
--   order               Admin; only before production: no batches, no issued
--                       invoice, no dispatch, no purchase request (its draft
--                       invoices go with it)
--   draft invoice/note  Admin and Sales (an issued one is never deleted;
--                       Admin corrects it instead, see invoice corrections)
--   client              as before (delete_client): Admin, or Sales for their own
--   board, list, card   members of the board (a board: its creator or Admin)
--
-- How: before the delete, every row that goes with it (all tables below it
-- with ON DELETE CASCADE, followed recursively) is copied into trash.rows,
-- parents first; links that the delete clears (ON DELETE SET NULL) are kept
-- in trash.links. Restoring puts the rows back in the same order with the
-- user triggers of those tables switched off for that moment (the triggers
-- would treat old rows as new ones: numbering, guards, notifications), then
-- sets the links again where they are still empty.
-- =====================================================================

create table public.trash (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('offer', 'order', 'invoice', 'client', 'board', 'board_list', 'board_card')),
  entity_id    uuid not null,
  label        text not null,
  rows         jsonb not null default '[]',   -- [{"t": "public.x", "rows": [...]}], parents first
  links        jsonb not null default '[]',   -- [{"t": "public.x", "col": "...", "value": "...", "ids": [...]}]
  files        jsonb not null default '[]',   -- [{"bucket": "...", "path": "..."}], removed when purged
  deleted_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  deleted_at   timestamptz not null default now(),
  purge_after  timestamptz not null default now() + interval '30 days',
  restored_at  timestamptz,
  restored_by  uuid references public.profiles (id) on delete set null
);
create index trash_open_idx on public.trash (deleted_at desc) where restored_at is null;

alter table public.trash enable row level security;
create policy trash_select on public.trash for select to authenticated using (public.has_role('admin'));
revoke all on public.trash from anon, authenticated;
grant select on public.trash to authenticated;

-- Buckets of the tables that keep files (their files stay until the trash is purged)
create or replace function public.trash_bucket(p_table text)
returns text
language sql immutable set search_path = public
as $$
  select case replace(p_table, 'public.', '')
    when 'client_files' then 'client-files'
    when 'board_files' then 'board-files'
    when 'order_task_files' then 'order-task-files'
  end
$$;

/** Copies the rows of p_table where p_col is one of p_vals, and everything below them, into acc (parents first). */
create or replace function public.trash_collect(p_table regclass, p_col text, p_vals text[], inout acc jsonb, inout links jsonb, inout files jsonb)
language plpgsql security definer set search_path = public
as $$
declare
  v_rows  jsonb;
  fk      record;
  v_vals  text[];
  v_ids   uuid[];
  v_bucket text := public.trash_bucket(p_table::text);
begin
  if p_vals is null or cardinality(p_vals) = 0 then
    return;
  end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from %s x where %I::text = any ($1)', p_table, p_col)
    into v_rows using p_vals;
  -- A row reached by two ways (a card through its board and its list) is kept once
  select coalesce(jsonb_agg(r), '[]') into v_rows from jsonb_array_elements(v_rows) r
   where not exists (select 1 from jsonb_array_elements(acc) p, jsonb_array_elements(p -> 'rows') x
                      where p ->> 't' = p_table::text and x = r);
  if jsonb_array_length(v_rows) = 0 then
    return;
  end if;
  acc := acc || jsonb_build_array(jsonb_build_object('t', p_table::text, 'rows', v_rows));
  if v_bucket is not null then
    files := files || coalesce((select jsonb_agg(jsonb_build_object('bucket', v_bucket, 'path', r ->> 'storage_path'))
                                  from jsonb_array_elements(v_rows) r where r ->> 'storage_path' is not null), '[]');
  end if;
  -- Tables pointing at these rows: cascades are followed, cleared links are remembered
  for fk in
    select c.conrelid::regclass as child, a.attname as child_col, ra.attname as parent_col, c.confdeltype as del
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
     where c.contype = 'f' and c.confrelid = p_table and cardinality(c.conkey) = 1 and c.confdeltype in ('c', 'n')
  loop
    select array_agg(distinct r ->> fk.parent_col) into v_vals from jsonb_array_elements(v_rows) r where r ->> fk.parent_col is not null;
    continue when v_vals is null;
    if fk.del = 'c' then
      -- A table pointing at itself (or already collected) is not followed again
      continue when fk.child = p_table;
      select acc2, links2, files2 into acc, links, files
        from public.trash_collect(fk.child, fk.child_col, v_vals, acc, links, files) as t(acc2, links2, files2);
    else
      for i in 1 .. cardinality(v_vals) loop
        execute format('select array_agg(id) from %s where %I::text = $1', fk.child, fk.child_col) into v_ids using v_vals[i];
        if v_ids is not null then
          links := links || jsonb_build_array(jsonb_build_object('t', fk.child::text, 'col', fk.child_col, 'value', v_vals[i], 'ids', to_jsonb(v_ids)));
        end if;
      end loop;
    end if;
  end loop;
end
$$;

/**
 * Internal: copies the roots (in order: [{"t": "public.x", "ids": [...]}]) with everything below them into
 * the trash, then deletes the roots in reverse order (their triggers and guards apply). Returns the trash id.
 */
create or replace function public.trash_put(p_kind text, p_entity uuid, p_label text, p_roots jsonb, p_links jsonb default '[]')
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_acc   jsonb := '[]';
  v_links jsonb := coalesce(p_links, '[]');
  v_files jsonb := '[]';
  v_id    uuid;
  r       jsonb;
  i       integer;
begin
  for r in select value from jsonb_array_elements(p_roots) loop
    select acc2, links2, files2 into v_acc, v_links, v_files
      from public.trash_collect((r ->> 't')::regclass, 'id', array(select jsonb_array_elements_text(r -> 'ids')), v_acc, v_links, v_files)
        as t(acc2, links2, files2);
  end loop;
  insert into public.trash (kind, entity_id, label, rows, links, files)
  values (p_kind, p_entity, left(coalesce(nullif(btrim(p_label), ''), p_kind), 300), v_acc, v_links, v_files)
  returning id into v_id;
  for i in reverse jsonb_array_length(p_roots) - 1 .. 0 loop
    r := p_roots -> i;
    execute format('delete from %s where id::text = any ($1)', (r ->> 't')::regclass)
      using array(select jsonb_array_elements_text(r -> 'ids'));
  end loop;
  return v_id;
end
$$;

/** Admin puts a deleted thing back as it was; its links are set again where they are still empty. */
create or replace function public.trash_restore(p_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  tr      public.trash;
  part    jsonb;
  v_left  jsonb;
  v_next  jsonb;
  v_done  boolean;
  l       jsonb;
  v_tabs  text[];
  v_cols  text;
  t       text;
begin
  perform public.require_role('admin');
  select * into tr from public.trash where id = p_id and restored_at is null for update;
  if not found then
    raise exception 'Not in the trash any more';
  end if;
  select array_agg(distinct p ->> 't') into v_tabs from jsonb_array_elements(tr.rows) p;
  foreach t in array coalesce(v_tabs, '{}') loop
    execute format('alter table %s disable trigger user', t::regclass);
  end loop;
  begin
    -- Parents before children: a part waits while a table it points at is still to come
    v_left := tr.rows;
    while jsonb_array_length(v_left) > 0 loop
      v_next := '[]';
      v_done := false;
      for part in select value from jsonb_array_elements(v_left) loop
        if exists (
          select 1 from pg_constraint c, jsonb_array_elements(v_left) o
           where c.contype = 'f' and c.conrelid = (part ->> 't')::regclass and c.confrelid = (o ->> 't')::regclass
             and c.confrelid <> c.conrelid) then
          v_next := v_next || jsonb_build_array(part);
          continue;
        end if;
        v_done := true;
      select string_agg(quote_ident(attname), ', ' order by attnum) into v_cols
        from pg_attribute where attrelid = (part ->> 't')::regclass and attnum > 0 and not attisdropped and attgenerated = '';
      execute format('insert into %1$s (%2$s) overriding system value select %2$s from jsonb_populate_recordset(null::%1$s, $1)',
                     (part ->> 't')::regclass, v_cols)
        using part -> 'rows';
      end loop;
      if not v_done then
        raise exception 'The parts of it point at each other';
      end if;
      v_left := v_next;
    end loop;
  exception when unique_violation then
    raise exception 'It cannot be restored: something with the same number or name exists now (%)', sqlerrm;
  when foreign_key_violation then
    raise exception 'It cannot be restored: what it belonged to is gone (%)', sqlerrm;
  end;
  foreach t in array coalesce(v_tabs, '{}') loop
    execute format('alter table %s enable trigger user', t::regclass);
  end loop;
  for l in select value from jsonb_array_elements(tr.links) loop
    continue when to_regclass(l ->> 't') is null;
    execute format('update %s set %I = $1::%s where id::text = any ($2) and %I is null', (l ->> 't')::regclass, l ->> 'col',
                   (select format_type(atttypid, atttypmod) from pg_attribute where attrelid = (l ->> 't')::regclass and attname = l ->> 'col'),
                   l ->> 'col')
      using l ->> 'value', array(select jsonb_array_elements_text(l -> 'ids'));
  end loop;
  update public.trash set restored_at = now(), restored_by = auth.uid() where id = p_id;
  return tr.kind;
end
$$;

/** Admin deletes a thing from the trash for good now; returns its files to remove from Storage. */
create or replace function public.trash_forget(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_files jsonb;
begin
  perform public.require_role('admin');
  delete from public.trash where id = p_id and restored_at is null returning files into v_files;
  return coalesce(v_files, '[]');
end
$$;

/** Hourly job: what has been in the trash 30 days goes for good (restored ones after 30 days too); returns the files to remove. */
create or replace function public.trash_purge()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_files jsonb;
begin
  with gone as (
    delete from public.trash where (restored_at is null and purge_after < now()) or restored_at < now() - interval '30 days'
    returning restored_at, files
  )
  select coalesce(jsonb_agg(f), '[]') into v_files
    from gone, jsonb_array_elements(case when gone.restored_at is null then gone.files else '[]' end) f;
  return v_files;
end
$$;

-- ---------------------------------------------------------------------
-- What each kind deletes, with its rules
-- ---------------------------------------------------------------------
/** A calculator offer: Admin any, others their own; never while an order (also a cancelled one) uses it. */
create or replace function public.trash_offer(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  o public.calc_offers;
begin
  select * into o from public.calc_offers where id = p_id;
  if not found then
    raise exception 'Offer not found';
  end if;
  if not (public.has_role('admin') or (public.has_role('sales') and o.created_by = auth.uid())) then
    raise exception 'Only Admin, or who made the offer, can delete it' using errcode = '42501';
  end if;
  if exists (select 1 from public.sales_order_lines where calc_offer_id = p_id) then
    raise exception 'The offer is in an order; delete or change the order first';
  end if;
  return public.trash_put('offer', p_id, o.offer_no || ' · ' || coalesce(o.company_name, o.receiver_name) || coalesce(' · ' || o.product_name, ''),
    jsonb_build_array(jsonb_build_object('t', 'public.calc_offers', 'ids', jsonb_build_array(p_id))));
end
$$;

/** An order before production (Admin): no batches, issued invoices, dispatches or purchase requests; its draft invoices go with it. */
create or replace function public.trash_order(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  so      public.sales_orders;
  v_used  text;
  v_drafts jsonb;
begin
  perform public.require_role('admin');
  select * into so from public.sales_orders where id = p_id;
  if not found then
    raise exception 'Order not found';
  end if;
  select string_agg(what, ', ') into v_used from (
    select 'batches' as what where exists (select 1 from public.manufacturing_orders m join public.sales_order_lines l on l.id = m.sales_order_line_id where l.order_id = p_id)
    union all select 'an issued invoice' where exists (select 1 from public.invoices where order_id = p_id and status <> 'draft')
    union all select 'a dispatch' where exists (select 1 from public.dispatches where order_id = p_id)
    union all select 'purchase requests' where exists (select 1 from public.purchase_requests where sales_order_id = p_id)
  ) x;
  if v_used is not null then
    raise exception 'The order already has %; it can only be cancelled', v_used;
  end if;
  select coalesce(jsonb_agg(id), '[]') into v_drafts from public.invoices where order_id = p_id;
  return public.trash_put('order', p_id, so.code || ' · ' || (select legal_name from public.clients where id = so.client_id),
    jsonb_build_array(jsonb_build_object('t', 'public.sales_orders', 'ids', jsonb_build_array(p_id)),
                      jsonb_build_object('t', 'public.invoices', 'ids', v_drafts)));
end
$$;

/** A draft invoice, credit or debit note (Admin and Sales); an issued one is corrected, never deleted. */
create or replace function public.trash_invoice(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  i public.invoices;
begin
  perform public.require_role('admin', 'sales');
  select * into i from public.invoices where id = p_id;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if i.status <> 'draft' then
    raise exception 'An issued invoice is not deleted; Admin corrects it';
  end if;
  return public.trash_put('invoice', p_id, i.kind::text || ' · ' || coalesce(i.buyer ->> 'name', '') || coalesce(' · ' || i.total::text || ' ' || i.currency, ''),
    jsonb_build_array(jsonb_build_object('t', 'public.invoices', 'ids', jsonb_build_array(p_id))));
end
$$;

/** Boards: a card or a list (members), a whole board (its creator or Admin). */
create or replace function public.trash_board_part(p_kind text, p_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_board uuid;
  v_label text;
  v_table text;
begin
  if p_kind = 'board_card' then
    select board_id, title into v_board, v_label from public.board_cards where id = p_id;
    v_table := 'public.board_cards';
  elsif p_kind = 'board_list' then
    select board_id, name into v_board, v_label from public.board_lists where id = p_id;
    v_table := 'public.board_lists';
  elsif p_kind = 'board' then
    select id, name into v_board, v_label from public.boards where id = p_id;
    v_table := 'public.boards';
    if v_board is not null and not (public.has_role('admin') or exists (select 1 from public.boards where id = p_id and created_by = auth.uid())) then
      raise exception 'Only who made the board, or Admin, can delete it' using errcode = '42501';
    end if;
  else
    raise exception 'Unknown kind';
  end if;
  if v_board is null then
    raise exception 'Not found';
  end if;
  if not public.can_edit_board(v_board) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_kind <> 'board' then
    v_label := v_label || ' · ' || (select name from public.boards where id = v_board);
  end if;
  return public.trash_put(p_kind, p_id, v_label, jsonb_build_array(jsonb_build_object('t', v_table, 'ids', jsonb_build_array(p_id))));
end
$$;

/** A client: the rules of deleting a client stay; now through the trash (its files stay until it is purged). */
create or replace function public.delete_client(p_id uuid)
returns text[]
language plpgsql security definer set search_path = public
as $$
declare
  v_owner uuid;
  v_found boolean;
  v_used  text;
  v_name  text;
  v_enq   jsonb;
begin
  select owner_id, true, legal_name into v_owner, v_found, v_name from public.clients where id = p_id;
  if v_found is null then
    raise exception 'Client not found';
  end if;
  if not (public.has_role('admin') or (public.has_role('sales') and v_owner = auth.uid())) then
    raise exception 'Only Admin, or the salesperson responsible for the client, can delete it' using errcode = '42501';
  end if;
  select string_agg(format('%s %s', n, what), ', ') into v_used from (
    select (select count(*) from public.calc_offers   where client_id = p_id) as n, 'offer(s)' as what union all
    select (select count(*) from public.offers        where client_id = p_id), 'older offer(s)' union all
    select (select count(*) from public.sales_orders  where client_id = p_id), 'order(s)' union all
    select (select count(*) from public.formulas      where client_id = p_id), 'recipe(s)' union all
    select (select count(*) from public.projects      where client_id = p_id), 'project(s)' union all
    select (select count(*) from public.items         where client_id = p_id), 'item(s)' union all
    select (select count(*) from public.invoices      where client_id = p_id), 'invoice(s)'
  ) x where n > 0;
  if v_used is not null then
    raise exception 'The client still has %; delete or move them first', v_used;
  end if;
  -- Catalogue enquiries stay, unlinked; a restore links them again
  select coalesce(jsonb_agg(jsonb_build_object('t', 'public.catalog_enquiries', 'col', 'client_id', 'value', p_id::text, 'ids', jsonb_build_array(id))), '[]')
    into v_enq from public.catalog_enquiries where client_id = p_id;
  update public.catalog_enquiries set client_id = null where client_id = p_id;
  perform public.trash_put('client', p_id, v_name,
    jsonb_build_array(jsonb_build_object('t', 'public.clients', 'ids', jsonb_build_array(p_id))), v_enq);
  return '{}';
end
$$;

revoke execute on function public.trash_bucket(text), public.trash_collect(regclass, text, text[], jsonb, jsonb, jsonb),
  public.trash_put(text, uuid, text, jsonb, jsonb), public.trash_purge() from public, anon, authenticated;
revoke execute on function public.trash_restore(uuid), public.trash_forget(uuid), public.trash_offer(uuid), public.trash_order(uuid),
  public.trash_invoice(uuid), public.trash_board_part(text, uuid) from public, anon;
grant execute on function public.trash_restore(uuid), public.trash_forget(uuid), public.trash_offer(uuid), public.trash_order(uuid),
  public.trash_invoice(uuid), public.trash_board_part(text, uuid) to authenticated;
