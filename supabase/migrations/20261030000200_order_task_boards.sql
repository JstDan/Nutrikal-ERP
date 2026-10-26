-- =====================================================================
-- Nutrikal ERP + CRM — Order Task Manager, part 2: templates and the
-- board created when admin confirms the first payment.
--
-- Owner, Oct 2026: "Confirm first payment" records what was received —
-- an advance (default 50 %) or 100 % — and, in the same transaction,
-- makes the board from the chosen template (default "Private label —
-- нова поръчка"). Its first Payments task is done: "Аванс 50%" or
-- "Плащане 100%". The final payment is confirmed later with "Confirm
-- final payment" on the board (no final-payment task when 100 % was
-- paid). One board per order: confirming again never makes a second one.
-- Orders already paid before the task manager get their board the same
-- way (admin, from the order page).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Seed: three templates
-- ---------------------------------------------------------------------
do $$
declare
  v_pl  uuid;
  v_rep uuid;
  v_exp uuid;
  v_col uuid;
  t     uuid;
  c     record;
  i     record;
begin
  insert into public.order_task_templates (name_bg, name_en, is_default)
  values ('Private label — нова поръчка', 'Private label — new order', true) returning id into v_pl;

  insert into public.order_task_template_columns (template_id, system_key, name_bg, name_en, position) values
    (v_pl, 'payments',   'Плащания и фактури',     'Payments & invoices',  1),
    (v_pl, 'formula',    'Рецептура',              'Formula',              2),
    (v_pl, 'design',     'Дизайн и етикет',        'Design & label',       3),
    (v_pl, 'materials',  'Материали',              'Materials',            4),
    (v_pl, 'production', 'Производство',           'Production',           5),
    (v_pl, 'dispatch',   'Документи и експедиция', 'Documents & dispatch', 6);

  insert into public.order_task_template_items
    (template_id, column_id, key, title_bg, title_en, auto_rule, condition, default_checklist, depends_on, position)
  select v_pl, (select id from public.order_task_template_columns where template_id = v_pl and system_key = x.col),
         x.key, x.bg, x.en, x.rule, x.cond, coalesce(x.checklist, '[]'::jsonb), coalesce(x.deps, '{}'), x.pos
    from (values
      ('payments',   'payment_first',   'Плащане',                           'Payment',                    'payment_first',   null,                   null::jsonb, null::text[], 1),
      ('payments',   'invoice_advance', 'Фактура за аванс',                  'Advance invoice',            'invoice_advance', 'payment:split',        null, null, 2),
      ('payments',   'payment_final',   'Финално плащане',                   'Final payment',              'payment_final',   'payment:split',        null, null, 3),
      ('payments',   'invoice_final',   'Финална фактура',                   'Final invoice',              'invoice_final',   'payment:split',        null, null, 4),
      ('payments',   'invoice_full',    'Фактура',                           'Invoice',                    'invoice_full',    'payment:full',         null, null, 5),
      ('formula',    'formulas_confirmed', 'Финални формули потвърдени от клиента', 'Final formulas confirmed by the client', null, null, null, null, 1),
      ('formula',    'recipes_approved', 'Рецептури одобрени',               'Recipes approved',           'recipes_approved', null,                  null, null, 2),
      ('design',     'label_design',    'Дизайн на етикет',                  'Label design',               null,              'service:label_design', null, null, 1),
      ('design',     'label_approved',  'Етикет одобрен от клиента',         'Label approved by the client', null,            null,                   null, null, 2),
      ('design',     'label_check',     'Регулаторна проверка на етикета',   'Regulatory check of the label', null,           null,
        '[{"bg": "Здравни претенции (Рег. 1924/2006)", "en": "Health claims (Reg. 1924/2006)"},
          {"bg": "NRV и дози", "en": "NRV and doses"},
          {"bg": "Novel Food статус на съставките", "en": "Novel Food status of the ingredients"},
          {"bg": "Алергени", "en": "Allergens"},
          {"bg": "Задължителни текстове", "en": "Mandatory texts"},
          {"bg": "Език на пазара", "en": "Language of the market"}]'::jsonb, null, 3),
      ('materials',  'materials_available', 'Наличност на суровините',       'Raw materials in stock',     'materials_available', null,              null, null, 1),
      ('materials',  'shortfall_delivered', 'Липсващи суровини доставени',   'Missing raw materials delivered', 'shortfall_delivered', null,        null, null, 2),
      ('materials',  'materials_reserved', 'Суровини резервирани',           'Raw materials reserved',     'materials_reserved', null,               null, null, 3),
      ('materials',  'packaging_reserved', 'Опаковки резервирани',           'Packaging reserved',         'packaging_reserved', null,               null, null, 4),
      ('materials',  'labels_received', 'Етикети отпечатани и получени',     'Labels printed and received', null,             null,                   null, null, 5),
      ('production', 'sent_to_production', 'Изпратена към производството',   'Sent to production',         'sent_to_production', null,               null, null, 1),
      ('production', 'in_production',   'В производство',                    'In production',              'in_production',   null,                   null, null, 2),
      ('production', 'consumption_reported', 'Отчет на вложеното по лотове', 'Usage reported by lot',      'consumption_reported', null,             null, null, 3),
      ('production', 'qc_released',     'QC освобождаване на партидата',     'Batch released by QC',       'qc_released',     null,                   null, null, 4),
      ('dispatch',   'client_info',     'Информация за клиента',             'Client information',         null,              null,
        '[{"bg": "Данни за фактуриране и ДДС номер", "en": "Billing details and VAT number"},
          {"bg": "Адрес за доставка", "en": "Delivery address"},
          {"bg": "Лице за контакт", "en": "Contact person"},
          {"bg": "Изисквания за етикета на езика на пазара", "en": "Label requirements in the language of the market"},
          {"bg": "Предпочитан превозвач", "en": "Preferred carrier"}]'::jsonb, null, 1),
      ('dispatch',   'free_sale',       'Free Sale Certificate',             'Free Sale Certificate',      null,              'service:free_sale',    null, null, 2),
      ('dispatch',   'coa',             'Сертификат за анализ (COA)',        'Certificate of analysis (COA)', 'coa_ready',    null,                   null, null, 3),
      ('dispatch',   'dispatch',        'Експедиция',                        'Dispatch',                   null,              null,                   null,
        array['payment_final', 'qc_released', 'client_info'], 4)
    ) as x(col, key, bg, en, rule, cond, checklist, deps, pos);

  -- Repeat order and Export outside the EU: copies of the default
  insert into public.order_task_templates (name_bg, name_en) values ('Повторна поръчка', 'Repeat order') returning id into v_rep;
  insert into public.order_task_templates (name_bg, name_en) values ('Износ извън ЕС', 'Export outside the EU') returning id into v_exp;
  foreach t in array array[v_rep, v_exp] loop
    for c in select * from public.order_task_template_columns where template_id = v_pl loop
      insert into public.order_task_template_columns (template_id, system_key, name_bg, name_en, color, position)
      values (t, c.system_key, c.name_bg, c.name_en, c.color, c.position) returning id into v_col;
      insert into public.order_task_template_items
        (template_id, column_id, key, title_bg, title_en, auto_rule, prefill_rule, condition, default_checklist, depends_on, position)
      select t, v_col, key, title_bg, title_en, auto_rule,
             case when t = v_rep and key = 'formulas_confirmed' then 'recipe_unchanged' end,
             condition, default_checklist, depends_on, position
        from public.order_task_template_items where column_id = c.id;
    end loop;
  end loop;

  -- Export: Transport before Documents & dispatch
  update public.order_task_template_columns set position = 7 where template_id = v_exp and system_key = 'dispatch';
  insert into public.order_task_template_columns (template_id, name_bg, name_en, color, position)
  values (v_exp, 'Транспорт', 'Transport', 'blue', 6) returning id into v_col;
  insert into public.order_task_template_items (template_id, column_id, key, title_bg, title_en, position) values
    (v_exp, v_col, 'transport_quote', 'Оферта за транспорт', 'Transport quote', 1),
    (v_exp, v_col, 'export_declaration', 'Износна декларация', 'Export declaration', 2),
    (v_exp, v_col, 'cmr', 'CMR и придружителни документи', 'CMR and accompanying documents', 3);
