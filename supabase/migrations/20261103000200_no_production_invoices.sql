-- =====================================================================
-- Nutrikal ERP + CRM — no batch invoice of the production partner (owner, Nov 2026)
--
-- The field "Invoice for the batch" goes: production is accounted for in
-- another way. Nobody enters a partner invoice any more, and the batch cost
-- (admin dashboard, cost per pack on the finished lot) is the materials only.
-- The trigger that recomputed the batch cost on every partner invoice goes.
-- Invoices already entered stay in production_invoices untouched (no data is
-- deleted), but count nowhere; the batch costs that included them are
-- recomputed from the materials.
-- =====================================================================

drop trigger if exists production_invoices_cost on public.production_invoices;
drop function if exists public.production_invoices_cost();

-- Nobody adds a partner invoice any more
drop policy if exists production_invoices_insert on public.production_invoices;
revoke insert, update on public.production_invoices from authenticated;

-- Batch cost = materials
drop function if exists public.admin_production_costs(date, date, boolean);
drop function if exists public.mo_cost(uuid);
drop function if exists public.mo_cost_summary(uuid);

create function public.mo_cost_summary(p_mo uuid)
returns table (
  is_actual boolean, material_cost numeric, estimated_lines integer, missing_prices integer,
  total_cost numeric, packs integer, cost_per_pack numeric
)
language sql stable security definer set search_path = public
as $$
  with mo as (select * from public.manufacturing_orders where id = p_mo),
  c as (select coalesce(sum(cost), 0) as material, count(*) filter (where estimated)::int as est,
               count(*) filter (where cost is null)::int as missing
          from public.mo_cost_lines(p_mo))
  select mo.status = 'completed', c.material, c.est, c.missing, c.material,
         coalesce(mo.produced_quantity, mo.quantity),
         round(c.material / nullif(coalesce(mo.produced_quantity, mo.quantity), 0), 6)
    from mo, c
$$;
revoke execute on function public.mo_cost_summary(uuid) from public, anon, authenticated;

create function public.mo_cost(p_mo uuid)
returns table (
  is_actual boolean, material_cost numeric, estimated_lines integer, missing_prices integer,
  total_cost numeric, packs integer, cost_per_pack numeric
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
revoke execute on function public.mo_cost(uuid) from public, anon;
grant execute on function public.mo_cost(uuid) to authenticated;

create function public.admin_production_costs(p_from date, p_to date, p_open boolean default true)
returns table (
  id uuid, code text, status text, produced_on date, planned_date date,
  project_code text, order_id uuid, order_code text, client_id uuid, client text,
  product text, product_bg text, packs integer, is_actual boolean,
  material_cost numeric, total_cost numeric, cost_per_pack numeric,
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
           round(s.material_cost, 2), round(s.total_cost, 2), round(s.cost_per_pack, 4),
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

-- Finished lots whose cost included a partner invoice: materials only now
do $$
declare
  r record;
begin
  for r in select distinct mo_id from public.production_invoices loop
    perform public.update_batch_cost(r.mo_id);
  end loop;
end
$$;
