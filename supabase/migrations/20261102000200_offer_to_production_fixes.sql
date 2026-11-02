-- =====================================================================
-- Nutrikal ERP + CRM — from offer to production, end to end (owner, Nov 2026)
-- Found when the whole path was run with offers as the calculator saves them:
--  1. A recipe from a catalog offer: the catalog product decides, not the
--     fields of the custom formula left in the form. Format (capsules or
--     powder), capsules per serving, servings per jar (the capsules per jar
--     chosen on the offer), the composition, and the capsule, jar and lid.
--     Untouched draft recipes of catalog offers are rebuilt.
--  2. A new recipe version keeps the ingredients still to be linked.
--  3. An order from calculator offers takes the payment terms of the client,
--     else the company default (60 % deposit, balance before dispatch).
--  4. The bookkeeper confirms the first payment (decided in Oct 2026; the
--     order rule still allowed only Admin).
--  5. Prepare production names a recipe without servings per pack instead of
--     stopping the whole order.
--
-- Production: no change to what it sees.
-- =====================================================================

-- 1. Recipe of a calculator offer -------------------------------------
create or replace function public.calc_offer_recipe_sync(p_offer uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  o         public.calc_offers;
  f         public.formulas;
  v_version uuid;
  v_rows    jsonb;
  v_cat     boolean;
  v_pt      text;
  v_format  public.product_format;
  v_sunit   public.serving_unit;
  v_size    numeric;
  v_per     integer;
  v_caps    numeric;
  v_jarcaps numeric;
  v_qty     numeric;
  v_dose_g  numeric := 0;
  r         jsonb;
  v_amount  numeric;
  v_unit    public.dose_unit;
  v_mat     uuid;
  v_item    uuid;
  v_n       integer := 0;
  v_code    text;
  v_waste   numeric;
  pk        record;
  num       constant text := '^\s*[0-9]+([.,][0-9]+)?\s*$';
begin
  select * into o from public.calc_offers where id = p_offer;
  if not found then
    return null;
  end if;
  select * into f from public.formulas where calc_offer_id = p_offer;
  if found then
    if f.offer_edited
       or (select count(*) from public.formula_versions where formula_id = f.id) <> 1
       or not exists (select 1 from public.formula_versions where formula_id = f.id and version = 1 and status = 'draft') then
      if f.client_id is null and o.client_id is not null then
        update public.formulas set client_id = o.client_id where id = f.id;
      end if;
      return f.id;
    end if;
  end if;

  -- A catalog offer: everything comes from the catalog product
  v_cat := o.data ->> 'mode' = 'catalog' and jsonb_typeof(o.data -> 'catalog') = 'object';

  -- Ingredients: the catalog composition, else the custom rows
  v_rows := case when v_cat then case when jsonb_typeof(o.data #> '{catalog,composition}') = 'array' then o.data #> '{catalog,composition}' else '[]'::jsonb end
                 when jsonb_typeof(o.data -> 'rows') = 'array' and jsonb_array_length(o.data -> 'rows') > 0 then o.data -> 'rows'
                 when jsonb_typeof(o.data #> '{catalog,composition}') = 'array' then o.data #> '{catalog,composition}'
                 else '[]'::jsonb end;
  for r in select * from jsonb_array_elements(v_rows) loop
    if coalesce(r ->> 'amount', '') ~ num then
      v_dose_g := v_dose_g + replace(btrim(r ->> 'amount'), ',', '.')::numeric
                  * case r ->> 'unit' when 'g' then 1 when 'mcg' then 0.000001 else 0.001 end;
    end if;
  end loop;

  if v_cat then
    v_caps := case when coalesce(o.data #>> '{catalog,capsules_per_serving}', '') ~ num then (o.data #>> '{catalog,capsules_per_serving}')::numeric end;
    v_pt := case when v_caps > 0 then case when o.data ->> 'jar' = 'glass' then 'capsules_glass' else 'capsules_plastic' end else 'powder' end;
    -- Capsules per jar: the count typed on the offer, else the standard of the product
    v_jarcaps := case when coalesce(o.data ->> 'catalogCapsules', '') ~ num and replace(o.data ->> 'catalogCapsules', ',', '.')::numeric > 0
                        then replace(o.data ->> 'catalogCapsules', ',', '.')::numeric
                      when coalesce(o.data #>> '{catalog,capsules_per_container}', '') ~ num then (o.data #>> '{catalog,capsules_per_container}')::numeric end;
    v_qty := case when v_caps > 0 then v_jarcaps end;
  else
    v_pt := coalesce(o.product_type, o.data ->> 'productType', '');
    v_caps := case when coalesce(o.data ->> 'capsulesPerDose', '') ~ num then replace(o.data ->> 'capsulesPerDose', ',', '.')::numeric
                   when coalesce(o.data #>> '{catalog,capsules_per_serving}', '') ~ num then (o.data #>> '{catalog,capsules_per_serving}')::numeric end;
    v_qty := case when coalesce(o.data ->> 'quantityPerUnit', '') ~ num then replace(o.data ->> 'quantityPerUnit', ',', '.')::numeric end;
  end if;

  if v_pt = 'powder' then
    v_format := 'powder';
    v_sunit := 'g';
    v_size := case when v_cat and coalesce(o.data #>> '{catalog,serving_g}', '') ~ num then (o.data #>> '{catalog,serving_g}')::numeric
                   when v_dose_g > 0 then round(v_dose_g, 3)
                   when coalesce(o.data #>> '{catalog,serving_g}', '') ~ num then (o.data #>> '{catalog,serving_g}')::numeric
                   else 1 end;
    v_per := coalesce(case when not v_cat then floor(v_qty)::int end,
                      case when coalesce(o.data #>> '{catalog,servings_per_container}', '') ~ num
                           then floor((o.data #>> '{catalog,servings_per_container}')::numeric)::int end);
  else
    v_format := 'capsule';
    v_sunit := 'pcs';
    v_size := coalesce(nullif(v_caps, 0), 1);
    v_per := coalesce(case when v_qty > 0 then floor(v_qty / v_size)::int end,
                      case when coalesce(o.data #>> '{catalog,servings_per_container}', '') ~ num
                           then floor((o.data #>> '{catalog,servings_per_container}')::numeric)::int end);
  end if;
  if v_per is not null and v_per <= 0 then
    v_per := null;
  end if;

  v_waste := public.calc_offer_waste(o.data);

  perform set_config('nk.recipe_sync', 'on', true);
  if f.id is null then
    -- The code is drawn here: the offer trigger may run without a signed-in user (a migration)
    update public.number_series set next_number = next_number + 1 where key = 'formula'
    returning prefix || lpad((next_number - 1)::text, pad_length, '0') into v_code;
    insert into public.formulas (code, name, product_format, client_id, serving_size, serving_unit, servings_per_pack, calc_offer_id, created_by)
    values (v_code, coalesce(nullif(btrim(o.product_name), ''), o.offer_no), v_format, o.client_id, v_size, v_sunit, v_per, o.id, o.created_by)
    returning * into f;
  else
    update public.formulas
       set name = coalesce(nullif(btrim(o.product_name), ''), o.offer_no), product_format = v_format,
           client_id = coalesce(o.client_id, client_id), serving_size = v_size, serving_unit = v_sunit, servings_per_pack = v_per
     where id = f.id;
  end if;
  select id into v_version from public.formula_versions where formula_id = f.id and version = 1;
  delete from public.formula_lines where version_id = v_version;
  delete from public.formula_pending_lines where version_id = v_version;

  for r in select * from jsonb_array_elements(v_rows) loop
    continue when coalesce(r ->> 'amount', '') !~ num or coalesce(btrim(r ->> 'name'), '') = '';
    v_amount := replace(btrim(r ->> 'amount'), ',', '.')::numeric;
    continue when v_amount <= 0;
    v_unit := case when r ->> 'unit' in ('mg', 'mcg', 'g') then (r ->> 'unit')::public.dose_unit else 'mg' end;
    v_mat := case when coalesce(r ->> 'materialId', '') ~* '^[0-9a-f-]{36}$'
                   and exists (select 1 from public.calc_raw_materials where id = (r ->> 'materialId')::uuid)
                  then (r ->> 'materialId')::uuid end;
    v_item := public.recipe_item_for(v_mat, r ->> 'name');
    v_n := v_n + 1;
    if v_item is not null then
      insert into public.formula_lines (version_id, item_id, amount, unit, overage_pct, sort_order)
      values (v_version, v_item, v_amount, v_unit, v_waste, v_n);
    else
      insert into public.formula_pending_lines (version_id, name, material_id, amount, unit, sort_order)
      values (v_version, btrim(r ->> 'name'), v_mat, v_amount, v_unit, v_n);
    end if;
  end loop;

  -- Capsule shell, jar and lid from the offer
  select * into pk from public.calc_offer_packaging(o.data, v_pt);
  update public.formulas set shell_item_id = case when v_format = 'capsule' then pk.shell end where id = f.id;
  delete from public.formula_packaging where version_id = v_version;
  insert into public.formula_packaging (version_id, item_id)
  select v_version, x from unnest(array[pk.jar, pk.lid]) x where x is not null;
  perform set_config('nk.recipe_sync', '', true);
  return f.id;
end
$$;

-- Untouched draft recipes of catalog offers are rebuilt with the rule above
select public.calc_offer_recipe_sync(o.id)
  from public.calc_offers o
 where o.data ->> 'mode' = 'catalog'
 order by o.created_at;

-- 2. A new version keeps the ingredients still to be linked ------------
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

  insert into public.formula_pending_lines (version_id, name, material_id, amount, unit, sort_order)
  select v_new, name, material_id, amount, unit, sort_order
    from public.formula_pending_lines where version_id = v_src.id;

  insert into public.formula_version_claims (version_id, claim_id)
  select v_new, claim_id from public.formula_version_claims where version_id = v_src.id;

  insert into public.formula_packaging (version_id, item_id, qty_per_pack)
  select v_new, item_id, qty_per_pack from public.formula_packaging where version_id = v_src.id;

  return v_new;
end
$$;

-- 3. Payment terms of an order from calculator offers -------------------
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
        -- a catalog price step (its price follows the capsules, jar and lid of the offer)
        v_ok := exists (select 1 from jsonb_array_elements(coalesce(o.data -> 'catalog' -> 'tiers', '[]'::jsonb)) t
                         where public.calc_num(t ->> 'min_qty') = v_qty);
      else
        -- a price tier: its own markup on the unit cost, rounded like the offer
        v_ok := exists (select 1 from jsonb_array_elements(coalesce(o.data -> 'priceTiers', '[]'::jsonb)) t
                         where public.calc_num(t ->> 'qty') = v_qty
                           and round(public.calc_num(o.results ->> 'unitCost') * (1 + public.calc_num(t ->> 'markup') / 100), 2) = v_price);
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

-- 4. The bookkeeper confirms the first payment --------------------------
create or replace function public.sales_orders_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_admin boolean := public.has_role('admin');
  -- Payments: Admin and the bookkeeper (owner, Oct 2026)
  v_pays  boolean := public.has_role('admin') or public.current_app_role() = 'bookkeeper';
begin
  if tg_op = 'INSERT' then
    if new.code is null or new.code = '' then
      new.code := public.next_number('sales_order');
    end if;
    return new;
  end if;

  if new.client_id <> old.client_id or new.currency <> old.currency then
    raise exception 'Client and currency of an order cannot be changed';
  end if;

  if new.status <> old.status then
    if not (
      (old.status = 'draft'         and new.status in ('unpaid', 'confirmed', 'cancelled')) or
      (old.status = 'unpaid'        and new.status in ('confirmed', 'cancelled')) or
      (old.status = 'confirmed'     and new.status in ('in_production', 'draft', 'cancelled')) or
      (old.status = 'in_production' and new.status in ('ready', 'cancelled', 'confirmed')) or
      (old.status = 'ready'         and new.status = 'dispatched') or
      (old.status = 'dispatched'    and new.status = 'closed') or
      (old.status = 'confirmed'     and new.status = 'unpaid' and current_setting('nk.cancel_payment', true) = 'on')
    ) then
      raise exception 'An order cannot go from % to %', old.status, new.status;
    end if;

    if new.status in ('unpaid', 'confirmed') and not exists (select 1 from public.sales_order_lines where order_id = new.id) then
      raise exception 'An order without products cannot be confirmed';
    end if;
    if old.status = 'unpaid' and new.status = 'confirmed' then
      if not v_pays then
        raise exception 'Only admin confirms the payment' using errcode = '42501';
      end if;
      new.deposit_received_on := coalesce(new.deposit_received_on, current_date);
      if not (coalesce(new.deposit_pct, 0) > 0 and new.deposit_pct < 100) then
        new.balance_received_on := coalesce(new.balance_received_on, current_date);
      end if;
    end if;
    -- An order with calculator offers goes back to unpaid, never to draft
    if new.status = 'draft' and exists (select 1 from public.sales_order_lines where order_id = new.id and kind <> 'offer') then
      raise exception 'An order from calculator offers cannot go back to draft';
    end if;
    if new.status = 'in_production' and coalesce(new.deposit_pct, 0) > 0
       and new.deposit_received_on is null and not v_admin then
      raise exception 'The deposit has not been received yet';
    end if;
    -- Production sees manufacturing orders only: the order is in production once one is sent to it
    if new.status = 'in_production' and not public.order_sent_to_production(new.id) then
      raise exception 'No manufacturing order of this order has been sent to production yet';
    end if;
    if old.status = 'in_production' and new.status = 'confirmed' and public.order_sent_to_production(new.id) then
      raise exception 'Production has this order; it cannot go back to confirmed';
    end if;
    if new.status = 'dispatched' and new.balance_terms = 'before_dispatch'
       and new.balance_received_on is null and not v_admin then
      raise exception 'The balance must be paid before dispatch';
    end if;

    if new.status = 'confirmed' and old.status in ('draft', 'unpaid') then
      new.confirmed_at := now();
    elsif new.status in ('draft', 'unpaid') then
      new.confirmed_at := null;
    elsif new.status = 'dispatched' then
      new.dispatched_at := now();
    end if;
  end if;
  return new;
end
$$;

-- 5. Prepare production: a recipe without servings per pack is named ----
create or replace function public.prepare_order_production(p_order uuid, p_date date default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  so          public.sales_orders;
  l           public.sales_order_lines;
  v_mo        public.manufacturing_orders;
  v_version   uuid;
  v_created   integer := 0;
  v_reserved  integer := 0;
  v_requests  integer := 0;
  v_missing   text[] := '{}';
  v_servings  text[] := '{}';
begin
  perform public.require_role('admin');
  select * into so from public.sales_orders where id = p_order;
  if not found then
    raise exception 'Order not found';
  end if;
  if so.status not in ('confirmed', 'in_production') then
    raise exception 'Confirm the payment first';
  end if;

  for l in select * from public.sales_order_lines
            where order_id = p_order and kind <> 'service' order by sort_order loop
    select * into v_mo from public.manufacturing_orders
     where sales_order_line_id = l.id and status <> 'cancelled' order by created_at desc limit 1;

    if v_mo.id is null then
      v_version := l.formula_version_id;
      if v_version is null and l.calc_offer_id is not null then
        select v.id into v_version
          from public.formulas f join public.formula_versions v on v.formula_id = f.id
         where f.calc_offer_id = l.calc_offer_id and v.status = 'approved'
         order by v.version desc limit 1;
      end if;
      if v_version is null then
        v_missing := v_missing || coalesce(l.description, '');
        continue;
      end if;
      -- A batch needs the servings per pack of its recipe
      if exists (select 1 from public.formula_versions v join public.formulas f on f.id = v.formula_id
                  where v.id = v_version and f.servings_per_pack is null) then
        v_servings := v_servings || coalesce(l.description, '');
        continue;
      end if;
      if l.formula_version_id is null then
        perform public.link_order_line_formula(l.id, v_version);
      end if;
      insert into public.manufacturing_orders (sales_order_line_id, quantity)
      values (l.id, l.quantity) returning * into v_mo;
      v_created := v_created + 1;
    end if;

    continue when v_mo.status not in ('simulation', 'scheduled');
    if p_date is not null then
      v_reserved := v_reserved + public.schedule_mo(v_mo.id, p_date);
    else
      v_reserved := v_reserved + public.reserve_mo_materials(v_mo.id);
    end if;
    v_requests := v_requests + public.create_purchase_requests(v_mo.id);
  end loop;

  return jsonb_build_object('created', v_created, 'reserved', v_reserved, 'requested', v_requests,
                            'no_recipe', to_jsonb(v_missing), 'no_servings', to_jsonb(v_servings));
end
$$;
revoke execute on function public.prepare_order_production(uuid, date) from public, anon;
grant execute on function public.prepare_order_production(uuid, date) to authenticated;

-- 4b. The payment dates are set by Admin and the bookkeeper (Sales still cannot type them)
create or replace function public.sales_orders_payment_dates_guard()
returns trigger
language plpgsql
as $$
begin
  if (new.deposit_received_on, new.balance_received_on) is distinct from
     (old.deposit_received_on, old.balance_received_on)
     and not (public.has_role('admin') or public.current_app_role() = 'bookkeeper') then
    raise exception 'Only admin enters the payment dates' using errcode = '42501';
  end if;
  return new;
end
$$;

-- 6. Materials of a batch that wait in the Nutrikal warehouse go to the partner -------------
-- Reservations are per item, so the lots can move: the partner may only use stock at its own
-- locations, and nothing in the app moved it there. Released lots, the earliest expiry first,
-- as much as the batch still needs at production once the other open batches are served;
-- ingredients to PF-RM, packaging to PF-PACK.
create or replace function public.move_mo_materials_to_production(p_mo uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  mo      public.manufacturing_orders;
  q       record;
  b       record;
  v_need  numeric;
  v_qty   numeric;
  v_to    uuid;
  v_n     integer := 0;
begin
  perform public.require_role('admin');
  select * into mo from public.manufacturing_orders where id = p_mo;
  if not found then
    raise exception 'Unknown manufacturing order';
  end if;
  if mo.status not in ('simulation', 'scheduled', 'released', 'in_production') then
    raise exception 'Materials cannot be moved for a % manufacturing order', mo.status;
  end if;

  for q in select r.item_id, r.required, i.type from public.mo_required_materials(p_mo) r join public.items i on i.id = r.item_id loop
    -- What is at production serves the other open batches first
    v_need := least(q.required,
                    q.required
                    + coalesce((select sum(x.required) from public.manufacturing_orders o2
                                  cross join lateral public.mo_required_materials(o2.id) x
                                 where o2.id <> p_mo and o2.status in ('scheduled', 'released', 'in_production') and x.item_id = q.item_id), 0)
                    - coalesce((select sum(s.quantity) from public.stock_balances s
                                 where s.item_id = q.item_id and s.qc_status = 'released' and not s.is_expired
                                   and public.is_production_location(s.location_id)), 0));
    continue when v_need <= 0;
    select id into v_to from public.locations where code = case when q.type = 'packaging' then 'PF-PACK' else 'PF-RM' end;
    for b in select s.lot_id, s.location_id, s.quantity from public.stock_balances s
              where s.item_id = q.item_id and s.qc_status = 'released' and not s.is_expired and s.quantity > 0
                and not public.is_production_location(s.location_id)
              order by s.expires_on nulls last, s.lot_number loop
      exit when v_need <= 0;
      v_qty := least(v_need, b.quantity);
      perform public.transfer_stock(b.lot_id, b.location_id, v_to, v_qty, 'For production ' || mo.code, mo.code);
      v_need := v_need - v_qty;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.move_mo_materials_to_production(uuid) from public, anon;
grant execute on function public.move_mo_materials_to_production(uuid) to authenticated;
