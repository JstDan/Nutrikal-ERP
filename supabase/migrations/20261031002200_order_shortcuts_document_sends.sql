-- =====================================================================
-- Shortcuts (owner, Oct 2026):
--  - copy_order: a repeat order from an earlier one
--  - prepare_order_production: one step from a paid order to manufacturing
--    orders, reserved materials and purchase requests
--  - document_sends: documents e-mailed to clients, and by whom
-- =====================================================================

-- ------------------------------------------------------- repeat order
-- A new unpaid order with the same products, services, prices and terms.
-- Dates, payments, reference and transport start empty. Calculator lines
-- get their recipe and a new project when production is prepared.
create or replace function public.copy_order(p_order uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  so    public.sales_orders;
  v_id  uuid;
begin
  perform public.require_role('admin', 'sales');
  select * into so from public.sales_orders where id = p_order;
  if not found then
    raise exception 'Order not found';
  end if;

  insert into public.sales_orders (client_id, currency, status, deposit_pct, balance_terms, balance_net_days, vat_pct, notes)
  values (so.client_id, so.currency, 'unpaid', so.deposit_pct, so.balance_terms, so.balance_net_days, so.vat_pct, so.notes)
  returning id into v_id;

  perform set_config('nk.order_create', 'on', true);
  insert into public.sales_order_lines (order_id, kind, offer_id, calc_offer_id, project_id, formula_version_id,
                                        description, quantity, unit_price, sort_order)
  select v_id, l.kind, l.offer_id, l.calc_offer_id,
         case when l.kind = 'offer' then l.project_id end,
         case when l.kind = 'offer' then l.formula_version_id end,
         l.description, l.quantity, l.unit_price, l.sort_order
    from public.sales_order_lines l where l.order_id = p_order;
  perform set_config('nk.order_create', 'off', true);
  return v_id;
end
$$;

-- ------------------------------------------------- prepare production
-- For every product of a paid order: links the recipe made from its offer,
-- creates the manufacturing order, reserves what is in stock and requests
-- what is missing. With a date the orders are also scheduled. Sending to
-- Production stays a separate step (release_mo).
create or replace function public.prepare_order_production(p_order uuid, p_date date default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  so         public.sales_orders;
  l          public.sales_order_lines;
  v_mo       public.manufacturing_orders;
  v_version  uuid;
  v_created  integer := 0;
  v_reserved integer := 0;
  v_requests integer := 0;
  v_missing  text[] := '{}';
begin
  perform public.require_role('admin');
  select * into so from public.sales_orders where id = p_order;
  if not found then
    raise exception 'Order not found';
  end if;
  if so.status not in ('confirmed', 'in_production') then
    raise exception 'Confirm the payment first';
  end if;

  for l in select * from public.sales_order_lines
            where order_id = p_order and kind <> 'service' order by sort_order loop
    select * into v_mo from public.manufacturing_orders
     where sales_order_line_id = l.id and status <> 'cancelled' order by created_at desc limit 1;

    if v_mo.id is null then
      v_version := l.formula_version_id;
      if v_version is null and l.calc_offer_id is not null then
        select v.id into v_version
          from public.formulas f join public.formula_versions v on v.formula_id = f.id
         where f.calc_offer_id = l.calc_offer_id and v.status = 'approved'
         order by v.version desc limit 1;
        if v_version is not null then
          perform public.link_order_line_formula(l.id, v_version);
        end if;
      end if;
      if v_version is null then
        v_missing := v_missing || coalesce(l.description, '');
        continue;
      end if;
      insert into public.manufacturing_orders (sales_order_line_id, quantity)
      values (l.id, l.quantity) returning * into v_mo;
      v_created := v_created + 1;
    end if;

    continue when v_mo.status not in ('simulation', 'scheduled');
    if p_date is not null then
      v_reserved := v_reserved + public.schedule_mo(v_mo.id, p_date);
    else
      v_reserved := v_reserved + public.reserve_mo_materials(v_mo.id);
    end if;
    v_requests := v_requests + public.create_purchase_requests(v_mo.id);
  end loop;

  return jsonb_build_object('created', v_created, 'reserved', v_reserved, 'requested', v_requests, 'no_recipe', to_jsonb(v_missing));
end
$$;

-- --------------------------------------------------- e-mailed documents
create table public.document_sends (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('calc_offer', 'proforma', 'invoice', 'delivery_note')),
  ref_id      uuid not null,                               -- the offer, order, invoice or delivery note
  recipient   text not null,
  cc          text,
  subject     text not null,
  status      text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  error       text,
  sent_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index document_sends_ref_idx on public.document_sends (ref_id, created_at desc);

-- Production never sees it. Rows are written only by the two functions below.
alter table public.document_sends enable row level security;
create policy document_sends_select on public.document_sends for select to authenticated
  using (public.has_role('admin', 'sales'));

create or replace function public.begin_document_send(p_kind text, p_ref uuid, p_to text, p_cc text, p_subject text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_ok boolean;
  v_id uuid;
begin
  perform public.require_role('admin', 'sales');
  if coalesce(p_to, '') !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
     or (nullif(btrim(coalesce(p_cc, '')), '') is not null and p_cc !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$') then
    raise exception 'Enter a valid e-mail address';
  end if;
  if nullif(btrim(coalesce(p_subject, '')), '') is null then
    raise exception 'Enter the subject';
  end if;
  v_ok := case p_kind
    when 'calc_offer' then exists (select 1 from public.calc_offers where id = p_ref)
    when 'proforma' then exists (select 1 from public.sales_orders where id = p_ref)
    when 'invoice' then exists (select 1 from public.invoices where id = p_ref and status = 'issued')
    when 'delivery_note' then exists (select 1 from public.dispatches where id = p_ref)
    else false end;
  if not v_ok then
    raise exception 'This document cannot be sent';
  end if;
  insert into public.document_sends (kind, ref_id, recipient, cc, subject)
  values (p_kind, p_ref, btrim(p_to), nullif(btrim(coalesce(p_cc, '')), ''), btrim(p_subject))
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.finish_document_send(p_send uuid, p_error text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  update public.document_sends
     set status = case when p_error is null then 'sent' else 'failed' end, error = left(p_error, 500)
   where id = p_send and status = 'sending' and sent_by = auth.uid();
  if not found then
    raise exception 'Send not found';
  end if;
end
$$;

revoke execute on function public.copy_order(uuid) from public, anon;
revoke execute on function public.prepare_order_production(uuid, date) from public, anon;
revoke execute on function public.begin_document_send(text, uuid, text, text, text) from public, anon;
revoke execute on function public.finish_document_send(uuid, text) from public, anon;
grant execute on function public.copy_order(uuid) to authenticated;
grant execute on function public.prepare_order_production(uuid, date) to authenticated;
grant execute on function public.begin_document_send(text, uuid, text, text, text) to authenticated;
grant execute on function public.finish_document_send(uuid, text) to authenticated;
