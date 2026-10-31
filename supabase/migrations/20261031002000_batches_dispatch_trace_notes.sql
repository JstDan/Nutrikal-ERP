-- =====================================================================
-- Nutrikal ERP + CRM — batch quality, dispatch, traceability, notes
-- Owner, 31 Oct 2026:
-- * A finished batch starts in quarantine and is released by Admin with
--   its certificate of analysis. Materials stay released on receipt, but
--   Admin can block any lot (reason required). The ledger already refuses
--   to use or dispatch a lot that is not released, or is expired.
-- * The expiry date of a finished batch is entered when it is reported,
--   or comes from a known shelf life; no default of 24 months any more.
-- * An order is dispatched with its batches: a delivery note (DN-00001)
--   and 'dispatch' stock movements, so stock and cost of sales are right.
-- * Traceability one step back and one step forward (Reg. 178/2002 art. 18).
-- * Credit and debit notes against an issued invoice, on the shared series.
--
--                        admin   sales   production
-- block / release a lot  yes     —       —
-- dispatch               yes     —       —
-- delivery notes (read)  yes     yes     —
-- traceability           yes     yes     —
-- credit / debit notes   yes     yes     —
-- =====================================================================

drop function public.complete_production(uuid, text, integer, date, jsonb, jsonb);

