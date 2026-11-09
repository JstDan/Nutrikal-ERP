-- Capsules in bulk (owner, Nov 2026): capsules supplied without retail packaging. No bottle, lid, label or seal and
-- none of their filling, sealing, capping, labelling or retail packing. In the calculator a unit is 1,000 capsules;
-- the price is ingredients and shells + capsules / 1,000 x the bulk production rate + the cost per batch + bulk
-- packaging, then the markup. The rate, the shells per 1,000 and the batch cost have editable defaults here (the
-- amounts are still to be confirmed with the production team); each offer keeps its own.

alter table public.calc_settings
  add column bulk_rate_per_1000   numeric(12, 4) not null default 0 check (bulk_rate_per_1000 >= 0),
  add column bulk_shells_per_1000 numeric(12, 4) not null default 0 check (bulk_shells_per_1000 >= 0),
  add column bulk_batch_cost      numeric(12, 2) not null default 0 check (bulk_batch_cost >= 0);

-- The product type of an offer may be capsules in bulk
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.calc_offers'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%product_type%' loop
    execute format('alter table public.calc_offers drop constraint %I', c);
  end loop;
end $$;
alter table public.calc_offers add constraint calc_offers_product_type_check
  check (product_type in ('capsules_glass', 'capsules_plastic', 'capsules_bulk', 'powder'));

/** The capsule shell, jar and lid (packaging items) chosen on a calculator offer; null where none. Bulk: the shell only. */
create or replace function public.calc_offer_packaging(p_data jsonb, p_product_type text, out shell uuid, out jar uuid, out lid uuid)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_pt   text := coalesce(nullif(p_product_type, ''), p_data ->> 'productType', '');
  v_jar  text;
  v_lid  text;
begin
  if v_pt not like 'capsules%' then
    return;
  end if;
  select id into shell from public.items where sku = 'PK-CAPS-00';
  -- Capsules in bulk: no bottle and no lid
  if v_pt = 'capsules_bulk' and coalesce(p_data ->> 'mode', 'custom') <> 'catalog' then
    return;
  end if;
  v_jar := case when p_data ->> 'mode' = 'catalog' then coalesce(p_data ->> 'jar', 'plastic')
                when v_pt = 'capsules_glass' then 'glass' else 'plastic' end;
  v_lid := case when v_jar = 'glass' and (p_data ->> 'mode' = 'catalog' or coalesce((p_data ->> 'catalogPackaging')::boolean, false))
                  then 'aluminium'
                else coalesce(p_data ->> 'lid', 'plastic') end;
  select id into jar from public.items where sku = case v_jar when 'glass' then 'PK-JAR-GL' else 'PK-JAR-PL' end;
  select id into lid from public.items where sku = case v_lid when 'aluminium' then 'PK-LID-AL' else 'PK-LID-PL' end;
end
$$;
revoke execute on function public.calc_offer_packaging(jsonb, text) from public, anon, authenticated;
