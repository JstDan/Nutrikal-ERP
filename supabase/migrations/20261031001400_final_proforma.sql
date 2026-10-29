-- =====================================================================
-- Nutrikal ERP + CRM — final proforma: produced quantities and transport
-- Owner, 29 Oct 2026: offers carry no waste. The extra raw material is
-- filled into more capsules, so a batch can give more (or fewer) units
-- than ordered. Production (or admin) reports the raw materials used and
-- the units made when the batch is completed (complete_production, as
-- before: that is the stock side). The client pays the units actually
-- made: once every batch of the order is made, the final proforma and the
-- final invoice take the produced quantities. Transport is a sum typed on
-- the order (EUR, excl. VAT) and a line of its own.
--
--                         admin   sales   production
-- set the transport        yes     yes     —
-- final lines / totals     yes     yes     —
-- =====================================================================

alter table public.sales_orders
  add column transport_amount numeric(12, 2) check (transport_amount is null or transport_amount >= 0);

/** Every product line of the order has a batch made, and no batch of it is still open. */
create or replace function public.order_production_done(p_order uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.sales_order_lines l where l.order_id = p_order and l.kind <> 'service')
     and not exists (
       select 1 from public.sales_order_lines l
        where l.order_id = p_order and l.kind <> 'service'
          and not exists (select 1 from public.manufacturing_orders mo where mo.sales_order_line_id = l.id and mo.status = 'completed'))
     and not exists (
       select 1 from public.sales_order_lines l join public.manufacturing_orders mo on mo.sales_order_line_id = l.id
        where l.order_id = p_order and mo.status not in ('completed', 'cancelled'))
$$;

/**
 * The lines of an order as they are invoiced at the end: once every batch is made, a product line
 * takes the units produced (all its completed batches); before that, and for services, the quantity
 * ordered. Transport is not a line here (sales_orders.transport_amount).
 */
