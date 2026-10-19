-- =====================================================================
-- Nutrikal ERP + CRM — Phase 3 — 0013 packaging on formulas, lot costs,
-- batch costs
--
-- * Packaging (jars, caps, labels…) belongs to the formula version, per
--   pack. New offers and stand-alone manufacturing orders start from it.
-- * Every lot has a cost per base unit (lot_costs): on receipt it is the
--   current purchase price; staff can enter the actual landed cost.
--   Kept in its own table so the partner, who can read lots at its
--   facility, never sees a price.
-- * Batch cost = materials actually consumed × the cost of those lots
--   + the partner's invoices. The finished-goods lot gets cost / unit.
--   Consumption without a lot cost is valued at the current purchase
--   price and marked as estimated.
-- * Costs are visible to users who may see purchase prices only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Packaging per formula version
-- ---------------------------------------------------------------------
create table public.formula_packaging (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references public.formula_versions (id) on delete cascade,
  item_id       uuid not null references public.items (id),
  qty_per_pack  numeric(12, 4) not null default 1 check (qty_per_pack > 0),
  unique (version_id, item_id)
);
select public.enable_audit('public.formula_packaging');

create or replace function public.formula_packaging_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_status public.formula_status;
begin
  select status into v_status from public.formula_versions
   where id = case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  if v_status is null and tg_op = 'DELETE' then
    return old;
  end if;
  if v_status <> 'draft' then
    raise exception 'This formula version is %; only drafts can be changed. Create a new version instead.', v_status;
  end if;
  if tg_op <> 'DELETE' and (select type from public.items where id = new.item_id) <> 'packaging' then
    raise exception 'Only packaging items can be added as packaging';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger formula_packaging_guard before insert or update or delete on public.formula_packaging
  for each row execute function public.formula_packaging_guard();

alter table public.formula_packaging enable row level security;
create policy formula_packaging_select on public.formula_packaging for select to authenticated
  using (public.is_staff());
create policy formula_packaging_write on public.formula_packaging for all to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));