create function public.complete_production(
  p_mo           uuid,
  p_batch        text,
  p_quantity     integer,
  p_produced_on  date,
  p_usage        jsonb,
  p_reasons      jsonb default '[]',
  p_expires_on   date default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  mo        public.manufacturing_orders;
  v_prod    boolean := public.has_role('production');
  v_tol     numeric;
  c         record;
  r         record;
  res       record;
  v_item    uuid;
  v_left    numeric;
  v_reason  text;
  v_fg      uuid;
  v_lot     uuid;
  v_shelf   integer;
  v_expiry  date;
  v_fg_loc  uuid;
  v_over    integer := 0;
  v_project public.projects;
  v_formula public.formulas;
begin
  perform public.require_role('admin', 'production');
  select * into mo from public.manufacturing_orders where id = p_mo for update;
  if mo.status is distinct from 'in_production' then
    raise exception 'Only an order in production can be reported';
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
  if jsonb_typeof(p_usage) <> 'array' or jsonb_array_length(p_usage) = 0 then
    raise exception 'Enter the lots used';
  end if;
  select coalesce(production_variance_pct, 5) into v_tol from public.company_settings limit 1;
  v_tol := coalesce(v_tol, 5);


  -- Consumption, lot by lot (the ledger refuses unreleased, expired or missing stock)
  for c in select * from jsonb_to_recordset(p_usage) as x(lot_id uuid, location_id uuid, quantity numeric) loop
    continue when coalesce(c.quantity, 0) = 0;
    if c.quantity < 0 then
      raise exception 'Used quantities cannot be negative';
    end if;
    select item_id into v_item from public.lots where id = c.lot_id;
    if v_item is null or not exists (select 1 from public.mo_required_materials(p_mo) q where q.item_id = v_item) then
      raise exception 'A used lot is not one of the materials of this order';
    end if;
    if v_prod and not public.is_production_location(c.location_id) then
      raise exception 'Production can only use stock at production locations' using errcode = '42501';
    end if;
    insert into public.stock_movements (type, lot_id, location_id, quantity, project_id, reference, manufacturing_order_id)
    values ('consumption', c.lot_id, c.location_id, -c.quantity, mo.project_id, mo.code, p_mo);
  end loop;

  -- Reserved vs used per material; reasons over the tolerance
  for r in
    with req as (select q.item_id from public.mo_required_materials(p_mo) q),
    rsv as (select sr.item_id, sum(sr.quantity) as reserved from public.stock_reservations sr
             where sr.manufacturing_order_id = p_mo and sr.status = 'active' group by sr.item_id),
    use as (select m.item_id, -sum(m.quantity) as used from public.stock_movements m
             where m.manufacturing_order_id = p_mo and m.type = 'consumption' group by m.item_id)
    select k.item_id, coalesce(rsv.reserved, 0) as reserved, coalesce(use.used, 0) as used
      from (select item_id from req union select item_id from rsv union select item_id from use) k
      left join rsv on rsv.item_id = k.item_id
      left join use on use.item_id = k.item_id
  loop
    select nullif(btrim(x.reason), '') into v_reason
      from jsonb_to_recordset(coalesce(p_reasons, '[]')) as x(item_id uuid, reason text)
     where x.item_id = r.item_id limit 1;
    if (r.reserved = 0 and r.used > 0)
       or (r.reserved > 0 and abs(r.used - r.reserved) / r.reserved * 100 > v_tol) then
      v_over := v_over + 1;
      if v_reason is null then
        raise exception 'Enter a reason for %: used % against % reserved',
          (select name from public.items where id = r.item_id), round(r.used, 4), round(r.reserved, 4);
      end if;
    end if;
    insert into public.mo_material_usage (mo_id, item_id, reserved, used, reason)
    values (p_mo, r.item_id, r.reserved, r.used, v_reason);

    -- The used part of the reservations is consumed, the rest released
    v_left := r.used;
    for res in select * from public.stock_reservations
                where manufacturing_order_id = p_mo and item_id = r.item_id and status = 'active'
                order by created_at for update loop
      if v_left >= res.quantity then
        update public.stock_reservations set status = 'consumed', closed_by = auth.uid(), closed_at = now() where id = res.id;
        v_left := v_left - res.quantity;
      elsif v_left > 0 then
        insert into public.stock_reservations (item_id, lot_id, location_id, project_id, manufacturing_order_id, quantity,
                                               status, note, reserved_by, created_at, closed_by, closed_at)
        values (res.item_id, res.lot_id, res.location_id, res.project_id, p_mo, res.quantity - v_left,
                'released', 'Not used in ' || mo.code, res.reserved_by, res.created_at, auth.uid(), now());
        update public.stock_reservations set quantity = v_left, status = 'consumed', closed_by = auth.uid(), closed_at = now()
         where id = res.id;
        v_left := 0;
      else
        update public.stock_reservations set status = 'released', closed_by = auth.uid(), closed_at = now() where id = res.id;
      end if;
    end loop;
  end loop;

  -- Finished-goods item of the project (created on the first batch)
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

  select id into v_fg_loc from public.locations where code = 'PF-QUAR' and is_active;
  if v_fg_loc is null then
    raise exception 'Location PF-QUAR (production quarantine) is missing';
  end if;

  -- The expiry date is entered with the batch; otherwise it comes from a known
  -- shelf life. Never a guess: without either the batch cannot be reported.
  v_shelf := coalesce(v_shelf, (select shelf_life_months from public.items where id = v_fg));
  v_expiry := coalesce(p_expires_on,
    case when v_shelf is not null then (coalesce(p_produced_on, current_date) + make_interval(months => v_shelf))::date end);
  if v_expiry is null then
    raise exception 'Enter the expiry date of the batch';
  end if;
  if v_expiry <= coalesce(p_produced_on, current_date) then
    raise exception 'The expiry date must be after the production date';
  end if;

  -- A finished batch waits in quarantine: only Admin releases it, with its COA
  insert into public.lots (lot_number, item_id, manufactured_on, expires_on, received_on, project_id, notes, qc_status)
  values (btrim(p_batch), v_fg, coalesce(p_produced_on, current_date), v_expiry,
          coalesce(p_produced_on, current_date), mo.project_id, 'Production ' || mo.code, 'quarantine')
  returning id into v_lot;

  insert into public.stock_movements (type, lot_id, location_id, quantity, project_id, reference, manufacturing_order_id)
  values ('production_output', v_lot, v_fg_loc, p_quantity, mo.project_id, mo.code, p_mo);

  perform set_config('nk.mo_transition', 'on', true);
  update public.manufacturing_orders
     set status = 'completed', completed_at = now(), batch_number = btrim(p_batch), produced_quantity = p_quantity,
         produced_on = coalesce(p_produced_on, current_date), finished_lot_id = v_lot,
         started_at = coalesce(started_at, now()), status_reason = null
   where id = p_mo;
  perform set_config('nk.mo_transition', 'off', true);

  perform public.update_batch_cost(p_mo);
  perform public.notify_role('admin', 'mo_completed', jsonb_build_object(
    'code', mo.code, 'batch', btrim(p_batch), 'quantity', p_quantity, 'over', v_over), '/production/' || p_mo);
  return v_lot;
end
$$;


revoke execute on function public.complete_production(uuid, text, integer, date, jsonb, jsonb, date) from public, anon;
grant execute on function public.complete_production(uuid, text, integer, date, jsonb, jsonb, date) to authenticated;

-- ---------------------------------------------------------------------
-- Quality: blocking a lot, releasing a finished batch with its COA
-- ---------------------------------------------------------------------
create or replace function public.set_lot_qc_status(
  p_lot     uuid,
  p_status  public.qc_status,
  p_notes   text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_lot public.lots;
begin
  perform public.require_role('admin');
  select * into v_lot from public.lots where id = p_lot;
  if not found then
    raise exception 'Lot % not found', p_lot;
  end if;
  if p_status <> 'released' and nullif(btrim(coalesce(p_notes, '')), '') is null then
    raise exception 'Enter the reason for blocking this lot';
  end if;
  if p_status = 'released' and v_lot.coa_path is null
     and (select type from public.items where id = v_lot.item_id) = 'finished_good' then
    raise exception 'Attach the certificate of analysis (COA) before releasing a finished batch';
  end if;
  update public.lots
     set qc_status = p_status,
         qc_notes  = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), qc_notes)
   where id = p_lot;
