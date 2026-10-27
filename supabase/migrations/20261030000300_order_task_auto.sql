-- =====================================================================
-- Nutrikal ERP + CRM — Order Task Manager, part 3: automatic tasks and
-- the raw-material availability of an order.
--
-- Every automatic task (⚡) is derived from the state of the ERP, so a
-- rule ticks when its event happens and unticks when it is reversed
-- (a reservation released, a payment date cleared, a manufacturing order
-- moved back …), each time with an activity entry naming the source.
-- order_tasks_refresh(order) recomputes an order; triggers on the ERP
-- tables call it for the orders they touch. A task admin marked by hand
-- (override) is left alone.
--
-- Rule                 done when
-- payment_first        the first payment (advance or 100 %) is received
-- invoice_advance      the advance invoice is issued
-- payment_final        the final payment (balance) is received
-- invoice_final        the final invoice is issued
-- invoice_full         the invoice of an order paid at once is issued
-- recipes_approved     every product line has an approved recipe version
-- materials_available  every material of the order is free or reserved
-- shortfall_delivered  every purchase request of the order is received
--                      (or nothing was missing)
-- materials_reserved   raw materials of every manufacturing order reserved
-- packaging_reserved   packaging of every manufacturing order reserved
-- sent_to_production   every manufacturing order is at Production
-- in_production        every manufacturing order has started
-- consumption_reported every batch is reported (lots used)
-- qc_released          every batch is released by QC (PF-QUAR)
-- coa_ready            every batch has its certificate of analysis
--
-- Availability: one snapshot per change (order_task_material_checks),
-- refreshed in the database when stock, a reservation, a delivery, QC
-- or the order's recipes change. When another order's reservation leaves
-- this one short, its owner is notified.
-- =====================================================================

-- A manufacturing order of a calculator line (no ERP offer) takes the packaging of its recipe
create or replace function public.manufacturing_orders_packaging()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.sales_order_line_id is not null
     and (select offer_id from public.sales_order_lines where id = new.sales_order_line_id) is not null then
    insert into public.mo_packaging (mo_id, item_id, qty_per_pack)
    select new.id, op.item_id, op.qty_per_pack
      from public.sales_order_lines l join public.offer_packaging op on op.offer_id = l.offer_id
     where l.id = new.sales_order_line_id
    on conflict do nothing;
  else
    insert into public.mo_packaging (mo_id, item_id, qty_per_pack)
    select new.id, item_id, qty_per_pack from public.formula_packaging where version_id = new.formula_version_id
    on conflict do nothing;
  end if;
  return null;
end
$$;

-- Requests for the order's missing materials when nothing is planned yet
alter table public.purchase_requests add column sales_order_id uuid references public.sales_orders (id);
create index purchase_requests_order_idx on public.purchase_requests (sales_order_id);

-- What a recipe version needs for p_qty packs (as mo_required_materials, before an MO exists)
create or replace function public.version_required_materials(p_version uuid, p_qty numeric)
returns table (item_id uuid, kind text, required numeric)
language sql stable security definer set search_path = public
as $$
  with m as (
    select v.id, f.serving_size, f.serving_unit, f.servings_per_pack, f.shell_item_id, coalesce(fc.loss_pct, 0) as loss_pct
      from public.formula_versions v
      join public.formulas f on f.id = v.formula_id
      left join public.format_costing fc on fc.product_format = f.product_format
     where v.id = p_version
  ),
  lines as (
    select i.id as item_id, 'ingredient'::text as kind,
           l.amount_mg * (1 + l.overage_pct / 100) * m.servings_per_pack * (1 + m.loss_pct / 100) * p_qty
             / case i.base_unit when 'kg' then 1000000 when 'g' then 1000 end as required
      from m join public.formula_lines l on l.version_id = m.id
      join public.items i on i.id = l.item_id
    union all
    select m.shell_item_id, 'shell', m.serving_size * m.servings_per_pack * (1 + m.loss_pct / 100) * p_qty
      from m where m.serving_unit = 'pcs' and m.shell_item_id is not null
    union all
    select p.item_id, 'packaging', p.qty_per_pack * p_qty
      from m join public.formula_packaging p on p.version_id = m.id
  )
  select item_id, min(kind), round(sum(required), 4)
    from lines where required is not null
   group by item_id
