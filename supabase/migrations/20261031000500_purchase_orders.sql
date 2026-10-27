-- Purchase orders (owner, 27 Oct 2026): admin generates them in Доставки from the missing raw
-- materials (open purchase requests and items below their minimum stock), one per supplier, edits
-- the draft, downloads it as a PDF (English or Bulgarian) and sends it: then every line becomes an
-- expected delivery with the order number, so it shows as incoming stock.
--
-- Production: no access (purchase prices and suppliers of Nutrikal's orders).

insert into public.number_series (key, label, prefix, next_number, pad_length)
values ('purchase_order', 'Purchase order', 'PO-', 1, 5)
on conflict (key) do nothing;

create type public.purchase_order_status as enum ('draft', 'sent', 'cancelled');

create table public.purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,                                  -- PO-00001
  supplier_id  uuid not null references public.suppliers (id),
  status       public.purchase_order_status not null default 'draft',
  order_date   date not null default current_date,
  expected_on  date,
  location_id  uuid references public.locations (id),                 -- where it is delivered
  currency     char(3) not null default 'EUR',
  notes        text,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  sent_by      uuid references public.profiles (id) on delete set null,
  sent_at      timestamptz
);
create index purchase_orders_status_idx on public.purchase_orders (status, order_date desc);
create trigger purchase_orders_updated_at before update on public.purchase_orders
  for each row execute function public.set_updated_at();
select public.enable_audit('public.purchase_orders');

create table public.purchase_order_lines (
  id                    uuid primary key default gen_random_uuid(),
  purchase_order_id     uuid not null references public.purchase_orders (id) on delete cascade,
  item_id               uuid not null references public.items (id),
  quantity              numeric(14, 4) not null check (quantity > 0),      -- base unit of the item
  unit_price            numeric(14, 6) check (unit_price >= 0),            -- per base unit
  purchase_request_id   uuid references public.purchase_requests (id),
  expected_delivery_id  uuid references public.expected_deliveries (id),
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now()
);
create index purchase_order_lines_po_idx on public.purchase_order_lines (purchase_order_id);
create index purchase_order_lines_request_idx on public.purchase_order_lines (purchase_request_id);
select public.enable_audit('public.purchase_order_lines');

-- Code; a sent or cancelled order is locked; the status changes only through the functions below
create or replace function public.purchase_orders_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.code is null or new.code = '' then
      new.code := public.next_number('purchase_order');
    end if;
    new.status := 'draft';
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only a draft purchase order can be deleted';
    end if;
    return old;
  end if;
  if coalesce(current_setting('nk.po_transition', true), '') <> 'on' then
    if old.status <> 'draft' then
      raise exception 'A % purchase order cannot be changed', old.status;
    end if;
    if new.status <> old.status then
      raise exception 'Send or cancel the purchase order with its buttons';
    end if;
  end if;
  if new.code <> old.code then
    raise exception 'The purchase order number cannot be changed';
  end if;
  return new;
end
$$;
create trigger purchase_orders_guard before insert or update or delete on public.purchase_orders
  for each row execute function public.purchase_orders_guard();

create or replace function public.purchase_order_lines_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_status public.purchase_order_status;
begin
  select status into v_status from public.purchase_orders
   where id = case when tg_op = 'DELETE' then old.purchase_order_id else new.purchase_order_id end;
  if v_status is null and tg_op = 'DELETE' then
    return old;  -- the order itself is being deleted
  end if;
  if v_status <> 'draft' and coalesce(current_setting('nk.po_transition', true), '') <> 'on' then
    raise exception 'A % purchase order cannot be changed', v_status;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
create trigger purchase_order_lines_guard before insert or update or delete on public.purchase_order_lines
  for each row execute function public.purchase_order_lines_guard();

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using (public.has_role('admin') or public.can_see_purchase_prices());
create policy purchase_orders_write on public.purchase_orders for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy purchase_order_lines_select on public.purchase_order_lines for select to authenticated
  using (public.has_role('admin') or public.can_see_purchase_prices());
create policy purchase_order_lines_write on public.purchase_order_lines for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

/**
 * What is missing: open purchase requests that are not on a draft order, and active raw materials,
 * excipients and packaging whose projected stock (available + on the way) is under the minimum and
 * that have neither an open request nor a draft order line. With the preferred (else first)
 * supplier and its current price.
 */