end
$$;

-- ---------------------------------------------------------------------
-- The rules of part 3 (replaced there): nothing to tick yet
-- ---------------------------------------------------------------------
create or replace function public.order_tasks_sync(p_order uuid, p_source text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  return;
end
$$;
revoke execute on function public.order_tasks_sync(uuid, text) from public, anon, authenticated;

-- Service lines the template knows (Free Sale Certificate, label design, analysis)
create or replace function public.order_service_kind(p_description text)
returns text
language sql immutable set search_path = public
as $$
  select case
    when p_description ~* '(free\s*sale|свободна\s+продажба)' then 'free_sale'
    when p_description ~* '(label|етикет).*(design|дизайн)|(design|дизайн).*(label|етикет)' then 'label_design'
    when p_description ~* '(certificate\s+of\s+analysis|\mcoa\M|сертификат\s+за\s+анализ)' then 'coa'
  end
$$;
revoke execute on function public.order_service_kind(text) from public, anon;

-- ---------------------------------------------------------------------
-- Board from a template (internal; called by confirm_order_payment)
-- ---------------------------------------------------------------------
create or replace function public.create_order_task_board(p_order uuid, p_template uuid, p_mode text, p_pct numeric)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_board    uuid;
  v_tpl      uuid;
  v_services text[];
  v_col      uuid;
  v_task     uuid;
  v_disp     uuid;
  v_title    text;
  v_title_en text;
  c          record;
  i          record;
  s          record;
  d          record;
begin
  select id into v_board from public.order_task_boards where sales_order_id = p_order;
  if v_board is not null then
    return v_board;
  end if;
  v_tpl := coalesce(p_template, (select id from public.order_task_templates where is_default and active limit 1));
  if not exists (select 1 from public.order_task_templates where id = v_tpl and active) then
    raise exception 'Choose an active task template';
  end if;

  insert into public.order_task_boards (sales_order_id, template_id, payment_mode)
  values (p_order, v_tpl, p_mode) returning id into v_board;

  select coalesce(array_agg(distinct public.order_service_kind(description)) filter (where public.order_service_kind(description) is not null), '{}')
    into v_services
    from public.sales_order_lines where order_id = p_order and kind = 'service';

  for c in select * from public.order_task_template_columns where template_id = v_tpl order by position loop
    insert into public.order_task_columns (board_id, template_column_id, system_key, name_bg, name_en, color, position, hidden)
    values (v_board, c.id, c.system_key, c.name_bg, c.name_en, c.color, c.position, c.hidden)
    returning id into v_col;
    if c.system_key = 'dispatch' then
      v_disp := v_col;
    end if;
    for i in select * from public.order_task_template_items where column_id = c.id order by position loop
      continue when i.condition = 'payment:split' and p_mode <> 'split';
      continue when i.condition = 'payment:full' and p_mode <> 'full';
      continue when i.condition like 'service:%' and not (substr(i.condition, 9) = any (v_services));
      v_title := i.title_bg;
      v_title_en := i.title_en;
      if i.auto_rule = 'payment_first' then
        v_title := case when p_mode = 'full' then 'Плащане 100%' else 'Аванс ' || trim_scale(p_pct) || '%' end;
        v_title_en := case when p_mode = 'full' then 'Payment 100%' else 'Advance ' || trim_scale(p_pct) || '%' end;
      end if;
      insert into public.order_tasks (board_id, column_id, template_key, title, title_en, kind, auto_rule, prefill_rule, position)
      values (v_board, v_col, i.key, v_title, v_title_en, case when i.auto_rule is null then 'manual' else 'auto' end,
              i.auto_rule, i.prefill_rule, i.position)
      returning id into v_task;
      insert into public.order_task_checklist_items (task_id, text, text_en, position)
      select v_task, x.value ->> 'bg', x.value ->> 'en', x.ordinality
        from jsonb_array_elements(i.default_checklist) with ordinality x
       where nullif(btrim(x.value ->> 'bg'), '') is not null;
    end loop;
  end loop;

  -- Waits-for between the tasks made (a key the order has no task for is skipped)
  for d in
    select k.id as task_id, o.id as on_id
      from public.order_task_template_items ti
      join public.order_tasks k on k.board_id = v_board and k.template_key = ti.key
      cross join lateral unnest(ti.depends_on) dep(key)
      join public.order_tasks o on o.board_id = v_board and o.template_key = dep.key
     where ti.template_id = v_tpl
  loop
    insert into public.order_task_dependencies values (d.task_id, d.on_id) on conflict do nothing;
  end loop;

  -- Services the template has no task for: one manual task each, in Documents & dispatch
  v_disp := coalesce(v_disp, (select id from public.order_task_columns where board_id = v_board order by position desc limit 1));
  for s in select * from public.sales_order_lines where order_id = p_order and kind = 'service'
                and public.order_service_kind(description) is null order by sort_order loop
    insert into public.order_tasks (board_id, column_id, template_key, title, kind, position)
    values (v_board, v_disp, 'service', s.description, 'manual',
            coalesce((select max(position) from public.order_tasks where column_id = v_disp), 0) + 1);
  end loop;

  -- The payment that made the board
  select id into v_task from public.order_tasks where board_id = v_board and auto_rule = 'payment_first';
  if v_task is not null then
    update public.order_tasks set status = 'done', completed_at = now(), completed_by = auth.uid() where id = v_task;
    perform public.order_task_log(v_task, 'auto_done', jsonb_build_object('source', 'payment_confirmed'));
  end if;
  perform public.order_tasks_sync(p_order, 'board_created');
  return v_board;
end
$$;
revoke execute on function public.create_order_task_board(uuid, uuid, text, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------
-- unpaid -> confirmed: an advance (deposit between 0 and 100 %) records
-- only the deposit; otherwise the order is paid in full, as before.
create or replace function public.sales_orders_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_admin boolean := public.has_role('admin');
begin
  if tg_op = 'INSERT' then
    if new.code is null or new.code = '' then
      new.code := public.next_number('sales_order');
    end if;
    return new;
  end if;

  if new.client_id <> old.client_id or new.currency <> old.currency then
    raise exception 'Client and currency of an order cannot be changed';
  end if;

  if new.status <> old.status then
    if not (
      (old.status = 'draft'         and new.status in ('unpaid', 'confirmed', 'cancelled')) or
      (old.status = 'unpaid'        and new.status in ('confirmed', 'cancelled')) or
      (old.status = 'confirmed'     and new.status in ('in_production', 'draft', 'cancelled')) or
      (old.status = 'in_production' and new.status in ('ready', 'cancelled', 'confirmed')) or
      (old.status = 'ready'         and new.status = 'dispatched') or
      (old.status = 'dispatched'    and new.status = 'closed')
    ) then
      raise exception 'An order cannot go from % to %', old.status, new.status;
    end if;

    if new.status in ('unpaid', 'confirmed') and not exists (select 1 from public.sales_order_lines where order_id = new.id) then
      raise exception 'An order without products cannot be confirmed';
    end if;
    if old.status = 'unpaid' and new.status = 'confirmed' then
      if not v_admin then
        raise exception 'Only admin confirms the payment' using errcode = '42501';
      end if;
      new.deposit_received_on := coalesce(new.deposit_received_on, current_date);
      if not (coalesce(new.deposit_pct, 0) > 0 and new.deposit_pct < 100) then
        new.balance_received_on := coalesce(new.balance_received_on, current_date);
      end if;
    end if;
    -- An order with calculator offers goes back to unpaid, never to draft
    if new.status = 'draft' and exists (select 1 from public.sales_order_lines where order_id = new.id and kind <> 'offer') then
      raise exception 'An order from calculator offers cannot go back to draft';
    end if;
    if new.status = 'in_production' and coalesce(new.deposit_pct, 0) > 0
       and new.deposit_received_on is null and not v_admin then
      raise exception 'The deposit has not been received yet';
    end if;
    -- Production sees manufacturing orders only: the order is in production once one is sent to it
    if new.status = 'in_production' and not public.order_sent_to_production(new.id) then
      raise exception 'No manufacturing order of this order has been sent to production yet';
    end if;
    if old.status = 'in_production' and new.status = 'confirmed' and public.order_sent_to_production(new.id) then
      raise exception 'Production has this order; it cannot go back to confirmed';
    end if;
    if new.status = 'dispatched' and new.balance_terms = 'before_dispatch'
       and new.balance_received_on is null and not v_admin then
      raise exception 'The balance must be paid before dispatch';
    end if;

    if new.status = 'confirmed' and old.status in ('draft', 'unpaid') then
      new.confirmed_at := now();
    elsif new.status = 'draft' then
      new.confirmed_at := null;
    elsif new.status = 'dispatched' then
      new.dispatched_at := now();
    end if;
  end if;
  return new;
end
$$;

/**
 * Admin confirms the first payment: p_received 'advance' (p_pct %, default 50) or 'full'.
 * An unpaid order becomes confirmed; an order paid before the task manager keeps its status.
 * The board is made from p_template (default template when null). Returns the board;
 * when the order already has one, nothing changes and that board is returned.
 */
create or replace function public.confirm_order_payment(
  p_order uuid, p_received text, p_pct numeric default 50, p_template uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  so      public.sales_orders;
  v_board uuid;
  v_mode  text;
  v_pct   numeric;
begin
  perform public.require_role('admin');
  select * into so from public.sales_orders where id = p_order for update;
  if not found then
    raise exception 'Order not found';
  end if;
  select id into v_board from public.order_task_boards where sales_order_id = p_order;
  if v_board is not null then
    return v_board;
  end if;
  if p_received not in ('advance', 'full') then
    raise exception 'Choose what was received: an advance or 100%%';
  end if;
  v_mode := case when p_received = 'full' then 'full' else 'split' end;
  v_pct := case when v_mode = 'full' then 100 else coalesce(p_pct, 50) end;
  if v_mode = 'split' and not (v_pct > 0 and v_pct < 100) then
    raise exception 'The advance is between 1 and 99%%';
  end if;

  if so.status = 'unpaid' then
    update public.sales_orders
       set status = 'confirmed', deposit_pct = v_pct, deposit_received_on = current_date,
           balance_received_on = case when v_mode = 'full' then current_date end
     where id = p_order;
  elsif so.status in ('confirmed', 'in_production', 'ready') then
    update public.sales_orders
       set deposit_pct = v_pct, deposit_received_on = coalesce(deposit_received_on, current_date),
           balance_received_on = case when v_mode = 'full' then coalesce(balance_received_on, current_date) else balance_received_on end
     where id = p_order;
  else
    raise exception 'The payment of a % order is not confirmed here', so.status;
  end if;
  return public.create_order_task_board(p_order, p_template, v_mode, v_pct);
end
$$;

/** Admin confirms the balance of an order paid with an advance. */
create or replace function public.confirm_final_payment(p_order uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  so public.sales_orders;
begin
  perform public.require_role('admin');
  select * into so from public.sales_orders where id = p_order for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if so.status in ('draft', 'unpaid', 'cancelled') or so.deposit_received_on is null then
    raise exception 'Confirm the first payment first';
  end if;
  if so.balance_received_on is not null then
    raise exception 'The final payment is already confirmed';
  end if;
  perform set_config('nk.task_source', 'final_payment_confirmed', true);
  update public.sales_orders set balance_received_on = current_date where id = p_order;
  perform set_config('nk.task_source', '', true);
end
$$;

revoke execute on function public.confirm_order_payment(uuid, text, numeric, uuid) from public, anon;
grant execute on function public.confirm_order_payment(uuid, text, numeric, uuid) to authenticated;
revoke execute on function public.confirm_final_payment(uuid) from public, anon;
grant execute on function public.confirm_final_payment(uuid) to authenticated;
