-- =====================================================================
-- Nutrikal ERP + CRM — admin dashboard: money, sales, stock, purchases
-- One admin-only function returns the figures of the dashboard as JSON
-- for a period. Amounts are in the document's currency; the totals add
-- up EUR only and count what is in another currency.
-- =====================================================================

create or replace function public.admin_dashboard(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_money jsonb; v_sales jsonb; v_stock jsonb; v_purchases jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'Not allowed: the admin dashboard is for admin only' using errcode = '42501';
  end if;

  -- ---------------------------------------------------------------- money
  with o as (
    select so.id, so.code, so.currency, so.status::text as status, so.client_id, c.legal_name as client,
           so.deposit_pct, so.deposit_amount, so.deposit_received_on, so.balance_received_on,
           so.balance_terms::text as balance_terms, so.balance_net_days, so.dispatched_at, t.gross
      from public.sales_orders so
      join public.clients c on c.id = so.client_id
      cross join lateral public.order_totals(so.id) t
     where so.status::text not in ('cancelled', 'draft')
  ),
  p as (   -- what was / is to be paid first, and the balance
    select o.*,
           case when o.deposit_pct >= 100 then o.gross
                else coalesce(o.deposit_amount, round(o.gross * coalesce(o.deposit_pct, 0) / 100, 2)) end as first_amount
      from o
  ),
  open_items as (
    select p.id, p.code, p.client_id, p.client, p.currency, 'first'::text as kind, p.gross as amount, null::date as due_on
      from p where p.deposit_received_on is null and p.gross > 0
    union all
    select p.id, p.code, p.client_id, p.client, p.currency, 'balance', p.gross - p.first_amount,
           case when p.balance_terms = 'net_days' and p.dispatched_at is not null
                then (p.dispatched_at::date + coalesce(p.balance_net_days, 0)) end
      from p where p.deposit_received_on is not null and p.balance_received_on is null and p.gross - p.first_amount > 0
  )
  select jsonb_build_object(
    'received', (select coalesce(sum(x), 0) from (
        select first_amount as x from p where currency = 'EUR' and deposit_received_on between p_from and p_to
        union all
        select gross - first_amount from p where currency = 'EUR' and balance_received_on between p_from and p_to
         and gross - first_amount > 0) r),
    'awaiting_first', (select coalesce(sum(amount), 0) from open_items where kind = 'first' and currency = 'EUR'),
    'awaiting_balance', (select coalesce(sum(amount), 0) from open_items where kind = 'balance' and currency = 'EUR'),
    'overdue', (select coalesce(sum(amount), 0) from open_items where due_on < current_date and currency = 'EUR'),
    'other_currency', (select count(*) from open_items where currency <> 'EUR'),
    'invoiced', (select coalesce(sum(case when kind = 'credit_note' then -abs(total) else total end), 0)
                   from public.invoices where status = 'issued' and currency = 'EUR' and issue_date between p_from and p_to),
    'open', coalesce((select jsonb_agg(to_jsonb(x) order by x.due_on nulls last, x.amount desc) from (
        select id, code, client_id, client, currency, kind, amount, due_on, (due_on < current_date) as overdue
          from open_items order by due_on nulls last, amount desc limit 15) x), '[]'::jsonb)
  ) into v_money;

  -- ---------------------------------------------------------------- sales
  with o as (
    select so.id, so.client_id, c.legal_name as client, so.currency, t.net
      from public.sales_orders so
      join public.clients c on c.id = so.client_id
      cross join lateral public.order_totals(so.id) t
     where so.status::text not in ('cancelled', 'draft')
       and coalesce(so.confirmed_at, so.created_at)::date between p_from and p_to
  ),
  lines as (
    select coalesce(f.name, l.description, '—') as product, f.name_bg as product_bg, sum(l.quantity) as packs,
           sum(round(l.quantity * l.unit_price, 2)) as net
      from public.sales_order_lines l
      join o on o.id = l.order_id and o.currency = 'EUR'
      left join public.formula_versions v on v.id = l.formula_version_id
      left join public.formulas f on f.id = v.formula_id
     where l.kind <> 'service'
     group by 1, 2
  ),
  offers as (
    select co.id,
           exists (select 1 from public.sales_order_lines l join public.sales_orders so on so.id = l.order_id
                    where l.calc_offer_id = co.id and so.status::text <> 'cancelled') as won
      from public.calc_offers co
     where co.created_at::date between p_from and p_to
  )
  select jsonb_build_object(
    'orders', (select count(*) from o),
    'revenue', (select coalesce(sum(net), 0) from o where currency = 'EUR'),
    'avg_order', (select coalesce(round(avg(net), 2), 0) from o where currency = 'EUR'),
    'offers', (select count(*) from offers),
    'offers_won', (select count(*) from offers where won),
    'top_clients', coalesce((select jsonb_agg(to_jsonb(x) order by x.net desc) from (
        select client_id, client, count(*) as orders, sum(net) as net from o where currency = 'EUR'
         group by client_id, client order by sum(net) desc limit 5) x), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(to_jsonb(x) order by x.net desc) from (
        select product, product_bg, packs, net from lines order by net desc limit 5) x), '[]'::jsonb)
  ) into v_sales;

  -- ---------------------------------------------------------------- stock
  with b as (
    select sb.lot_id, sb.item_id, sb.quantity, sb.expires_on, i.type::text as type, lc.unit_cost
      from public.stock_balances sb
      join public.items i on i.id = sb.item_id
      join public.locations loc on loc.id = sb.location_id
      left join public.lot_costs lc on lc.lot_id = sb.lot_id
     where sb.quantity > 0 and loc.type::text <> 'virtual'
  ),
  exp as (
    select e.lot_id, e.lot_number, e.item_id, e.item_name, i.name_bg, e.days_left, sum(e.quantity) as quantity,
           i.base_unit::text as base_unit, round(sum(e.quantity) * max(lc.unit_cost), 2) as value
      from public.expiring_lots e
      join public.items i on i.id = e.item_id
      join public.locations loc on loc.id = e.location_id
      left join public.lot_costs lc on lc.lot_id = e.lot_id
     where loc.type::text <> 'virtual'
     group by e.lot_id, e.lot_number, e.item_id, e.item_name, i.name_bg, e.days_left, i.base_unit
  )
  select jsonb_build_object(
    'value', (select coalesce(round(sum(quantity * unit_cost), 2), 0) from b),
    'by_type', coalesce((select jsonb_object_agg(type, v) from (
        select type, round(sum(quantity * coalesce(unit_cost, 0)), 2) as v from b group by type) x), '{}'::jsonb),
    'no_cost', (select count(distinct lot_id) from b where unit_cost is null),
    'low', coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from (
        select s.item_id, s.sku, s.name, i.name_bg, s.available, s.reorder_level, s.base_unit::text as base_unit
          from public.item_stock_summary s join public.items i on i.id = s.item_id
         where s.below_reorder_level order by s.name limit 15) x), '[]'::jsonb),
    'low_count', (select count(*) from public.item_stock_summary where below_reorder_level),
    'expiring', coalesce((select jsonb_agg(to_jsonb(x) order by x.days_left) from (
        select * from exp order by days_left limit 15) x), '[]'::jsonb),
    'expiring_value', (select coalesce(sum(value), 0) from exp)
  ) into v_stock;

  -- ------------------------------------------------------------ purchases
  with po as (
    select o.id, o.code, o.status::text as status, o.order_date, o.currency, s.name as supplier,
           (select coalesce(sum(round(l.quantity * coalesce(l.unit_price, 0), 2)), 0)
              from public.purchase_order_lines l where l.purchase_order_id = o.id) as total,
           (select count(*) from public.purchase_order_lines l
              join public.expected_deliveries d on d.id = l.expected_delivery_id
             where l.purchase_order_id = o.id and d.status = 'open') as open_lines
      from public.purchase_orders o join public.suppliers s on s.id = o.supplier_id
     where o.status::text <> 'cancelled'
  )
  select jsonb_build_object(
    'ordered', (select coalesce(sum(total), 0) from po where status = 'sent' and currency = 'EUR' and order_date between p_from and p_to),
    'ordered_count', (select count(*) from po where status = 'sent' and order_date between p_from and p_to),
    'open_value', (select coalesce(sum(total), 0) from po where status = 'sent' and open_lines > 0 and currency = 'EUR'),
    'open_count', (select count(*) from po where status = 'sent' and open_lines > 0),
    'drafts', (select count(*) from po where status = 'draft'),
    'received', (select coalesce(round(sum(m.quantity * lc.unit_cost), 2), 0)
                   from public.stock_movements m join public.lot_costs lc on lc.lot_id = m.lot_id
                  where m.type::text = 'receipt' and m.created_at::date between p_from and p_to),
    'open', coalesce((select jsonb_agg(to_jsonb(x) order by x.order_date, x.code) from (
        select id, code, status, order_date, currency, supplier, total, open_lines, (current_date - order_date) as age_days
          from po where status = 'draft' or open_lines > 0 order by order_date, code limit 15) x), '[]'::jsonb)
  ) into v_purchases;

  return jsonb_build_object('money', v_money, 'sales', v_sales, 'stock', v_stock, 'purchases', v_purchases);
end
$$;

revoke execute on function public.admin_dashboard(date, date) from public, anon;
grant execute on function public.admin_dashboard(date, date) to authenticated;
