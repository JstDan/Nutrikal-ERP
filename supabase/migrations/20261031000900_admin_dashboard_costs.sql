-- =====================================================================
-- Nutrikal ERP + CRM — production costs on the admin dashboard
-- Batch costs (materials, partner invoices, cost per pack) move off the
-- manufacturing order page into the admin dashboard and are for admin
-- only (owner, Oct 2026): sales with "see purchase prices" no longer
-- get them. Lot costs on the stock pages are unchanged.
-- =====================================================================

-- The per-batch functions: admin only
create or replace function public.mo_costs(p_mo uuid)
returns table (
  item_id uuid, sku text, name text, name_bg text, base_unit public.base_unit, lot_number text,
  quantity numeric, unit_cost numeric, cost numeric, estimated boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Not allowed: production costs are for admin only' using errcode = '42501';
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
  if not public.has_role('admin') then
    raise exception 'Not allowed: production costs are for admin only' using errcode = '42501';
  end if;
  return query select * from public.mo_cost_summary(p_mo);
end
$$;

-- Admin: every batch with its cost. Completed batches produced in the
-- period (actual cost), plus the open ones (planned cost) when p_open.
-- With the sales price per pack of the order line, for the margin.
create or replace function public.admin_production_costs(p_from date, p_to date, p_open boolean default true)
returns table (
  id uuid, code text, status text, produced_on date, planned_date date,
  project_code text, order_id uuid, order_code text, client_id uuid, client text,
  product text, product_bg text, packs integer, is_actual boolean,
  material_cost numeric, partner_cost numeric, total_cost numeric, cost_per_pack numeric,
  estimated_lines integer, missing_prices integer, unit_price numeric, currency char(3)
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Not allowed: production costs are for admin only' using errcode = '42501';
  end if;
  return query
    select mo.id, mo.code, mo.status::text, mo.produced_on, mo.planned_date,
           p.code, so.id, so.code, c.id, c.legal_name,
           f.name, f.name_bg, s.packs, s.is_actual,
           round(s.material_cost, 2), round(s.partner_cost, 2), round(s.total_cost, 2), round(s.cost_per_pack, 4),
           s.estimated_lines, s.missing_prices, l.unit_price, so.currency
      from public.manufacturing_orders mo
      join public.formula_versions v on v.id = mo.formula_version_id
      join public.formulas f on f.id = v.formula_id
      left join public.projects p on p.id = mo.project_id
      left join public.sales_order_lines l on l.id = mo.sales_order_line_id
      left join public.sales_orders so on so.id = l.order_id
      left join public.clients c on c.id = so.client_id
      cross join lateral public.mo_cost_summary(mo.id) s
     where mo.status::text <> 'cancelled'
       and ((mo.status::text = 'completed' and mo.produced_on between p_from and p_to)
            or (p_open and mo.status::text not in ('completed', 'simulation')))
     order by (mo.status::text = 'completed'), mo.produced_on desc nulls last, mo.planned_date nulls last, mo.code desc;
end
$$;

revoke execute on function public.admin_production_costs(date, date, boolean) from public, anon;
grant execute on function public.admin_production_costs(date, date, boolean) to authenticated;