create view public.purchase_shortages
with (security_invoker = true) as
with draft_lines as (
  select l.item_id, l.purchase_request_id
    from public.purchase_order_lines l join public.purchase_orders o on o.id = l.purchase_order_id
   where o.status = 'draft'
),
need as (
  select 'request'::text as source, pr.id as purchase_request_id, pr.code as request_code, pr.item_id,
         pr.quantity, pr.needed_by
    from public.purchase_requests pr
   where pr.status = 'open'
     and pr.id not in (select purchase_request_id from draft_lines where purchase_request_id is not null)
  union all
  select 'low_stock', null, null, s.item_id, s.reorder_level - s.projected, null
    from public.item_stock_summary s join public.items i on i.id = s.item_id
   where i.is_active and i.type in ('raw_material', 'excipient', 'packaging')
     and s.reorder_level is not null and s.projected < s.reorder_level
     and not exists (select 1 from public.purchase_requests pr where pr.item_id = s.item_id and pr.status = 'open')
     and not exists (select 1 from draft_lines d where d.item_id = s.item_id)
),
pref as (
  select distinct on (si.item_id) si.item_id, si.id as supplier_item_id, si.supplier_id
    from public.supplier_items si join public.suppliers su on su.id = si.supplier_id and su.is_active
   order by si.item_id, si.is_preferred desc, si.created_at
),
price as (
  select distinct on (sp.supplier_item_id) sp.supplier_item_id, sp.price
    from public.supplier_prices sp
   where sp.valid_from <= current_date and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.supplier_item_id, sp.valid_from desc, sp.created_at desc
)
select n.source, n.purchase_request_id, n.request_code, n.item_id, i.sku, i.name, i.name_bg, i.type, i.base_unit,
       round(n.quantity, 3) as quantity, n.needed_by, s.reorder_level, s.available, s.incoming,
       p.supplier_id, su.name as supplier, pc.price as unit_price
  from need n
  join public.items i on i.id = n.item_id
  join public.item_stock_summary s on s.item_id = n.item_id
  left join pref p on p.item_id = n.item_id
  left join public.suppliers su on su.id = p.supplier_id
  left join price pc on pc.supplier_item_id = p.supplier_item_id
 where public.has_role('admin') or public.can_see_purchase_prices();
revoke insert, update, delete, truncate, references, trigger on public.purchase_shortages from anon, authenticated;

/**
 * Admin turns chosen missing lines into draft purchase orders, one per supplier.
 * p_lines: [{item_id, quantity, supplier_id, unit_price?, purchase_request_id?}]. Returns the orders.
 */
create or replace function public.generate_purchase_orders(p_lines jsonb, p_location uuid default null)
returns uuid[]
language plpgsql security definer set search_path = public
as $$
declare
  r        jsonb;
  v_sup    uuid;
  v_po     uuid;
  v_out    uuid[] := '{}';
  v_loc    uuid := coalesce(p_location, (select id from public.locations where code = 'NK-WH'));
  v_n      integer;
begin
  perform public.require_role('admin');
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Choose at least one line';
  end if;
  for r in select * from jsonb_array_elements(p_lines) loop
    if nullif(r ->> 'supplier_id', '') is null then
      raise exception 'Choose a supplier for every chosen line';
    end if;
    if coalesce((r ->> 'quantity')::numeric, 0) <= 0 then
      raise exception 'Quantity must be positive';
    end if;
  end loop;

  for v_sup in select distinct (x ->> 'supplier_id')::uuid from jsonb_array_elements(p_lines) x loop
    insert into public.purchase_orders (supplier_id, location_id) values (v_sup, v_loc) returning id into v_po;
    v_out := v_out || v_po;
    v_n := 0;
    for r in select x from jsonb_array_elements(p_lines) x where (x ->> 'supplier_id')::uuid = v_sup loop
      v_n := v_n + 1;
      insert into public.purchase_order_lines (purchase_order_id, item_id, quantity, unit_price, purchase_request_id, sort_order)
      values (v_po, (r ->> 'item_id')::uuid, (r ->> 'quantity')::numeric, nullif(r ->> 'unit_price', '')::numeric,
              nullif(r ->> 'purchase_request_id', '')::uuid, v_n);
    end loop;
  end loop;
  return v_out;
end
$$;

/** Admin sends a draft: it is locked and every line becomes an expected delivery with the order number. */
create or replace function public.send_purchase_order(p_po uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  po public.purchase_orders;
  l  public.purchase_order_lines;
begin
  perform public.require_role('admin');
  select * into po from public.purchase_orders where id = p_po for update;
  if not found then
    raise exception 'Purchase order not found';
  end if;
  if po.status <> 'draft' then
    raise exception 'The purchase order is already %', po.status;
  end if;
  if not exists (select 1 from public.purchase_order_lines where purchase_order_id = p_po) then
    raise exception 'The purchase order has no lines';
  end if;
  perform set_config('nk.po_transition', 'on', true);
  for l in select * from public.purchase_order_lines where purchase_order_id = p_po order by sort_order loop
    update public.purchase_order_lines
       set expected_delivery_id = public.create_expected_delivery(
             l.item_id, l.quantity, po.supplier_id, po.expected_on, l.unit_price, po.code, po.location_id,
             case when exists (select 1 from public.purchase_requests where id = l.purchase_request_id and status in ('open', 'ordered'))
                  then l.purchase_request_id end, null)
     where id = l.id;
  end loop;
  update public.purchase_orders set status = 'sent', sent_by = auth.uid(), sent_at = now() where id = p_po;
  perform set_config('nk.po_transition', '', true);
end
$$;

/** Admin cancels a draft (a sent order's deliveries are cancelled in Доставки). */
create or replace function public.cancel_purchase_order(p_po uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin');
  if not exists (select 1 from public.purchase_orders where id = p_po and status = 'draft') then
    raise exception 'Only a draft purchase order can be cancelled';
  end if;
  perform set_config('nk.po_transition', 'on', true);
  update public.purchase_orders set status = 'cancelled' where id = p_po;
  perform set_config('nk.po_transition', '', true);
end
$$;

revoke execute on function public.generate_purchase_orders(jsonb, uuid) from public, anon;
grant execute on function public.generate_purchase_orders(jsonb, uuid) to authenticated;
revoke execute on function public.send_purchase_order(uuid) from public, anon;
grant execute on function public.send_purchase_order(uuid) to authenticated;
revoke execute on function public.cancel_purchase_order(uuid) from public, anon;
grant execute on function public.cancel_purchase_order(uuid) to authenticated;