$$;
revoke execute on function public.version_required_materials(uuid, numeric) from public, anon, authenticated;

-- The materials of an order: needed, and reserved for (or used by) its manufacturing orders
create or replace function public.order_material_needs(p_order uuid)
returns table (item_id uuid, kind text, required numeric, reserved numeric)
language sql stable security definer set search_path = public
as $$
  with l as (
    select id, quantity, formula_version_id from public.sales_order_lines
     where order_id = p_order and kind <> 'service' and formula_version_id is not null
  ),
  mo as (
    select m.id, m.sales_order_line_id, m.status from public.manufacturing_orders m
      join l on l.id = m.sales_order_line_id where m.status <> 'cancelled'
  ),
  req as (
    select r.item_id, r.kind, r.required,
           case when mo.status in ('in_production', 'completed') then r.required
                else least(r.required, coalesce((select sum(sr.quantity) from public.stock_reservations sr
                                                  where sr.manufacturing_order_id = mo.id and sr.item_id = r.item_id
                                                    and sr.status = 'active'), 0)) end as reserved
      from mo cross join lateral public.mo_required_materials(mo.id) r
    union all
    select r.item_id, r.kind, r.required, 0
      from l cross join lateral public.version_required_materials(l.formula_version_id, l.quantity) r
     where not exists (select 1 from mo where mo.sales_order_line_id = l.id)
  )
  select item_id, min(kind), sum(required), sum(reserved) from req group by item_id
$$;
revoke execute on function public.order_material_needs(uuid) from public, anon, authenticated;

-- One availability line per material, worst first
create or replace function public.order_material_lines(p_order uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with n as (select * from public.order_material_needs(p_order)),
  x as (
    select n.*, i.sku, i.name, i.name_bg, i.base_unit,
           greatest(n.required - n.reserved, 0) as need,
           coalesce((select sum(m.quantity) from public.stock_movements m join public.lots lo on lo.id = m.lot_id
                      where m.item_id = n.item_id and lo.qc_status = 'released'
                        and (lo.expires_on is null or lo.expires_on >= current_date)), 0)
             - coalesce((select sum(r.quantity) from public.stock_reservations r
                          where r.item_id = n.item_id and r.status = 'active'), 0) as free,
           inc.incoming, inc.incoming_on, inc.incoming_ref
      from n
      join public.items i on i.id = n.item_id
      left join lateral (
        select sum(greatest(d.quantity - coalesce(rc.received, 0), 0)) as incoming, min(d.expected_on) as incoming_on,
               string_agg(coalesce(d.po_reference, d.code), ', ' order by d.expected_on nulls last, d.code) as incoming_ref
          from public.expected_deliveries d
          left join lateral (select sum(m.quantity) as received from public.lots lo
                               join public.stock_movements m on m.lot_id = lo.id and m.type = 'receipt'
                              where lo.expected_delivery_id = d.id) rc on true
         where d.item_id = n.item_id and d.status = 'open'
      ) inc on true
  ),
  s as (
    select x.*, case when need <= 0 or free >= need then 'ok'
                     when free + coalesce(incoming, 0) >= need then 'short_incoming'
                     else 'short_no_order' end as status
      from x
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', item_id, 'sku', sku, 'name', name, 'name_bg', name_bg, 'kind', kind, 'unit', base_unit,
           'required', round(required, 4), 'reserved', round(reserved, 4), 'free', round(free, 4),
           'incoming', round(coalesce(incoming, 0), 4), 'incoming_on', incoming_on, 'incoming_ref', incoming_ref,
           'status', status)
         order by array_position(array['short_no_order', 'short_incoming', 'ok'], status), kind <> 'ingredient', name), '[]')
    from s
$$;
revoke execute on function public.order_material_lines(uuid) from public, anon, authenticated;

/**
 * Takes a new availability snapshot of an order when something changed (always for 'manual').
 * p_cause: the order whose reservation triggered it; when that leaves a material of this
 * order short, the owner of this order is notified.
 */
