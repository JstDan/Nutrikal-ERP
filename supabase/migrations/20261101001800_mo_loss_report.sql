-- Materials used above what was reserved, by product and reason (owner, Nov 2026). The report of a batch keeps a
-- fixed code in mo_material_usage.reason (scrap, spill, setup, sample, weight) or free text, which counts as other.
create or replace function public.mo_loss_report(p_from date, p_to date)
returns table (product text, product_bg text, item text, item_bg text, base_unit public.base_unit, reason text, batches integer, quantity numeric, value numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin');
  return query
    select f.name::text, f.name_bg::text, r.name, r.name_bg, r.base_unit,
           case when r.reason in ('scrap', 'spill', 'setup', 'sample', 'weight') then r.reason
                when nullif(btrim(r.reason), '') is null then 'none' else 'other' end,
           count(distinct mo.id)::int, sum(r.diff), coalesce(sum(r.diff_value), 0)
      from public.manufacturing_orders mo
      join public.formula_versions v on v.id = mo.formula_version_id
      join public.formulas f on f.id = v.formula_id
      cross join lateral public.mo_usage_report(mo.id) r
     where mo.status = 'completed' and r.diff > 0
       and coalesce(mo.produced_on, mo.completed_at::date) between p_from and p_to
     group by 1, 2, 3, 4, 5, 6
     order by 9 desc, 1;
end
$$;
revoke execute on function public.mo_loss_report(date, date) from public, anon;
grant execute on function public.mo_loss_report(date, date) to authenticated;
