-- =====================================================================
-- Nutrikal ERP + CRM — price tiers of a catalog product too (owner, Nov 2026)
--
-- A catalog offer may have price tiers like a custom one: a quantity and a
-- discount % on the catalog price for that quantity (the price step it falls
-- in). An order at such a tier is accepted like one at a catalog step; the
-- calculator works out its price from the saved offer. Only the catalog
-- branch of the tier check in create_order_from_calc_offers changes.
--
-- Production: no change to what it sees.
-- =====================================================================

create or replace function public.create_order_from_calc_offers(
  p_client        uuid,
  p_offers        uuid[],
  p_services      jsonb default '[]'::jsonb,
  p_vat_pct       numeric default null,
  p_customer_ref  text default null,
  p_requested     date default null,
  p_notes         text default null,
  p_levels        jsonb default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  c       public.clients;
  cs      public.company_settings;
  o       public.calc_offers;
  v_id    uuid;
  v_qty   integer;
  v_price numeric;
  v_n     integer := 0;
  s       record;
  v_level jsonb;
  v_ok    boolean;
begin
  perform public.require_role('admin', 'sales');
  select * into c from public.clients where id = p_client;
  if not found then
    raise exception 'Unknown client';
  end if;
  if coalesce(array_length(p_offers, 1), 0) = 0 then
    raise exception 'Choose at least one offer';
  end if;
  select * into cs from public.company_settings limit 1;

  -- The terms of the client, else the company default (60 % deposit, balance before dispatch)
  insert into public.sales_orders (client_id, currency, status, deposit_pct, balance_terms, balance_net_days, vat_pct,
                                   customer_ref, requested_date, notes)
  values (c.id, 'EUR', 'unpaid',
          coalesce(c.deposit_pct, cs.default_deposit_pct, 0),
          coalesce(c.balance_terms, cs.default_balance_terms, 'before_dispatch'),
          case when coalesce(c.balance_terms, cs.default_balance_terms) = 'net_days' then coalesce(c.balance_net_days, cs.default_balance_net_days) end,
          coalesce(p_vat_pct, cs.default_vat_rate, 20),
          nullif(trim(p_customer_ref), ''), p_requested, nullif(trim(p_notes), ''))
  returning id into v_id;

  perform set_config('nk.order_create', 'on', true);
  for o in select * from public.calc_offers where id = any (p_offers) order by offer_no loop
    if o.client_id is distinct from c.id then
      raise exception 'Offer % is for another client', o.offer_no;
    end if;
    if exists (select 1 from public.sales_order_lines l join public.sales_orders so on so.id = l.order_id
                where l.calc_offer_id = o.id and so.status <> 'cancelled') then
      raise exception 'Offer % is already in an order', o.offer_no;
    end if;
    v_qty := nullif(o.data ->> 'numberOfUnits', '')::numeric::integer;
    v_price := nullif(o.results ->> 'unitPrice', '')::numeric;
    if coalesce(v_qty, 0) <= 0 or coalesce(v_price, 0) <= 0 then
      raise exception 'Offer % has no quantity or price', o.offer_no;
    end if;

    -- Another quantity of the offer when one was chosen
    v_level := (select x from jsonb_array_elements(coalesce(p_levels, '[]'::jsonb)) x
                 where x ->> 'offer_id' = o.id::text limit 1);
    if v_level is not null and public.calc_num(v_level ->> 'quantity') is distinct from v_qty then
      v_qty := public.calc_num(v_level ->> 'quantity')::integer;
      v_price := round(public.calc_num(v_level ->> 'unit_price'), 4);
      if coalesce(v_qty, 0) <= 0 or coalesce(v_price, 0) <= 0 then
        raise exception 'Offer % has no quantity or price', o.offer_no;
      end if;
      if o.data ->> 'mode' = 'catalog' then
        -- a catalog price step (its price follows the capsules, jar and lid of the offer), or a price tier
        -- of the offer: a discount on the catalog price for that quantity (owner, Nov 2026). As for the
        -- steps, the price is computed by the calculator from the saved offer, not checked here.
        v_ok := exists (select 1 from jsonb_array_elements(coalesce(o.data -> 'catalog' -> 'tiers', '[]'::jsonb)) t
                         where public.calc_num(t ->> 'min_qty') = v_qty)
             or exists (select 1 from jsonb_array_elements(coalesce(o.data -> 'priceTiers', '[]'::jsonb)) t
                         where public.calc_num(t ->> 'qty') = v_qty
                           and public.calc_num(t ->> 'discount') >= 0 and public.calc_num(t ->> 'discount') < 100);
      else
        -- a price tier: a discount on the unit price of the offer (owner, Nov 2026),
        -- or, in offers saved before that, its own markup on the unit cost; rounded like the offer
        v_ok := exists (select 1 from jsonb_array_elements(coalesce(o.data -> 'priceTiers', '[]'::jsonb)) t
                         where public.calc_num(t ->> 'qty') = v_qty
                           and case when public.calc_num(t ->> 'discount') is not null
                                 then round(public.calc_num(o.results ->> 'unitPrice') * (1 - public.calc_num(t ->> 'discount') / 100), 2)
                                 else round(public.calc_num(o.results ->> 'unitCost') * (1 + public.calc_num(t ->> 'markup') / 100), 2)
                               end = v_price);
      end if;
      if not v_ok then
        raise exception 'Offer % has no price level of % units at this price', o.offer_no, v_qty;
      end if;
    end if;

    insert into public.sales_order_lines (order_id, kind, calc_offer_id, description, quantity, unit_price, sort_order)
    values (v_id, 'calc_offer', o.id, coalesce(nullif(o.product_name, ''), o.offer_no), v_qty, v_price, v_n);
    v_n := v_n + 1;
  end loop;
  if v_n <> (select count(distinct x) from unnest(p_offers) x) then
    raise exception 'Unknown offer';
  end if;

  for s in select * from jsonb_to_recordset(coalesce(p_services, '[]'::jsonb)) as x(description text, quantity integer, unit_price numeric) loop
    if nullif(trim(s.description), '') is null or coalesce(s.quantity, 0) <= 0 or s.unit_price is null or s.unit_price < 0 then
      raise exception 'Each service needs a description, a quantity above 0 and a price';
    end if;
    insert into public.sales_order_lines (order_id, kind, description, quantity, unit_price, sort_order)
    values (v_id, 'service', trim(s.description), s.quantity, s.unit_price, v_n);
    v_n := v_n + 1;
  end loop;
  perform set_config('nk.order_create', 'off', true);
  return v_id;
end
$$;

