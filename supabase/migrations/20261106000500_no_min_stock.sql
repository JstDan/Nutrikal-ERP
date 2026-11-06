-- =====================================================================
-- Nutrikal ERP + CRM — no minimum stock (owner, Nov 2026)
-- The minimum stock per item (items.reorder_level) is removed from the whole
-- system: no "below minimum" flag, no low-stock lines in purchasing, nothing
-- on the dashboards. Stock and purchase requests from orders stay as they are.
-- =====================================================================

drop view public.purchase_shortages;
drop view public.item_stock_summary;

create view public.item_stock_summary
with (security_invoker = true) as
with bal as (
  select item_id,
         sum(quantity)                                                       as on_hand,
         sum(quantity) filter (where qc_status = 'released' and not is_expired) as usable,
         sum(quantity) filter (where qc_status = 'quarantine')               as quarantine
    from public.stock_balances
   group by item_id
),
res as (
  select item_id, sum(quantity) as reserved
    from public.stock_reservations
   where status = 'active'
   group by item_id
)
select i.id                                              as item_id,
       i.sku,
       i.name,
       i.type,
       i.base_unit,
       coalesce(b.on_hand, 0)                            as on_hand,
       coalesce(b.usable, 0)                             as usable,
       coalesce(b.quarantine, 0)                         as quarantine,
       coalesce(r.reserved, 0)                           as reserved,
       coalesce(b.usable, 0) - coalesce(r.reserved, 0)   as available,
       coalesce(n.incoming, 0)                           as incoming,
       n.next_expected_on,
       coalesce(b.usable, 0) - coalesce(r.reserved, 0) + coalesce(n.incoming, 0) as projected
  from public.items i
  left join bal b on b.item_id = i.id
  left join res r on r.item_id = i.id
  left join public.item_incoming n on n.item_id = i.id
 where i.is_active;

create view public.purchase_shortages
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
       round(n.quantity, 3) as quantity, n.needed_by, s.available, s.incoming,
       p.supplier_id, su.name as supplier, pc.price as unit_price
  from need n
  join public.items i on i.id = n.item_id
  join public.item_stock_summary s on s.item_id = n.item_id
  left join pref p on p.item_id = n.item_id
  left join public.suppliers su on su.id = p.supplier_id
  left join price pc on pc.supplier_item_id = p.supplier_item_id
 where public.has_role('admin') or public.can_see_purchase_prices();
revoke insert, update, delete, truncate, references, trigger on public.item_stock_summary from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.purchase_shortages from anon, authenticated;

-- The admin dashboard without the low-stock list: its current definition (Admin and the bookkeeper)
-- with the two low-stock entries taken out, so nothing else of it changes
do $$
declare
  d text;
begin
  d := pg_get_functiondef('public.admin_dashboard(date, date)'::regprocedure);
  d := regexp_replace(d, $r$\s*'low', coalesce\(.*?'low_count', \(select count\(\*\) from public\.item_stock_summary where below_reorder_level\),$r$, '');
  if d like '%reorder%' then
    raise exception 'admin_dashboard still uses the minimum stock';
  end if;
  execute d;
end
$$;

alter table public.items drop column reorder_level;