-- A new version also copies the packaging
create or replace function public.new_formula_version(p_formula uuid, p_change_note text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_src   public.formula_versions;
  v_new   uuid;
  v_draft integer;
begin
  perform public.require_role('admin', 'sales');

  select version into v_draft from public.formula_versions where formula_id = p_formula and status = 'draft';
  if found then
    raise exception 'This formula already has a draft (version %)', v_draft;
  end if;

  select * into v_src from public.formula_versions
   where formula_id = p_formula order by version desc limit 1;
  if not found then
    raise exception 'Unknown formula';
  end if;

  insert into public.formula_versions (formula_id, version, shelf_life_months, notes, change_note, created_by)
  values (p_formula, v_src.version + 1, v_src.shelf_life_months, v_src.notes, p_change_note, auth.uid())
  returning id into v_new;

  insert into public.formula_lines (version_id, item_id, amount, unit, overage_pct, sort_order, notes)
  select v_new, item_id, amount, unit, overage_pct, sort_order, notes
    from public.formula_lines where version_id = v_src.id;

  insert into public.formula_version_claims (version_id, claim_id)
  select v_new, claim_id from public.formula_version_claims where version_id = v_src.id;

  insert into public.formula_packaging (version_id, item_id, qty_per_pack)
  select v_new, item_id, qty_per_pack from public.formula_packaging where version_id = v_src.id;

  return v_new;
end
$$;

-- New offers start with the formula's packaging
create or replace function public.offers_default_packaging()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.offer_packaging (offer_id, item_id, qty_per_pack)
  select new.id, item_id, qty_per_pack from public.formula_packaging where version_id = new.formula_version_id
  on conflict do nothing;
  return null;
end
$$;

create trigger offers_default_packaging after insert on public.offers
  for each row execute function public.offers_default_packaging();

-- Manufacturing orders: packaging from the order's offer, else from the formula
create or replace function public.manufacturing_orders_packaging()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.sales_order_line_id is not null then
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

-- ---------------------------------------------------------------------
-- Lot costs
-- ---------------------------------------------------------------------
create table public.lot_costs (
  lot_id      uuid primary key references public.lots (id) on delete cascade,
  unit_cost   numeric(14, 6) not null check (unit_cost >= 0),        -- per base unit of the item
  currency    char(3) not null default 'EUR',
  source      text not null check (source in ('supplier_price', 'receipt', 'production', 'manual')),
  updated_by  uuid default auth.uid() references public.profiles (id),
  updated_at  timestamptz not null default now()
);
select public.enable_audit('public.lot_costs');

alter table public.lot_costs enable row level security;
create policy lot_costs_select on public.lot_costs for select to authenticated
  using (public.can_see_purchase_prices());
create policy lot_costs_write on public.lot_costs for all to authenticated
  using (public.has_role('admin', 'inventory')) with check (public.has_role('admin', 'inventory'));

-- On receipt: the current purchase price, when there is one
create or replace function public.lots_default_cost()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_price numeric;
begin
  if (select type from public.items where id = new.item_id) = 'finished_good' then
    return null;   -- set from the batch cost
  end if;
  v_price := public.item_unit_price(new.item_id, 0);
  if v_price is not null then
    insert into public.lot_costs (lot_id, unit_cost, source) values (new.id, v_price, 'supplier_price')
    on conflict do nothing;
  end if;
  return null;
end
$$;

create trigger lots_default_cost after insert on public.lots
  for each row execute function public.lots_default_cost();

-- Staff enter the actual landed cost of a lot
create or replace function public.set_lot_cost(p_lot uuid, p_unit_cost numeric)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'inventory');
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'Enter a cost of zero or more';
  end if;
  insert into public.lot_costs (lot_id, unit_cost, source, updated_by, updated_at)
  values (p_lot, p_unit_cost, 'receipt', auth.uid(), now())
  on conflict (lot_id) do update
    set unit_cost = excluded.unit_cost, source = 'receipt', updated_by = auth.uid(), updated_at = now();
end
$$;

-- ---------------------------------------------------------------------
-- Consumption is linked to its manufacturing order
-- ---------------------------------------------------------------------
alter table public.stock_movements
  add column manufacturing_order_id uuid references public.manufacturing_orders (id);
create index stock_movements_mo_idx on public.stock_movements (manufacturing_order_id);

-- ---------------------------------------------------------------------
-- Batch cost
-- ---------------------------------------------------------------------

-- Cost lines of a manufacturing order (internal). Completed: what was
-- consumed, at lot cost (estimated at the current purchase price when a
-- lot has no cost). Not completed: planned, at the current purchase price.
create or replace function public.mo_cost_lines(p_mo uuid)
returns table (
  item_id uuid, lot_id uuid, lot_number text, quantity numeric, unit_cost numeric, cost numeric, estimated boolean
)
language sql stable security definer set search_path = public
as $$
  select m.item_id, m.lot_id, l.lot_number, -m.quantity,
         coalesce(lc.unit_cost, public.item_unit_price(m.item_id, 0)),
         -m.quantity * coalesce(lc.unit_cost, public.item_unit_price(m.item_id, 0)),
         lc.unit_cost is null
    from public.stock_movements m
    join public.lots l on l.id = m.lot_id
    left join public.lot_costs lc on lc.lot_id = m.lot_id
   where m.manufacturing_order_id = p_mo and m.type = 'consumption'
     and (select status from public.manufacturing_orders where id = p_mo) = 'completed'
  union all
  select r.item_id, null, null, r.required, public.item_unit_price(r.item_id, r.required),
         r.required * public.item_unit_price(r.item_id, r.required), true
    from public.mo_required_materials(p_mo) r
   where (select status from public.manufacturing_orders where id = p_mo) <> 'completed'
$$;

