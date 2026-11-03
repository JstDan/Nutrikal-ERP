-- =====================================================================
-- Nutrikal ERP + CRM — what is missing, computed once (owner, Nov 2026)
--
-- Bug: "Missing X" showed the whole requirement whenever nothing was
-- reserved, although free stock covered it (MO-00005: 25.2 kg needed,
-- 428 kg free, "missing 25.2 kg"). Every place had its own sum.
--
-- Now one rule, per item (raw materials, excipients, packaging):
--   missing = max(0, needed - reserved for it - free - requested - ordered)
--   free      = usable stock (released, not expired) less every active
--               reservation (item_stock_summary.available), never below 0
--   requested = open purchase requests made for it (not yet ordered)
--   ordered   = what is still to arrive on open expected deliveries of
--               its requests (an ordered request has its delivery)
-- material_shortage() is that rule; everything below uses it:
--   * mo_material_requirements: a column "short" (the MO page, its
--     simulations, the production list);
--   * create_purchase_requests ("Request what is missing"): requests only
--     the real shortage, never again what is requested or ordered;
--   * reserve_mo_materials ("Reserve free stock"): reserves
--     min(needed, free) as before; the shortage follows from it;
--   * version_material_stock: the "Stock for N packs" block of a recipe;
--   * order_material_shortages: per order (its batches and lines not yet
--     planned, its own and its batches' requests); order_material_lines
--     (the task "Raw material availability") and
--     create_order_shortfall_requests use it;
--   * purchase_shortages (Доставки, "Missing raw materials"): an open
--     request counts only up to the real shortage of its batch or order.
-- "Requested" in mo_material_requirements is now open requests only; an
-- ordered request counts as "ordered" (it was counted twice before).
--
-- Production: mo_material_requirements still returns no free stock,
-- requests or shortage to it (null), as before. The new functions are for
-- admin and sales only.
-- =====================================================================

create or replace function public.material_shortage(
  p_required numeric, p_reserved numeric, p_free numeric, p_requested numeric, p_ordered numeric)
returns numeric
language sql immutable
as $$
  select round(greatest(0, coalesce(p_required, 0) - coalesce(p_reserved, 0) - greatest(coalesce(p_free, 0), 0)
                           - coalesce(p_requested, 0) - coalesce(p_ordered, 0)), 4)
$$;
grant execute on function public.material_shortage(numeric, numeric, numeric, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- A manufacturing order
-- ---------------------------------------------------------------------
drop function public.mo_material_requirements(uuid);
create function public.mo_material_requirements(p_mo uuid)
returns table (
  item_id uuid, sku text, name text, name_bg text, kind text, base_unit public.base_unit,
  required numeric, reserved numeric, available numeric, at_production numeric, requested numeric, ordered numeric,
  short numeric
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_prod   boolean := public.has_role('production');
  v_status public.mo_status;
begin
  if not public.has_role('admin', 'sales', 'production') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select status into v_status from public.manufacturing_orders where id = p_mo;
  if v_status is null or (v_prod and v_status not in ('released', 'in_production', 'completed')) then
    raise exception 'Unknown manufacturing order';
  end if;
  return query
    with q as (
      select r.item_id, r.kind, r.required,
             coalesce((select sum(sr.quantity) from public.stock_reservations sr
                        where sr.manufacturing_order_id = p_mo and sr.item_id = r.item_id and sr.status = 'active'), 0) as reserved,
             greatest(coalesce((select s.available from public.item_stock_summary s where s.item_id = r.item_id), 0), 0) as free,
             coalesce((select sum(pr.quantity) from public.purchase_requests pr
                        where pr.manufacturing_order_id = p_mo and pr.item_id = r.item_id and pr.status = 'open'), 0) as requested,
             coalesce((select sum(o.remaining) from public.expected_delivery_overview o
                         join public.purchase_requests pr on pr.id = o.purchase_request_id
                        where pr.manufacturing_order_id = p_mo and o.item_id = r.item_id and o.status = 'open'), 0) as ordered
        from public.mo_required_materials(p_mo) r
    )
    select q.item_id, i.sku, i.name, i.name_bg, q.kind, i.base_unit, q.required, q.reserved,
           case when v_prod then null else q.free end,
           coalesce((select sum(b.quantity) from public.stock_balances b
                      where b.item_id = q.item_id and b.qc_status = 'released' and not b.is_expired
                        and public.is_production_location(b.location_id)), 0),
           case when v_prod then null else q.requested end,
           q.ordered,
           case when v_prod then null else public.material_shortage(q.required, q.reserved, q.free, q.requested, q.ordered) end
      from q
      join public.items i on i.id = q.item_id
     order by q.kind, i.name;
end
$$;
revoke execute on function public.mo_material_requirements(uuid) from public, anon;
grant execute on function public.mo_material_requirements(uuid) to authenticated;

-- "Request what is missing": only the real shortage, nothing twice
create or replace function public.create_purchase_requests(p_mo uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  mo  public.manufacturing_orders;
  r   record;
  v_n integer := 0;
begin
  perform public.require_role('admin', 'sales');
  select * into mo from public.manufacturing_orders where id = p_mo;
  if mo.status in ('completed', 'cancelled') then
    raise exception 'This manufacturing order is closed';
  end if;
  for r in select * from public.mo_material_requirements(p_mo) loop
    if r.short > 0 then
      insert into public.purchase_requests (item_id, quantity, needed_by, manufacturing_order_id, note)
      values (r.item_id, r.short, mo.planned_date, p_mo, 'Production ' || mo.code);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;

-- ---------------------------------------------------------------------
-- A recipe: "Stock for N packs" (nothing reserved or requested for it)
-- ---------------------------------------------------------------------
create or replace function public.version_material_stock(p_version uuid, p_packs numeric)
returns table (item_id uuid, kind text, required numeric, free numeric, short numeric)
language sql stable security definer set search_path = public
as $$
  select r.item_id, r.kind, r.required, greatest(coalesce(s.available, 0), 0),
         public.material_shortage(r.required, 0, s.available, 0, 0)
    from public.version_required_materials(p_version, p_packs) r
    left join public.item_stock_summary s on s.item_id = r.item_id
   where public.has_role('admin', 'sales')
$$;
revoke execute on function public.version_material_stock(uuid, numeric) from public, anon;
grant execute on function public.version_material_stock(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- A sales order: its batches and its lines not yet planned
-- ---------------------------------------------------------------------
create or replace function public.order_material_shortages(p_order uuid)
returns table (item_id uuid, kind text, required numeric, reserved numeric, free numeric,
               requested numeric, ordered numeric, short numeric)
language sql stable security definer set search_path = public
as $$
  with n as (select * from public.order_material_needs(p_order)),
  reqs as (
    select pr.id, pr.item_id, pr.quantity, pr.status
      from public.purchase_requests pr
     where pr.status in ('open', 'ordered')
       and (pr.sales_order_id = p_order
            or pr.manufacturing_order_id in (
                 select mo.id from public.manufacturing_orders mo join public.sales_order_lines l on l.id = mo.sales_order_line_id
                  where l.order_id = p_order and mo.status <> 'cancelled'))
  ),
  x as (
    select n.item_id, n.kind, n.required, n.reserved,
           greatest(coalesce(s.available, 0), 0) as free,
           coalesce((select sum(r.quantity) from reqs r where r.item_id = n.item_id and r.status = 'open'), 0) as requested,
           coalesce((select sum(o.remaining) from public.expected_delivery_overview o join reqs r on r.id = o.purchase_request_id
                      where o.item_id = n.item_id and o.status = 'open'), 0) as ordered
      from n left join public.item_stock_summary s on s.item_id = n.item_id
  )
  select x.*, public.material_shortage(x.required, x.reserved, x.free, x.requested, x.ordered) from x
$$;
revoke execute on function public.order_material_shortages(uuid) from public, anon, authenticated;

-- One availability line per material, worst first (the task "Raw material availability")
create or replace function public.order_material_lines(p_order uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with s as (
    select m.*, i.sku, i.name, i.name_bg, i.base_unit,
           case when public.material_shortage(m.required, m.reserved, m.free, 0, 0) <= 0 then 'ok'
                when m.short <= 0 then 'short_incoming'
                else 'short_no_order' end as status,
           inc.incoming_on, inc.incoming_ref
      from public.order_material_shortages(p_order) m
      join public.items i on i.id = m.item_id
      left join lateral (
        select min(d.expected_on) as incoming_on,
               string_agg(coalesce(d.po_reference, d.code), ', ' order by d.expected_on nulls last, d.code) as incoming_ref
          from public.expected_deliveries d
         where d.item_id = m.item_id and d.status = 'open'
      ) inc on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', item_id, 'sku', sku, 'name', name, 'name_bg', name_bg, 'kind', kind, 'unit', base_unit,
           'required', round(required, 4), 'reserved', round(reserved, 4), 'free', round(free, 4),
           'incoming', round(requested + ordered, 4), 'incoming_on', incoming_on, 'incoming_ref', incoming_ref,
           'short', short, 'status', status)
         order by array_position(array['short_no_order', 'short_incoming', 'ok'], status), kind <> 'ingredient', name), '[]')
    from s
$$;
revoke execute on function public.order_material_lines(uuid) from public, anon, authenticated;

-- "Request what is missing" of an order: its batches first, then the lines not yet planned
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
  -- Lines not planned yet: the shortage of the order, at most what those lines need
  for r in
    with unplanned as (
      select q.item_id, sum(q.required) as required
        from public.sales_order_lines l
        cross join lateral public.version_required_materials(l.formula_version_id, l.quantity) q
       where l.order_id = p_order and l.kind <> 'service' and l.formula_version_id is not null
         and not exists (select 1 from public.manufacturing_orders mo where mo.sales_order_line_id = l.id and mo.status <> 'cancelled')
       group by q.item_id
    )
    select u.item_id, u.required, s.short
      from unplanned u join public.order_material_shortages(p_order) s on s.item_id = u.item_id
     where s.short > 0
  loop
    v_req := round(least(r.short, r.required), 4);
    if v_req > 0 then
      insert into public.purchase_requests (item_id, quantity, sales_order_id, note)
      values (r.item_id, v_req, p_order, 'Order ' || so.code);
      v_n := v_n + 1;
    end if;
  end loop;
  perform public.order_tasks_refresh(p_order, 'purchase_request');
  return v_n;
end
$$;
revoke execute on function public.create_order_shortfall_requests(uuid) from public, anon;
grant execute on function public.create_order_shortfall_requests(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Доставки, "Missing raw materials": a request counts up to the real
-- shortage of its batch or order (without itself)
-- ---------------------------------------------------------------------
-- How much of an open request is still a real shortage of its batch or order (the request itself
-- left out), at most its quantity. A request made by hand (no batch, no order) counts in full.
create or replace function public.purchase_request_still_short(p_request uuid)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare
  pr public.purchase_requests;
  v  numeric;
begin
  if not (public.has_role('admin') or public.can_see_purchase_prices()) then
    return null;
  end if;
  select * into pr from public.purchase_requests where id = p_request;
  if not found then
    return null;
  end if;
  if pr.manufacturing_order_id is not null then
    with q as (
      select r.item_id, r.required,
             coalesce((select sum(sr.quantity) from public.stock_reservations sr
                        where sr.manufacturing_order_id = pr.manufacturing_order_id and sr.item_id = r.item_id and sr.status = 'active'), 0) as reserved
        from public.mo_required_materials(pr.manufacturing_order_id) r where r.item_id = pr.item_id
    )
    select public.material_shortage(q.required, q.reserved, s.available,
             coalesce((select sum(x.quantity) from public.purchase_requests x
                        where x.manufacturing_order_id = pr.manufacturing_order_id and x.item_id = pr.item_id
                          and x.status = 'open' and x.id <> pr.id), 0),
             coalesce((select sum(o.remaining) from public.expected_delivery_overview o
                         join public.purchase_requests x on x.id = o.purchase_request_id
                        where x.manufacturing_order_id = pr.manufacturing_order_id and o.item_id = pr.item_id and o.status = 'open'), 0))
      into v
      from q left join public.item_stock_summary s on s.item_id = q.item_id;
  elsif pr.sales_order_id is not null then
    select public.material_shortage(s.required, s.reserved, s.free, s.requested - pr.quantity, s.ordered)
      into v from public.order_material_shortages(pr.sales_order_id) s where s.item_id = pr.item_id;
  else
    return pr.quantity;
  end if;
  return least(pr.quantity, coalesce(v, 0));
end
$$;
revoke execute on function public.purchase_request_still_short(uuid) from public, anon;
grant execute on function public.purchase_request_still_short(uuid) to authenticated;

create or replace view public.purchase_shortages
with (security_invoker = true) as
with draft_lines as (
  select l.item_id, l.purchase_request_id
    from public.purchase_order_lines l join public.purchase_orders o on o.id = l.purchase_order_id
   where o.status = 'draft'
),
open_req as (
  select pr.*, coalesce(public.purchase_request_still_short(pr.id), pr.quantity) as still_short
    from public.purchase_requests pr
   where pr.status = 'open'
     and pr.id not in (select purchase_request_id from draft_lines where purchase_request_id is not null)
),
need as (
  select 'request'::text as source, r.id as purchase_request_id, r.code as request_code, r.item_id,
         r.still_short as quantity, r.needed_by
    from open_req r
   where r.still_short > 0
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
