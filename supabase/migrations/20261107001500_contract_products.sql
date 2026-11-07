-- =====================================================================
-- Schedule A of a contract names what is made (owner, Nov 2026): for each
-- line the pack, the packaging and the composition per serving, taken from
-- the calculator offer of the order line. The app works them out from the
-- offer (the same as on the offer document) and keeps them in the row
-- (schedule.rows[i].product), so the client's link and the PDF show them
-- without reaching the offers. No prices or costs are kept there.
-- =====================================================================

/** Schedule A from the order; each row also names its order line and offer (for the product details). */
create or replace function public.contract_schedule(p_order uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  so     public.sales_orders;
  v_rows jsonb;
  v_sub  numeric;
  v_vat  numeric;
  v_dep  numeric;
begin
  select * into so from public.sales_orders where id = p_order;
  -- A line from an offer is named after its product (the line itself may have no description)
  select coalesce(jsonb_agg(jsonb_build_object('description', coalesce(nullif(l.description, ''), co.product_name, f.name, ''), 'quantity', l.quantity,
                                               'unit_price', l.unit_price, 'amount', round(l.quantity * l.unit_price, 2),
                                               'line_id', l.id, 'offer_id', l.calc_offer_id) order by l.sort_order), '[]'),
         coalesce(sum(round(l.quantity * l.unit_price, 2)), 0)
    into v_rows, v_sub
    from public.sales_order_lines l
    left join public.calc_offers co on co.id = l.calc_offer_id
    left join public.formula_versions v on v.id = l.formula_version_id
    left join public.formulas f on f.id = v.formula_id
   where l.order_id = p_order;
  v_vat := round(v_sub * coalesce(public.order_vat_rate(p_order), 0) / 100, 2);
  v_dep := round((v_sub + v_vat) * coalesce(so.deposit_pct, 0) / 100, 2);
  return jsonb_build_object('currency', so.currency, 'rows', v_rows, 'subtotal', v_sub, 'vat_pct', coalesce(public.order_vat_rate(p_order), 0),
    'vat', v_vat, 'total', v_sub + v_vat, 'deposit_pct', coalesce(so.deposit_pct, 0), 'deposit', v_dep, 'balance', v_sub + v_vat - v_dep);
end
$$;

/**
 * The product details of the rows of Schedule A, in the order of the rows: each an object
 * {pack, format, portion, composition: [{name, amount}]} or null (a row without an offer).
 * Admin and Sales, until the contract is signed.
 */
create or replace function public.set_contract_products(p_id uuid, p_products jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  k public.order_contracts;
begin
  perform public.require_role('admin', 'sales');
  select * into k from public.order_contracts where id = p_id;
  if not found then
    raise exception 'Contract not found';
  end if;
  if k.status in ('signed', 'cancelled') then
    raise exception 'A signed or cancelled contract does not change';
  end if;
  if jsonb_typeof(p_products) <> 'array' or length(p_products::text) > 200000 then
    raise exception 'Product details: a list, at most 200 kB';
  end if;
  update public.order_contracts
     set schedule = jsonb_set(schedule, '{rows}', (
       -- A row without details keeps "product": null, so it is known to have been looked at
       select coalesce(jsonb_agg((r - 'product') || jsonb_build_object('product',
                                   case when jsonb_typeof(p_products -> (o - 1)::int) = 'object' then p_products -> (o - 1)::int end) order by o), '[]')
         from jsonb_array_elements(k.schedule -> 'rows') with ordinality as t (r, o)))
   where id = p_id;
end
$$;

revoke execute on function public.set_contract_products(uuid, jsonb) from public, anon;
grant execute on function public.set_contract_products(uuid, jsonb) to authenticated;