end
$$;

create or replace function public.set_lot_coa(p_lot uuid, p_path text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin');
  update public.lots set coa_path = p_path where id = p_lot;
  if not found then
    raise exception 'Lot % not found', p_lot;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Dispatch: delivery note (DN-00001) and stock out of the ledger
-- ---------------------------------------------------------------------
create table public.dispatches (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  order_id          uuid not null references public.sales_orders (id),
  dispatched_on     date not null default current_date,
  carrier           text,
  tracking          text,
  notes             text,
  balance_override  boolean not null default false,   -- Admin dispatched before the balance was paid
  created_by        uuid default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now()
);
create index dispatches_order_idx on public.dispatches (order_id);

create table public.dispatch_lines (
  id           uuid primary key default gen_random_uuid(),
  dispatch_id  uuid not null references public.dispatches (id) on delete cascade,
  item_id      uuid not null references public.items (id),
  lot_id       uuid not null references public.lots (id),
  location_id  uuid not null references public.locations (id),
  quantity     numeric(14, 4) not null check (quantity > 0)
);
create index dispatch_lines_dispatch_idx on public.dispatch_lines (dispatch_id);
create index dispatch_lines_lot_idx on public.dispatch_lines (lot_id);

select public.enable_audit('public.dispatches');
select public.enable_audit('public.dispatch_lines');

alter table public.stock_movements add column dispatch_id uuid references public.dispatches (id);
create index stock_movements_dispatch_idx on public.stock_movements (dispatch_id);

-- An order leaves only with its lots (dispatch_order), never by a bare status change
create or replace function public.sales_orders_dispatch_only()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.status = 'dispatched' and old.status = 'ready'
     and current_setting('nk.order_dispatch', true) is distinct from 'on' then
    raise exception 'Dispatch an order with its batches (delivery note)';
  end if;
  return new;
end
$$;

create trigger sales_orders_dispatch_only before update of status on public.sales_orders
  for each row execute function public.sales_orders_dispatch_only();

-- Finished stock of the projects of an order, for the dispatch form
create or replace function public.order_dispatchable_lots(p_order uuid)
returns table (
  lot_id uuid, location_id uuid, item_id uuid, lot_number text, name text, name_bg text, location text,
  quantity numeric, qc_status public.qc_status, expires_on date, project_code text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  return query
    select b.lot_id, b.location_id, b.item_id, b.lot_number, i.name, i.name_bg, loc.name, b.quantity, b.qc_status, b.expires_on, p.code
      from public.stock_balances b
      join public.items i on i.id = b.item_id and i.type = 'finished_good'
      join public.lots lo on lo.id = b.lot_id
      join public.projects p on p.id = lo.project_id
      join public.locations loc on loc.id = b.location_id
     where b.quantity > 0
       and lo.project_id in (select l.project_id from public.sales_order_lines l where l.order_id = p_order)
     order by p.code, b.expires_on nulls last, b.lot_number;
end
$$;

-- p_lines: jsonb array of {lot_id, location_id, quantity}. The ledger
-- refuses blocked or expired lots and more than is in stock.
create or replace function public.dispatch_order(
  p_order     uuid,
  p_date      date,
  p_lines     jsonb,
  p_carrier   text default null,
  p_tracking  text default null,
  p_notes     text default null,
  p_override  boolean default false
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  so    public.sales_orders;
  c     record;
  v_id  uuid;
  v_lot public.lots;
  v_n   integer := 0;
  v_due boolean;
begin
  perform public.require_role('admin');
  select * into so from public.sales_orders where id = p_order for update;
  if not found then
    raise exception 'Unknown order';
  end if;
  if so.status not in ('ready', 'dispatched') then
    raise exception 'Only an order that is ready can be dispatched';
  end if;
  v_due := so.balance_terms = 'before_dispatch' and so.balance_received_on is null;
  if v_due and not coalesce(p_override, false) then
    raise exception 'The balance must be paid before dispatch';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Enter the batches to dispatch';
  end if;

  insert into public.dispatches (code, order_id, dispatched_on, carrier, tracking, notes, balance_override)
  values (public.next_number('delivery_note'), p_order, coalesce(p_date, current_date),
          nullif(btrim(p_carrier), ''), nullif(btrim(p_tracking), ''), nullif(btrim(p_notes), ''), v_due)
  returning id into v_id;

  for c in select * from jsonb_to_recordset(p_lines) as x(lot_id uuid, location_id uuid, quantity numeric) loop
    continue when coalesce(c.quantity, 0) = 0;
    if c.quantity < 0 then
      raise exception 'Quantities cannot be negative';
    end if;
    select * into v_lot from public.lots where id = c.lot_id;
    if v_lot.id is null or v_lot.project_id is null or not exists (
      select 1 from public.sales_order_lines l where l.order_id = p_order and l.project_id = v_lot.project_id) then
      raise exception 'A batch does not belong to this order';
    end if;
    insert into public.dispatch_lines (dispatch_id, item_id, lot_id, location_id, quantity)
    values (v_id, v_lot.item_id, c.lot_id, c.location_id, c.quantity);
    insert into public.stock_movements (type, lot_id, location_id, quantity, project_id, reference, dispatch_id)
    values ('dispatch', c.lot_id, c.location_id, -c.quantity, v_lot.project_id, so.code, v_id);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'Enter the batches to dispatch';
  end if;

  if so.status = 'ready' then
    perform set_config('nk.order_dispatch', 'on', true);
    update public.sales_orders set status = 'dispatched' where id = p_order;
    perform set_config('nk.order_dispatch', 'off', true);
  end if;
  return v_id;
end
$$;

alter table public.dispatches     enable row level security;
alter table public.dispatch_lines enable row level security;
create policy dispatches_select on public.dispatches for select to authenticated
  using (public.has_role('admin', 'sales'));
create policy dispatch_lines_select on public.dispatch_lines for select to authenticated
  using (public.has_role('admin', 'sales'));
revoke insert, update, delete, truncate, references, trigger on public.dispatches, public.dispatch_lines from anon, authenticated;
grant select on public.dispatches, public.dispatch_lines to authenticated;

-- ---------------------------------------------------------------------
-- Traceability (Reg. 178/2002 art. 18): one step back, one step forward
-- ---------------------------------------------------------------------
create or replace function public.trace_find_lots(p_term text)
returns table (
  lot_id uuid, lot_number text, supplier_lot text, sku text, name text, name_bg text, item_type public.item_type,
  qc_status public.qc_status, expires_on date
)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  return query
    select l.id, l.lot_number, l.supplier_lot, i.sku, i.name, i.name_bg, i.type, l.qc_status, l.expires_on
      from public.lots l join public.items i on i.id = l.item_id
     where coalesce(btrim(p_term), '') = ''
        or l.lot_number ilike '%' || btrim(p_term) || '%'
        or l.supplier_lot ilike '%' || btrim(p_term) || '%'
        or i.name ilike '%' || btrim(p_term) || '%'
        or i.name_bg ilike '%' || btrim(p_term) || '%'
        or i.sku ilike '%' || btrim(p_term) || '%'
     order by l.created_at desc
     limit 50;
end
$$;

-- Materials that went into a lot, through every production step
create or replace function public.trace_back(p_lot uuid)
returns table (
  mo_code text, finished_lot text, lot_id uuid, lot_number text, supplier_lot text, supplier text, sku text, name text, name_bg text,
  base_unit public.base_unit, quantity numeric, received_on date, expires_on date
)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  return query
    with recursive up(lot_id) as (
      select p_lot
      union
      select m.lot_id
        from up
        join public.manufacturing_orders mo on mo.finished_lot_id = up.lot_id
        join public.stock_movements m on m.manufacturing_order_id = mo.id and m.type = 'consumption'
    )
    select mo.code, fl.lot_number, m.lot_id, l.lot_number, l.supplier_lot, s.name, i.sku, i.name, i.name_bg, i.base_unit,
           -sum(m.quantity), l.received_on, l.expires_on
      from up
      join public.manufacturing_orders mo on mo.finished_lot_id = up.lot_id
      join public.lots fl on fl.id = mo.finished_lot_id
      join public.stock_movements m on m.manufacturing_order_id = mo.id and m.type = 'consumption'
      join public.lots l on l.id = m.lot_id
      join public.items i on i.id = l.item_id
      left join public.suppliers s on s.id = l.supplier_id
     group by mo.code, fl.lot_number, m.lot_id, l.lot_number, l.supplier_lot, s.name, i.sku, i.name, i.name_bg, i.base_unit, l.received_on, l.expires_on
     order by mo.code, i.name;
end
$$;

-- Batches made with a lot, what is left of them and which clients got them
create or replace function public.trace_forward(p_lot uuid)
returns table (
  lot_id uuid, lot_number text, name text, name_bg text, mo_code text, produced_on date, made numeric,
  on_hand numeric, expires_on date, qc_status public.qc_status
)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  return query
    with recursive down(lot_id) as (
      select p_lot
      union
      select mo.finished_lot_id
        from down
        join public.stock_movements m on m.lot_id = down.lot_id and m.type = 'consumption'
        join public.manufacturing_orders mo on mo.id = m.manufacturing_order_id
       where mo.finished_lot_id is not null
    )
    select l.id, l.lot_number, i.name, i.name_bg, mo.code, mo.produced_on, mo.produced_quantity::numeric,
           coalesce((select sum(sm.quantity) from public.stock_movements sm where sm.lot_id = l.id), 0),
           l.expires_on, l.qc_status
      from down
      join public.manufacturing_orders mo on mo.finished_lot_id = down.lot_id
      join public.lots l on l.id = down.lot_id
      join public.items i on i.id = l.item_id
     order by mo.produced_on, l.lot_number;
end
$$;

create or replace function public.trace_clients(p_lot uuid)
returns table (
  dispatch_id uuid, dispatch_code text, dispatched_on date, order_id uuid, order_code text, client_id uuid, client text,
  lot_number text, name text, name_bg text, quantity numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  return query
    with recursive down(lot_id) as (
      select p_lot
      union
      select mo.finished_lot_id
        from down
        join public.stock_movements m on m.lot_id = down.lot_id and m.type = 'consumption'
        join public.manufacturing_orders mo on mo.id = m.manufacturing_order_id
       where mo.finished_lot_id is not null
    )
    select d.id, d.code, d.dispatched_on, so.id, so.code, c.id, c.legal_name, l.lot_number, i.name, i.name_bg, sum(dl.quantity)
      from down
      join public.dispatch_lines dl on dl.lot_id = down.lot_id
      join public.dispatches d on d.id = dl.dispatch_id
      join public.sales_orders so on so.id = d.order_id
      join public.clients c on c.id = so.client_id
      join public.lots l on l.id = dl.lot_id
      join public.items i on i.id = dl.item_id
     group by d.id, d.code, d.dispatched_on, so.id, so.code, c.id, c.legal_name, l.lot_number, i.name, i.name_bg
     order by d.dispatched_on, d.code;
end
$$;

-- ---------------------------------------------------------------------
-- Credit and debit notes: same number series, always against an issued
-- invoice, with a reason. A credit note cannot exceed what is left.
-- ---------------------------------------------------------------------
alter table public.invoices
  add column corrects_invoice_id uuid references public.invoices (id),
  add column reason text,
  add constraint invoices_note_chk check (
    kind = 'invoice' or (corrects_invoice_id is not null and nullif(btrim(reason), '') is not null));
create index invoices_corrects_idx on public.invoices (corrects_invoice_id);

create or replace function public.create_invoice_note(p_invoice uuid, p_kind public.invoice_kind, p_reason text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  inv  public.invoices;
  v_id uuid;
begin
  perform public.require_role('admin', 'sales');
  if p_kind = 'invoice' then
    raise exception 'Choose a credit note or a debit note';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Enter the reason for the correction';
  end if;
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or inv.kind <> 'invoice' or inv.status <> 'issued' then
    raise exception 'A note is issued against an issued invoice';
  end if;
  insert into public.invoices (kind, purpose, order_id, client_id, currency, vat_pct, locale, seller, buyer, corrects_invoice_id, reason)
  values (p_kind, inv.purpose, inv.order_id, inv.client_id, inv.currency, inv.vat_pct, inv.locale, inv.seller, inv.buyer, inv.id, btrim(p_reason))
  returning id into v_id;
  -- A credit note starts from the invoice's lines; a debit note starts empty
  if p_kind = 'credit_note' then
    insert into public.invoice_lines (invoice_id, sort_order, kind, description, offer_no, capsules, quantity, unit_price, amount)
    select v_id, sort_order, kind, description, offer_no, capsules, quantity, unit_price, amount
      from public.invoice_lines where invoice_id = inv.id;
  end if;
  return v_id;
end
$$;

-- Add (p_line null) or change a line of a draft note
create or replace function public.save_note_line(p_note uuid, p_line uuid, p_description text, p_quantity numeric, p_unit_price numeric)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  if (select kind from public.invoices where id = p_note) is not distinct from 'invoice'
     or not exists (select 1 from public.invoices where id = p_note) then
    raise exception 'Only the lines of a credit or debit note can be changed';
  end if;
  if nullif(btrim(coalesce(p_description, '')), '') is null or coalesce(p_quantity, 0) <= 0 or p_unit_price is null then
    raise exception 'Enter the description, quantity and price';
  end if;
  if p_line is null then
    insert into public.invoice_lines (invoice_id, sort_order, kind, description, quantity, unit_price, amount)
    values (p_note, (select count(*) from public.invoice_lines where invoice_id = p_note), 'service',
            btrim(p_description), p_quantity, p_unit_price, round(p_quantity * p_unit_price, 2));
  else
    update public.invoice_lines
       set description = btrim(p_description), quantity = p_quantity, unit_price = p_unit_price,
           amount = round(p_quantity * p_unit_price, 2)
     where id = p_line and invoice_id = p_note;
  end if;
end
$$;

create or replace function public.delete_note_line(p_note uuid, p_line uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  if (select kind from public.invoices where id = p_note) is not distinct from 'invoice' then
    raise exception 'Only the lines of a credit or debit note can be changed';
  end if;
  delete from public.invoice_lines where id = p_line and invoice_id = p_note;
end
$$;

create or replace function public.delete_invoice_note(p_note uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  if (select kind from public.invoices where id = p_note) is distinct from 'credit_note'
     and (select kind from public.invoices where id = p_note) is distinct from 'debit_note' then
    raise exception 'Only a draft note can be deleted';
  end if;
  delete from public.invoices where id = p_note;   -- invoices_guard refuses an issued one
end
$$;

create or replace function public.invoices_note_limit()
returns trigger language plpgsql set search_path = public
as $$
declare
  v_open numeric;
begin
  if new.kind = 'credit_note' and old.status = 'draft' and new.status = 'issued' then
    select o.total
           - coalesce((select sum(n.total) from public.invoices n
                        where n.corrects_invoice_id = o.id and n.kind = 'credit_note' and n.status = 'issued'), 0)
           + coalesce((select sum(n.total) from public.invoices n
                        where n.corrects_invoice_id = o.id and n.kind = 'debit_note' and n.status = 'issued'), 0)
      into v_open from public.invoices o where o.id = new.corrects_invoice_id;
    if new.total > v_open then
      raise exception 'The credit note (%) is more than what is left on the invoice (%)', new.total, v_open;
    end if;
  end if;
  return new;
end
$$;

create trigger invoices_note_limit before update on public.invoices
  for each row execute function public.invoices_note_limit();

revoke execute on function
  public.set_lot_coa(uuid, text),
  public.order_dispatchable_lots(uuid),
  public.dispatch_order(uuid, date, jsonb, text, text, text, boolean),
  public.trace_find_lots(text),
  public.trace_back(uuid),
  public.trace_forward(uuid),
  public.trace_clients(uuid),
  public.create_invoice_note(uuid, public.invoice_kind, text),
  public.save_note_line(uuid, uuid, text, numeric, numeric),
  public.delete_note_line(uuid, uuid),
  public.delete_invoice_note(uuid)
from public, anon;

grant execute on function
  public.set_lot_coa(uuid, text),
  public.order_dispatchable_lots(uuid),
  public.dispatch_order(uuid, date, jsonb, text, text, text, boolean),
  public.trace_find_lots(text),
  public.trace_back(uuid),
  public.trace_forward(uuid),
  public.trace_clients(uuid),
  public.create_invoice_note(uuid, public.invoice_kind, text),
  public.save_note_line(uuid, uuid, text, numeric, numeric),
  public.delete_note_line(uuid, uuid),
  public.delete_invoice_note(uuid)
to authenticated;

-- Production costs are a setting: Admin only (costing functions run as owner)
drop policy format_costing_select on public.format_costing;
create policy format_costing_select on public.format_costing for select to authenticated
  using (public.has_role('admin'));