create or replace function public.order_material_check(p_order uuid, p_source text, p_cause uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_board  uuid;
  v_lines  jsonb;
  v_last   public.order_task_material_checks;
  v_vers   jsonb;
  v_so     public.sales_orders;
  v_owner  uuid;
  v_cause  text;
  r        record;
begin
  select id into v_board from public.order_task_boards where sales_order_id = p_order;
  if v_board is null then
    return;
  end if;
  v_lines := public.order_material_lines(p_order);
  select * into v_last from public.order_task_material_checks where board_id = v_board order by id desc limit 1;
  if p_source <> 'manual' and (v_lines = coalesce(v_last.lines, '[]'::jsonb)) then
    return;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'code', f.code, 'version', v.version) order by f.code), '[]')
    into v_vers
    from (select distinct formula_version_id from public.sales_order_lines
           where order_id = p_order and kind <> 'service' and formula_version_id is not null) l
    join public.formula_versions v on v.id = l.formula_version_id
    join public.formulas f on f.id = v.formula_id;
  insert into public.order_task_material_checks (board_id, source, cause_order_id, recipe_versions, lines, total, ok)
  values (v_board, p_source, p_cause, v_vers, v_lines, jsonb_array_length(v_lines),
          (select count(*) from jsonb_array_elements(v_lines) e where e ->> 'status' = 'ok'));

  -- Another order's reservation left this one short: tell the owner
  if p_cause is not null and p_cause <> p_order and v_last.id is not null then
    select * into v_so from public.sales_orders where id = p_order;
    select coalesce((select id from public.profiles where id = v_so.created_by and is_active and role in ('admin', 'sales')),
                    (select p.id from public.clients c join public.profiles p on p.id = c.owner_id
                      where c.id = v_so.client_id and p.is_active and p.role in ('admin', 'sales')))
      into v_owner;
    select code into v_cause from public.sales_orders where id = p_cause;
    for r in
      select n.value as line
        from jsonb_array_elements(v_lines) n
        join jsonb_array_elements(v_last.lines) o on o.value ->> 'item_id' = n.value ->> 'item_id'
       where n.value ->> 'status' <> 'ok' and o.value ->> 'status' = 'ok'
    loop
      continue when v_owner is null;
      insert into public.notifications (user_id, kind, params, link)
      values (v_owner, 'materials_short',
              jsonb_build_object('by', v_cause, 'order', v_so.code, 'item', r.line ->> 'name', 'item_bg', r.line ->> 'name_bg'),
              '/orders/' || p_order);
    end loop;
  end if;