-- Totals: materials, partner invoices, total and per pack
create or replace function public.mo_cost_summary(p_mo uuid)
returns table (
  is_actual boolean, material_cost numeric, estimated_lines integer, missing_prices integer,
  partner_cost numeric, total_cost numeric, packs integer, cost_per_pack numeric
)
language sql stable security definer set search_path = public
as $$
  with mo as (select * from public.manufacturing_orders where id = p_mo),
  c as (select coalesce(sum(cost), 0) as material, count(*) filter (where estimated)::int as est,
               count(*) filter (where cost is null)::int as missing
          from public.mo_cost_lines(p_mo)),
  inv as (select coalesce(sum(amount), 0) as partner from public.production_invoices where mo_id = p_mo)
  select mo.status = 'completed', c.material, c.est, c.missing, inv.partner, c.material + inv.partner,
         coalesce(mo.produced_quantity, mo.quantity),
         round((c.material + inv.partner) / nullif(coalesce(mo.produced_quantity, mo.quantity), 0), 6)
    from mo, c, inv
$$;

-- Role-checked versions for the app
create or replace function public.mo_costs(p_mo uuid)
returns table (
  item_id uuid, sku text, name text, name_bg text, base_unit public.base_unit, lot_number text,
  quantity numeric, unit_cost numeric, cost numeric, estimated boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.can_see_purchase_prices() then
    raise exception 'Not allowed to see purchase prices' using errcode = '42501';
  end if;
  return query
    select c.item_id, i.sku, i.name, i.name_bg, i.base_unit, c.lot_number, round(c.quantity, 4),
           round(c.unit_cost, 6), round(c.cost, 4), c.estimated
      from public.mo_cost_lines(p_mo) c join public.items i on i.id = c.item_id
     order by i.type, i.name, c.lot_number;
end
$$;

create or replace function public.mo_cost(p_mo uuid)
returns table (
  is_actual boolean, material_cost numeric, estimated_lines integer, missing_prices integer,
  partner_cost numeric, total_cost numeric, packs integer, cost_per_pack numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.can_see_purchase_prices() then
    raise exception 'Not allowed to see purchase prices' using errcode = '42501';
  end if;
  return query select * from public.mo_cost_summary(p_mo);
end
$$;

-- The finished-goods lot carries the batch cost per pack
create or replace function public.update_batch_cost(p_mo uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_lot  uuid;
  v_cost numeric;
begin
  select finished_lot_id into v_lot from public.manufacturing_orders where id = p_mo and status = 'completed';
  if v_lot is null then
    return;
  end if;
  select cost_per_pack into v_cost from public.mo_cost_summary(p_mo);
  if v_cost is not null then
    insert into public.lot_costs (lot_id, unit_cost, source, updated_at) values (v_lot, v_cost, 'production', now())
    on conflict (lot_id) do update set unit_cost = excluded.unit_cost, source = 'production', updated_at = now();
  end if;
end
$$;

create or replace function public.production_invoices_cost()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.update_batch_cost(case when tg_op = 'DELETE' then old.mo_id else new.mo_id end);
  return null;
end
$$;

create trigger production_invoices_cost after insert or update or delete on public.production_invoices
  for each row execute function public.production_invoices_cost();

-- Same as 0012, plus: consumption linked to the order, batch cost on the finished lot
create or replace function public.complete_production(
  p_mo           uuid,
  p_batch        text,
  p_quantity     integer,
  p_produced_on  date,
  p_consumption  jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  mo        public.manufacturing_orders;
  v_partner boolean := public.has_role('partner');
  c         record;
  v_item    uuid;
  v_fg      uuid;
  v_lot     uuid;
  v_shelf   integer;
  v_fg_loc  uuid;
  v_project public.projects;
  v_formula public.formulas;
begin
  perform public.require_role('admin', 'inventory', 'partner');
  select * into mo from public.manufacturing_orders where id = p_mo;
  if mo.status not in ('released', 'in_production') then
    raise exception 'Only an order sent to the partner can be completed';
  end if;
  if nullif(btrim(p_batch), '') is null then
    raise exception 'Enter the batch number';
  end if;
  if exists (select 1 from public.lots where lot_number = btrim(p_batch)) then
    raise exception 'Batch number % is already used', btrim(p_batch);
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Enter the quantity made';
  end if;
  if jsonb_typeof(p_consumption) <> 'array' or jsonb_array_length(p_consumption) = 0 then
    raise exception 'Enter the lots consumed';
  end if;

  for c in select * from jsonb_to_recordset(p_consumption) as x(lot_id uuid, location_id uuid, quantity numeric) loop
    continue when coalesce(c.quantity, 0) = 0;
    select item_id into v_item from public.lots where id = c.lot_id;
    if v_item is null or not exists (select 1 from public.mo_required_materials(p_mo) r where r.item_id = v_item) then
      raise exception 'A consumed lot is not one of the materials of this order';
    end if;
    if v_partner and not public.is_partner_location(c.location_id) then
      raise exception 'Partner can only consume stock at partner locations' using errcode = '42501';
    end if;
    insert into public.stock_movements (type, lot_id, location_id, quantity, project_id, reference, manufacturing_order_id)
    values ('consumption', c.lot_id, c.location_id, -abs(c.quantity), mo.project_id, mo.code, p_mo);
  end loop;

  select * into v_project from public.projects where id = mo.project_id;
  select f.* into v_formula from public.formulas f join public.formula_versions v on v.formula_id = f.id
   where v.id = mo.formula_version_id;
  select shelf_life_months into v_shelf from public.formula_versions where id = mo.formula_version_id;
  select id into v_fg from public.items
   where type = 'finished_good' and project_id = mo.project_id order by created_at limit 1;
  if v_fg is null then
    insert into public.items (sku, type, name, name_bg, base_unit, client_id, project_id, shelf_life_months)
    values ('FG-' || v_project.code, 'finished_good', v_formula.name, v_formula.name_bg, 'pcs',
            v_project.client_id, v_project.id, v_shelf)
    returning id into v_fg;
  end if;

  select id into v_fg_loc from public.locations where code = 'PF-FG' and is_active;
  if v_fg_loc is null then
    raise exception 'Location PF-FG (partner finished goods) is missing';
  end if;

  insert into public.lots (lot_number, item_id, manufactured_on, expires_on, received_on, project_id, notes)
  values (btrim(p_batch), v_fg, coalesce(p_produced_on, current_date),
          (coalesce(p_produced_on, current_date) + make_interval(months => coalesce(v_shelf, 24)))::date,
          coalesce(p_produced_on, current_date), mo.project_id, 'Production ' || mo.code)
  returning id into v_lot;

  insert into public.stock_movements (type, lot_id, location_id, quantity, project_id, reference, manufacturing_order_id)
  values ('production_output', v_lot, v_fg_loc, p_quantity, mo.project_id, mo.code, p_mo);

  update public.stock_reservations set status = 'consumed', closed_by = auth.uid(), closed_at = now()
   where manufacturing_order_id = p_mo and status = 'active';

  perform set_config('nk.mo_transition', 'on', true);
  update public.manufacturing_orders
     set status = 'completed', completed_at = now(), batch_number = btrim(p_batch), produced_quantity = p_quantity,
         produced_on = coalesce(p_produced_on, current_date), finished_lot_id = v_lot,
         started_at = coalesce(started_at, now())
   where id = p_mo;
  perform set_config('nk.mo_transition', 'off', true);

  perform public.update_batch_cost(p_mo);
  return v_lot;
end
$$;

revoke execute on function
  public.formula_packaging_guard(),
  public.offers_default_packaging(),
  public.lots_default_cost(),
  public.set_lot_cost(uuid, numeric),
  public.mo_cost_lines(uuid),
  public.mo_cost_summary(uuid),
  public.mo_costs(uuid),
  public.mo_cost(uuid),
  public.update_batch_cost(uuid),
  public.production_invoices_cost()
from public, anon, authenticated;

grant execute on function
  public.set_lot_cost(uuid, numeric),
  public.mo_costs(uuid),
  public.mo_cost(uuid)
to authenticated;