create or replace function public.order_final_lines(p_order uuid)
returns table (
  line_id uuid, sort_order integer, kind text, description text, offer_no text, capsules integer,
  ordered integer, produced integer, quantity integer, unit_price numeric, amount numeric
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_done boolean;
begin
  perform public.require_role('admin', 'sales');
  v_done := public.order_production_done(p_order);
  return query
    select l.id, l.sort_order, l.kind::text, coalesce(l.description, f.name, ''), coalesce(co.offer_no, of.code)::text,
           case
             when co.data ->> 'mode' = 'catalog' then
               case when co.data ->> 'catalogCapsules' ~ '^[0-9]+$' then (co.data ->> 'catalogCapsules')::int
                    else nullif(co.data -> 'catalog' ->> 'capsules_per_container', '')::int end
             when co.data ->> 'productType' like 'capsules%' and co.data ->> 'quantityPerUnit' ~ '^[0-9]+$'
               then (co.data ->> 'quantityPerUnit')::int
           end,
           l.quantity, m.produced,
           case when v_done and l.kind <> 'service' then coalesce(m.produced, l.quantity) else l.quantity end,
           l.unit_price,
           round((case when v_done and l.kind <> 'service' then coalesce(m.produced, l.quantity) else l.quantity end) * l.unit_price, 2)
      from public.sales_order_lines l
      left join public.calc_offers co on co.id = l.calc_offer_id
      left join public.offers of on of.id = l.offer_id
      left join public.formula_versions v on v.id = l.formula_version_id
      left join public.formulas f on f.id = v.formula_id
      left join lateral (select sum(mo.produced_quantity)::int as produced from public.manufacturing_orders mo
                          where mo.sales_order_line_id = l.id and mo.status = 'completed') m on true
     where l.order_id = p_order
     order by l.sort_order;
end
$$;

/**
 * Net and gross total of an order as it is invoiced (lines rounded as on the invoice): the units
 * produced once every batch is made, plus transport. Admin and sales.
 */
create or replace function public.order_totals(p_order uuid, out net numeric, out gross numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  select t.n + coalesce(so.transport_amount, 0), round((t.n + coalesce(so.transport_amount, 0)) * (1 + coalesce(so.vat_pct, 0) / 100), 2)
    into net, gross
    from public.sales_orders so,
         lateral (select coalesce(sum(x.amount), 0) as n from public.order_final_lines(so.id) x) t
   where so.id = p_order;
end
$$;

/** Transport of an order, EUR excl. VAT (null or 0 = none). Not once the final (or full) invoice is issued. */
create or replace function public.set_order_transport(p_order uuid, p_amount numeric)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  so public.sales_orders;
begin
  perform public.require_role('admin', 'sales');
  select * into so from public.sales_orders where id = p_order for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if so.status = 'cancelled' then
    raise exception 'The order is cancelled';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'Enter a transport cost of zero or more';
  end if;
  if exists (select 1 from public.invoices where order_id = p_order and kind = 'invoice' and purpose in ('final', 'full') and status = 'issued') then
    raise exception 'The invoice of the order is issued: correct it with a credit or debit note';
  end if;
  update public.sales_orders set transport_amount = nullif(round(p_amount, 2), 0) where id = p_order;
  -- A draft final invoice is made again with the new transport
  delete from public.invoices where order_id = p_order and kind = 'invoice' and purpose = 'final' and status = 'draft';
end
$$;

/**
 * An invoice of a paid order: the existing one of that purpose, or a new draft.
 * p_purpose: 'full' (paid at once), 'advance' or 'final'; null = the one due now.
 * The final invoice: the units produced (once every batch is made) and transport, less the advance.
 */
create or replace function public.create_order_invoice(p_order uuid, p_purpose text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  so      public.sales_orders;
  v_two   boolean;
  v_id    uuid;
  v_loc   text;
  v_base  numeric;
  adv     public.invoices;
  p       record;
begin
  perform public.require_role('admin', 'sales');
  select * into so from public.sales_orders where id = p_order;
  if not found then
    raise exception 'Order not found';
  end if;
  v_two := public.order_paid_in_two(p_order);
  select * into adv from public.invoices where order_id = p_order and kind = 'invoice' and purpose = 'advance';
  if p_purpose is null then
    p_purpose := case when not v_two then 'full'
                      when so.balance_received_on is not null and adv.status = 'issued' then 'final'
                      else 'advance' end;
  end if;
  if p_purpose not in ('full', 'advance', 'final') then
    raise exception 'Unknown kind of invoice';
  end if;
  select id into v_id from public.invoices where order_id = p_order and kind = 'invoice' and purpose = p_purpose;
  if v_id is not null then
    return v_id;
  end if;
  if so.status in ('draft', 'unpaid', 'cancelled') then
    raise exception 'The invoice is issued once the payment is confirmed';
  end if;
  if (p_purpose = 'full') = v_two then
    raise exception 'This order is paid with an advance and a final payment';
  end if;
  if p_purpose = 'advance' and so.deposit_received_on is null then
    raise exception 'The advance invoice is issued once the advance is received';
  end if;
  if p_purpose = 'final' then
    if so.balance_received_on is null then
      raise exception 'The final invoice is issued once the final payment is confirmed';
    end if;
    if adv.status is distinct from 'issued' then
      raise exception 'Issue the advance invoice first';
    end if;
    -- Orders with batches are invoiced at the units made
    if exists (select 1 from public.sales_order_lines l join public.manufacturing_orders mo on mo.sales_order_line_id = l.id
                where l.order_id = p_order and mo.status <> 'cancelled')
       and not public.order_production_done(p_order) then
      raise exception 'The final invoice is made once every batch of the order is produced';
    end if;
  end if;

  select * into p from public.invoice_parties(p_order);
  select case when c.preferred_locale = 'bg' then 'bg' else 'en' end into v_loc from public.clients c where c.id = so.client_id;
  insert into public.invoices (kind, purpose, order_id, client_id, tax_point_date, currency, vat_pct, locale, seller, buyer, notes)
  values ('invoice', p_purpose, so.id, so.client_id,
          case p_purpose when 'advance' then so.deposit_received_on when 'final' then so.balance_received_on
                         else coalesce(so.balance_received_on, so.deposit_received_on, current_date) end,
          so.currency, coalesce(so.vat_pct, 0), v_loc, p.seller, p.buyer, so.notes)
  returning id into v_id;

  if p_purpose = 'advance' then
    if so.deposit_amount is not null then
      -- The amount received includes VAT: the base is amount / (1 + VAT %)
      v_base := round(so.deposit_amount / (1 + coalesce(so.vat_pct, 0) / 100), 2);
      insert into public.invoice_lines (invoice_id, sort_order, kind, description, quantity, unit_price, amount)
      values (v_id, 0, 'advance',
              case when v_loc = 'bg' then 'Авансово плащане по поръчка ' || so.code
                   else 'Advance payment for order ' || so.code end,
              1, v_base, v_base);
      return v_id;
    end if;
    select coalesce(sum(round(l.quantity * l.unit_price, 2)), 0) into v_base from public.sales_order_lines l where l.order_id = p_order;
    insert into public.invoice_lines (invoice_id, sort_order, kind, description, quantity, unit_price, amount)
    values (v_id, 0, 'advance',
            case when v_loc = 'bg' then 'Авансово плащане ' || trim_scale(so.deposit_pct) || '% по поръчка ' || so.code
                 else 'Advance payment ' || trim_scale(so.deposit_pct) || '% for order ' || so.code end,
            1, round(v_base * so.deposit_pct / 100, 2), round(v_base * so.deposit_pct / 100, 2));
    return v_id;
  end if;

  if p_purpose = 'final' then
    insert into public.invoice_lines (invoice_id, sort_order, kind, description, offer_no, capsules, quantity, unit_price, amount)
    select v_id, x.sort_order, x.kind, x.description, x.offer_no, x.capsules, x.quantity, x.unit_price, x.amount
      from public.order_final_lines(p_order) x;
  else
    insert into public.invoice_lines (invoice_id, sort_order, kind, description, offer_no, capsules, quantity, unit_price, amount)
    select v_id, x.sort_order, x.kind, x.description, x.offer_no, x.capsules, x.ordered, x.unit_price, round(x.ordered * x.unit_price, 2)
      from public.order_final_lines(p_order) x;
  end if;

  -- Transport, a line of its own
  if coalesce(so.transport_amount, 0) > 0 then
    insert into public.invoice_lines (invoice_id, sort_order, kind, description, quantity, unit_price, amount)
    values (v_id, 99999, 'service', case when v_loc = 'bg' then 'Транспорт' else 'Transport' end, 1, so.transport_amount, so.transport_amount);
  end if;

  -- The final invoice deducts the advance invoiced
  if p_purpose = 'final' then
    insert into public.invoice_lines (invoice_id, sort_order, kind, description, quantity, unit_price, amount)
    values (v_id, 100000, 'advance',
            case when v_loc = 'bg' then 'Приспадане на аванс по фактура № ' || adv.number || ' от ' || to_char(adv.issue_date, 'DD.MM.YYYY')
                 else 'Less advance invoiced, invoice No ' || adv.number || ' of ' || to_char(adv.issue_date, 'DD.MM.YYYY') end,
            1, -adv.subtotal, -adv.subtotal);
  end if;
  return v_id;
end
$$;

revoke execute on function public.order_production_done(uuid) from public, anon;
grant execute on function public.order_production_done(uuid) to authenticated;
revoke execute on function public.order_final_lines(uuid) from public, anon;
grant execute on function public.order_final_lines(uuid) to authenticated;
revoke execute on function public.set_order_transport(uuid, numeric) from public, anon;
grant execute on function public.set_order_transport(uuid, numeric) to authenticated;