end
$$;
revoke execute on function public.order_material_check(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- The rules
-- ---------------------------------------------------------------------
create or replace function public.order_tasks_sync(p_order uuid, p_source text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  so        public.sales_orders;
  v_board   uuid;
  v_source  text := coalesce(nullif(p_source, ''), nullif(current_setting('nk.task_source', true), ''), 'order');
  v_lines   integer;
  v_linked  integer;
  v_approved integer;
  v_mos     integer;   -- product lines with an active manufacturing order
  v_sent    integer;
  v_started integer;
  v_done    integer;
  v_qc      integer;
  v_coa     integer;
  v_raw_t   integer;
  v_raw_r   integer;
  v_pack_t  integer;
  v_pack_r  integer;
  v_pr_t    integer;
  v_pr_r    integer;
  v_check   public.order_task_material_checks;
  v_avail   boolean;
  v_state   jsonb;
  v_ok      boolean;
  v_note    jsonb;
  v_same    boolean;
  t         record;
begin
  select id into v_board from public.order_task_boards where sales_order_id = p_order;
  if v_board is null then
    return;
  end if;
  select * into so from public.sales_orders where id = p_order;

  -- Facts about the order
  select count(*), count(l.formula_version_id), count(*) filter (where v.status <> 'draft')
    into v_lines, v_linked, v_approved
    from public.sales_order_lines l left join public.formula_versions v on v.id = l.formula_version_id
   where l.order_id = p_order and l.kind <> 'service';

  with m as (
    select distinct on (l.id) l.id as line_id, mo.id, mo.status, mo.finished_lot_id
      from public.sales_order_lines l
      join public.manufacturing_orders mo on mo.sales_order_line_id = l.id and mo.status <> 'cancelled'
     where l.order_id = p_order and l.kind <> 'service'
     order by l.id, mo.created_at desc
  )
  select count(*),
         count(*) filter (where m.status in ('released', 'in_production', 'completed')),
         count(*) filter (where m.status in ('in_production', 'completed')),
         count(*) filter (where m.status = 'completed'),
         count(*) filter (where lo.qc_status = 'released'),
         count(*) filter (where lo.coa_path is not null)
    into v_mos, v_sent, v_started, v_done, v_qc, v_coa
    from m left join public.lots lo on lo.id = m.finished_lot_id;

  with mo as (
    select mo.id, mo.status from public.manufacturing_orders mo
      join public.sales_order_lines l on l.id = mo.sales_order_line_id
     where l.order_id = p_order and mo.status <> 'cancelled'
  ), r as (
    select q.kind, q.required,
           case when mo.status in ('released', 'in_production', 'completed') then q.required
                else coalesce((select sum(sr.quantity) from public.stock_reservations sr
                                where sr.manufacturing_order_id = mo.id and sr.item_id = q.item_id and sr.status = 'active'), 0) end as reserved
      from mo cross join lateral public.mo_required_materials(mo.id) q
  )
  select count(*) filter (where kind <> 'packaging'), count(*) filter (where kind <> 'packaging' and reserved >= required),
         count(*) filter (where kind = 'packaging'), count(*) filter (where kind = 'packaging' and reserved >= required)
    into v_raw_t, v_raw_r, v_pack_t, v_pack_r
    from r;

  select count(*) filter (where pr.status <> 'cancelled'), count(*) filter (where pr.status = 'received')
    into v_pr_t, v_pr_r
    from public.purchase_requests pr
   where pr.sales_order_id = p_order
      or pr.manufacturing_order_id in (select mo.id from public.manufacturing_orders mo
                                         join public.sales_order_lines l on l.id = mo.sales_order_line_id
                                        where l.order_id = p_order);

  select * into v_check from public.order_task_material_checks where board_id = v_board order by id desc limit 1;
  v_avail := v_lines > 0 and v_linked = v_lines and v_check.id is not null and v_check.total > 0 and v_check.ok = v_check.total;

  v_state := jsonb_build_object(
    'payment_first',        jsonb_build_array(so.deposit_received_on is not null, null),
    'payment_final',        jsonb_build_array(so.balance_received_on is not null, null),
    'invoice_advance',      jsonb_build_array(exists (select 1 from public.invoices where order_id = p_order and kind = 'invoice' and purpose = 'advance' and status = 'issued'), null),
    'invoice_final',        jsonb_build_array(exists (select 1 from public.invoices where order_id = p_order and kind = 'invoice' and purpose = 'final' and status = 'issued'), null),
    'invoice_full',         jsonb_build_array(exists (select 1 from public.invoices where order_id = p_order and kind = 'invoice' and purpose = 'full' and status = 'issued'), null),
    'recipes_approved',     jsonb_build_array(v_lines > 0 and v_approved = v_lines,
                              jsonb_build_object('key', 'recipes', 'n', v_approved, 'total', v_lines)),
    'materials_available',  jsonb_build_array(v_avail,
                              case when v_linked < v_lines or v_lines = 0 then jsonb_build_object('key', 'materials_unlinked')
                                   when v_check.id is not null then jsonb_build_object('key', 'materials', 'ok', v_check.ok, 'total', v_check.total) end),
    'shortfall_delivered',  jsonb_build_array((v_pr_t > 0 and v_pr_r = v_pr_t) or (v_pr_t = 0 and v_avail),
                              case when v_pr_t > 0 then jsonb_build_object('key', 'requests', 'n', v_pr_r, 'total', v_pr_t) end),
    'materials_reserved',   jsonb_build_array(v_lines > 0 and v_mos = v_lines and v_raw_t > 0 and v_raw_r = v_raw_t,
                              case when v_mos < v_lines then jsonb_build_object('key', 'not_planned')
                                   else jsonb_build_object('key', 'reserved', 'n', v_raw_r, 'total', v_raw_t) end),
    'packaging_reserved',   jsonb_build_array(v_lines > 0 and v_mos = v_lines and v_pack_t > 0 and v_pack_r = v_pack_t,
                              case when v_mos < v_lines then jsonb_build_object('key', 'not_planned')
                                   when v_pack_t = 0 then jsonb_build_object('key', 'no_packaging')
                                   else jsonb_build_object('key', 'reserved', 'n', v_pack_r, 'total', v_pack_t) end),
    'sent_to_production',   jsonb_build_array(v_lines > 0 and v_sent = v_lines,
                              case when v_lines > 1 then jsonb_build_object('key', 'mos', 'n', v_sent, 'total', v_lines) end),
    'in_production',        jsonb_build_array(v_lines > 0 and v_started = v_lines,
                              case when v_started > v_done then jsonb_build_object('key', 'batch_in_production') end),
    'consumption_reported', jsonb_build_array(v_lines > 0 and v_done = v_lines,
                              case when v_lines > 1 then jsonb_build_object('key', 'mos', 'n', v_done, 'total', v_lines) end),
    'qc_released',          jsonb_build_array(v_lines > 0 and v_qc = v_lines,
                              case when v_done > v_qc then jsonb_build_object('key', 'in_quarantine') end),
    'coa_ready',            jsonb_build_array(v_lines > 0 and v_done = v_lines and v_coa = v_lines,
                              case when v_done = v_lines and v_coa < v_lines then jsonb_build_object('key', 'coa_missing') end));

  for t in select * from public.order_tasks where board_id = v_board and kind = 'auto' for update loop
    v_ok := coalesce((v_state -> t.auto_rule ->> 0)::boolean, false);
    v_note := nullif(v_state -> t.auto_rule -> 1, 'null'::jsonb);
    if t.note is distinct from v_note then
      update public.order_tasks set note = v_note where id = t.id;
    end if;
    continue when t.override;
    if v_ok and t.status <> 'done' then
      update public.order_tasks set status = 'done', completed_at = now(), completed_by = null where id = t.id;
      perform public.order_task_log(t.id, 'auto_done', jsonb_build_object('source', v_source), true);
    elsif not v_ok and t.status = 'done' then
      update public.order_tasks set status = 'todo', completed_at = null, completed_by = null where id = t.id;
      perform public.order_task_log(t.id, 'auto_undone', jsonb_build_object('source', v_source), true);
    end if;
  end loop;

  -- Links the rules know about (chips on the cards)
  insert into public.order_task_links (task_id, entity_type, entity_id, label, is_auto, created_by)
  select ot.id, x.entity_type, x.entity_id, x.label, true, null
    from public.order_tasks ot
    join (
      select r.rule, 'manufacturing_order' as entity_type, mo.id as entity_id, mo.code as label
        from public.manufacturing_orders mo
        join public.sales_order_lines l on l.id = mo.sales_order_line_id
        cross join unnest(array['materials_reserved', 'packaging_reserved', 'sent_to_production', 'in_production', 'consumption_reported']) r(rule)
       where l.order_id = p_order and mo.status <> 'cancelled'
      union all
      select r.rule, 'lot', lo.id, lo.lot_number
        from public.manufacturing_orders mo
        join public.sales_order_lines l on l.id = mo.sales_order_line_id
        join public.lots lo on lo.id = mo.finished_lot_id
        cross join unnest(array['qc_released', 'coa_ready']) r(rule)
       where l.order_id = p_order and mo.status <> 'cancelled'
      union all
      select 'recipes_approved', 'formula_version', v.id, f.code || ' v' || v.version
        from public.sales_order_lines l
        join public.formula_versions v on v.id = l.formula_version_id
        join public.formulas f on f.id = v.formula_id
       where l.order_id = p_order
      union all
      select 'invoice_' || i.purpose, 'invoice', i.id, coalesce(i.number, 'draft')
        from public.invoices i where i.order_id = p_order and i.kind = 'invoice'
      union all
      select 'shortfall_delivered', 'purchase_request', pr.id, pr.code
        from public.purchase_requests pr
       where pr.sales_order_id = p_order
          or pr.manufacturing_order_id in (select mo.id from public.manufacturing_orders mo
                                             join public.sales_order_lines l on l.id = mo.sales_order_line_id
                                            where l.order_id = p_order)
    ) x on x.rule = ot.auto_rule
   where ot.board_id = v_board
  on conflict (task_id, entity_type, entity_id) do update set label = excluded.label;

  -- Repeat order: "final formulas confirmed" is done when every recipe is one the client already ordered
  for t in select * from public.order_tasks where board_id = v_board and prefill_rule = 'recipe_unchanged' and status = 'todo' loop
    select v_lines > 0 and v_linked = v_lines and not exists (
             select 1 from public.sales_order_lines l
              where l.order_id = p_order and l.kind <> 'service'
                and not exists (select 1 from public.sales_order_lines p join public.sales_orders po on po.id = p.order_id
                                 where po.client_id = so.client_id and po.id <> so.id and po.status <> 'cancelled'
                                   and po.created_at < so.created_at and p.formula_version_id = l.formula_version_id))
      into v_same;
    if v_same then
      update public.order_tasks set status = 'done', completed_at = now(), completed_by = null, prefill_rule = null where id = t.id;
      perform public.order_task_log(t.id, 'auto_done', jsonb_build_object('source', 'recipe_unchanged'), true);
    end if;
  end loop;
end
$$;
revoke execute on function public.order_tasks_sync(uuid, text) from public, anon, authenticated;

-- Availability, then the rules
create or replace function public.order_tasks_refresh(p_order uuid, p_source text, p_cause uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_order is null or not exists (select 1 from public.order_task_boards where sales_order_id = p_order) then
    return;
  end if;
  perform public.order_material_check(p_order, p_source, p_cause);
  perform public.order_tasks_sync(p_order, p_source);
end
$$;
revoke execute on function public.order_tasks_refresh(uuid, text, uuid) from public, anon, authenticated;

-- Open orders whose last snapshot has one of these materials
create or replace function public.order_tasks_refresh_items(p_items uuid[], p_source text, p_cause uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  o record;
begin
  for o in
    select b.sales_order_id as id
      from public.order_task_boards b
      join public.sales_orders so on so.id = b.sales_order_id and so.status in ('confirmed', 'in_production', 'ready')
     where exists (select 1 from public.order_task_material_checks c
                    where c.board_id = b.id and c.id = (select max(id) from public.order_task_material_checks where board_id = b.id)
                      and exists (select 1 from jsonb_array_elements(c.lines) e where (e ->> 'item_id')::uuid = any (p_items)))
        or b.sales_order_id = p_cause
  loop
    perform public.order_tasks_refresh(o.id, p_source, p_cause);
  end loop;
end
$$;
revoke execute on function public.order_tasks_refresh_items(uuid[], text, uuid) from public, anon, authenticated;

-- The board's first snapshot is taken when it is made
create or replace function public.create_order_task_board_check()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.order_tasks_refresh(new.sales_order_id, 'board_created');
  return null;
end
$$;

-- ---------------------------------------------------------------------
-- Triggers on the ERP events
-- ---------------------------------------------------------------------
create or replace function public.order_tasks_on_order()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (new.deposit_received_on, new.balance_received_on, new.status) is distinct from
     (old.deposit_received_on, old.balance_received_on, old.status) then
    perform public.order_tasks_sync(new.id, coalesce(nullif(current_setting('nk.task_source', true), ''),
      case when new.balance_received_on is distinct from old.balance_received_on then 'final_payment'
           when new.deposit_received_on is distinct from old.deposit_received_on then 'payment'
           else 'order_status' end));
  end if;
  return null;
end
$$;
create trigger order_tasks_on_order after update on public.sales_orders
  for each row execute function public.order_tasks_on_order();

create or replace function public.order_tasks_on_line()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.formula_version_id is distinct from old.formula_version_id then
    perform public.order_tasks_refresh(new.order_id, 'recipe_linked');
  end if;
  return null;
end
$$;
create trigger order_tasks_on_line after update on public.sales_order_lines
  for each row execute function public.order_tasks_on_line();

create or replace function public.order_tasks_on_mo()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_order uuid;
begin
  select order_id into v_order from public.sales_order_lines where id = new.sales_order_line_id;
  if tg_op = 'INSERT' or (new.status, new.finished_lot_id, new.quantity) is distinct from (old.status, old.finished_lot_id, old.quantity) then
    perform public.order_tasks_refresh(v_order, 'mo_' || new.status);
  end if;
  return null;
end
$$;
create trigger order_tasks_on_mo after insert or update on public.manufacturing_orders
  for each row execute function public.order_tasks_on_mo();

create or replace function public.order_tasks_on_mo_packaging()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.order_tasks_refresh(
    (select l.order_id from public.manufacturing_orders mo join public.sales_order_lines l on l.id = mo.sales_order_line_id
      where mo.id = case when tg_op = 'DELETE' then old.mo_id else new.mo_id end), 'packaging');
  return null;
end
$$;
create trigger order_tasks_on_mo_packaging after insert or update or delete on public.mo_packaging
  for each row execute function public.order_tasks_on_mo_packaging();

-- Reservations: this order's tasks, and every other order needing the same materials
create or replace function public.order_tasks_on_reservations()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  r record;
begin
  for r in
    select l.order_id, array_agg(distinct n.item_id) as items
      from new_rows n
      left join public.manufacturing_orders mo on mo.id = n.manufacturing_order_id
      left join public.sales_order_lines l on l.id = mo.sales_order_line_id
     group by l.order_id
  loop
    perform public.order_tasks_refresh_items(r.items, 'reservation', r.order_id);
  end loop;
  return null;
end
$$;
create trigger order_tasks_on_reservations_insert after insert on public.stock_reservations
  referencing new table as new_rows for each statement execute function public.order_tasks_on_reservations();
create trigger order_tasks_on_reservations_update after update on public.stock_reservations
  referencing new table as new_rows for each statement execute function public.order_tasks_on_reservations();

create or replace function public.order_tasks_on_stock()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_items uuid[];
begin
  select array_agg(distinct item_id) into v_items from new_rows;
  if v_items is not null then
    perform public.order_tasks_refresh_items(v_items, 'stock');
  end if;
  return null;
end
$$;
create trigger order_tasks_on_stock after insert on public.stock_movements
  referencing new table as new_rows for each statement execute function public.order_tasks_on_stock();

create or replace function public.order_tasks_on_lot()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  o record;
begin
  if new.qc_status is distinct from old.qc_status then
    perform public.order_tasks_refresh_items(array[new.item_id], 'qc');
  end if;
  for o in select distinct l.order_id from public.manufacturing_orders mo
             join public.sales_order_lines l on l.id = mo.sales_order_line_id
            where mo.finished_lot_id = new.id loop
    perform public.order_tasks_sync(o.order_id, case when new.qc_status is distinct from old.qc_status then 'qc' else 'coa' end);
  end loop;
  return null;
end
$$;
create trigger order_tasks_on_lot after update of qc_status, coa_path on public.lots
  for each row execute function public.order_tasks_on_lot();

create or replace function public.order_tasks_on_delivery()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.order_tasks_refresh_items(array[new.item_id], 'delivery');
  return null;
end
$$;
create trigger order_tasks_on_delivery after insert or update on public.expected_deliveries
  for each row execute function public.order_tasks_on_delivery();

create or replace function public.order_tasks_on_purchase_request()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.order_tasks_sync(coalesce(new.sales_order_id,
    (select l.order_id from public.manufacturing_orders mo join public.sales_order_lines l on l.id = mo.sales_order_line_id
      where mo.id = new.manufacturing_order_id)), 'purchase_request');
  return null;
end
$$;
create trigger order_tasks_on_purchase_request after insert or update on public.purchase_requests
  for each row execute function public.order_tasks_on_purchase_request();

create or replace function public.order_tasks_on_invoice()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.order_tasks_sync(new.order_id, 'invoice_' || new.status);
  return null;
end
$$;
create trigger order_tasks_on_invoice after insert or update on public.invoices
  for each row execute function public.order_tasks_on_invoice();

create trigger order_task_boards_check after insert on public.order_task_boards
  for each row execute function public.create_order_task_board_check();

-- ---------------------------------------------------------------------
-- From the task panel
-- ---------------------------------------------------------------------
/** "Check again": a new availability snapshot now. */
create or replace function public.refresh_order_materials(p_order uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  if not exists (select 1 from public.order_task_boards where sales_order_id = p_order) then
    raise exception 'This order has no tasks yet';
  end if;
  perform public.order_material_check(p_order, 'manual');
  perform public.order_tasks_sync(p_order, 'manual');
end
$$;

/**
 * "Request what is missing": purchase requests through the existing flow — per manufacturing
 * order when the line is planned, otherwise for the order itself. Returns how many were made.
 */
create or replace function public.create_order_shortfall_requests(p_order uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  so    public.sales_orders;
  m     record;
  r     record;
  v_n   integer := 0;
  v_req numeric;
begin
  perform public.require_role('admin', 'sales');
  select * into so from public.sales_orders where id = p_order;
  if not found or so.status not in ('confirmed', 'in_production') then
    raise exception 'Materials are requested for a paid order that is not finished';
  end if;
  for m in select mo.id from public.manufacturing_orders mo join public.sales_order_lines l on l.id = mo.sales_order_line_id
            where l.order_id = p_order and mo.status not in ('completed', 'cancelled') loop
    v_n := v_n + public.create_purchase_requests(m.id);
  end loop;
  -- Lines not planned yet: what the order still lacks, less what is already requested for it
  for r in
    with need as (
      select q.item_id, sum(q.required) as required
        from public.sales_order_lines l
        cross join lateral public.version_required_materials(l.formula_version_id, l.quantity) q
       where l.order_id = p_order and l.kind <> 'service' and l.formula_version_id is not null
         and not exists (select 1 from public.manufacturing_orders mo where mo.sales_order_line_id = l.id and mo.status <> 'cancelled')
       group by q.item_id
    )
    select n.item_id, n.required, (x.value ->> 'free')::numeric as free, (x.value ->> 'incoming')::numeric as incoming
      from need n
      join jsonb_array_elements(public.order_material_lines(p_order)) x on (x.value ->> 'item_id')::uuid = n.item_id
     where x.value ->> 'status' = 'short_no_order'
  loop
    v_req := r.required - greatest(r.free, 0) - coalesce(r.incoming, 0)
             - coalesce((select sum(quantity) from public.purchase_requests
                          where sales_order_id = p_order and item_id = r.item_id and status in ('open', 'ordered')), 0);
    if v_req > 0 then
      insert into public.purchase_requests (item_id, quantity, sales_order_id, note)
      values (r.item_id, round(v_req, 4), p_order, 'Order ' || so.code);
      v_n := v_n + 1;
    end if;
  end loop;
  perform public.order_tasks_refresh(p_order, 'purchase_request');
  return v_n;
end
$$;

revoke execute on function public.refresh_order_materials(uuid) from public, anon;
grant execute on function public.refresh_order_materials(uuid) to authenticated;
revoke execute on function public.create_order_shortfall_requests(uuid) from public, anon;
grant execute on function public.create_order_shortfall_requests(uuid) to authenticated;

-- Admin takes back a hand-marked automatic task: the rule decides again
create or replace function public.clear_order_task_override(p_task uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t public.order_tasks := public.order_task_for_change(p_task);
begin
  perform public.require_role('admin');
  if not t.override then
    return;
  end if;
  update public.order_tasks set override = false, override_reason = null where id = p_task;
  perform public.order_task_log(p_task, 'override_cleared');
  perform public.order_tasks_sync((select sales_order_id from public.order_task_boards where id = t.board_id), 'override_cleared');
end
$$;
revoke execute on function public.clear_order_task_override(uuid) from public, anon;
grant execute on function public.clear_order_task_override(uuid) to authenticated;

-- Boards already made (none on the live database yet) get their first snapshot
select public.order_tasks_refresh(sales_order_id, 'board_created') from public.order_task_boards;
