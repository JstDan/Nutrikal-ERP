-- =====================================================================
-- Nutrikal ERP + CRM — catalog products for the calculator
-- Besides custom formulas, the calculator offers catalog products
-- ("Каталожна формула"). They come from a second Google Sheet (code,
-- name, category and a unit price per quantity step, e.g. 500 / 1000+ /
-- 2500+ / 5000+ pcs.) and are synced together with the raw material price
-- list (daily 17:00 and the Sync button), through the same functions.
--
--                         admin   sales   production
-- calc_catalog_products   read    read    —
-- (names, steps and prices change only through the sheet sync)
-- =====================================================================

create table public.calc_catalog_products (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  category    text,
  -- Price steps, smallest first: [{"min_qty": 500, "price": 6.20}, …] (EUR per unit, EXW, excl. VAT)
  tiers       jsonb not null check (jsonb_typeof(tiers) = 'array' and jsonb_array_length(tiers) > 0),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);
comment on table public.calc_catalog_products is 'Calculator catalog; the catalog Google Sheet is the source of codes, names and prices.';

create trigger calc_catalog_products_updated_at before update on public.calc_catalog_products
  for each row execute function public.set_updated_at();

alter table public.calc_catalog_products enable row level security;
create policy calc_catalog_products_select on public.calc_catalog_products for select to authenticated
  using (public.has_role('admin', 'sales'));
revoke insert, update, delete, truncate on public.calc_catalog_products from anon, authenticated;
grant select on public.calc_catalog_products to authenticated;

alter table public.calc_settings
  add column catalog_sheet_url text not null
    default 'https://docs.google.com/spreadsheets/d/1WE7F6aTC3jezBPPC8oEnDS_aCee1Hpd1FPthdpYdPF0/edit?gid=0#gid=0';

-- The run also records the catalog part (number of products, or why it failed)
alter table public.calc_sync_runs
  add column catalog integer not null default 0,
  add column catalog_error text;

-- Shared body (see 20261024000100): p_error is a price-list failure (nothing
-- of the price list is applied); the catalog is applied whenever the plan
-- carries one (p_plan -> 'catalog'), and a catalog failure comes in
-- p_stats ->> 'catalog_error'. Either failure marks the run as an error,
-- so it is retried.
create or replace function public.calc_apply_sync(p_source text, p_plan jsonb, p_stats jsonb, p_error text, p_user uuid)
returns public.calc_sync_runs
language plpgsql security definer set search_path = public
as $$
declare
  r public.calc_sync_runs;
  v_catalog_error text := nullif(p_stats ->> 'catalog_error', '');
begin
  if p_error is null then
    insert into public.calc_raw_materials (name, price_eur_per_kg, active)
    select x.name, x.price_eur_per_kg, true
      from jsonb_to_recordset(coalesce(p_plan -> 'upserts', '[]'::jsonb)) as x(name text, price_eur_per_kg numeric)
    on conflict (name) do update
      set price_eur_per_kg = excluded.price_eur_per_kg, active = true;

    update public.calc_raw_materials set active = false
     where active
       and name in (select jsonb_array_elements_text(coalesce(p_plan -> 'deactivate', '[]'::jsonb)));
  end if;

  if jsonb_typeof(p_plan -> 'catalog') = 'array' and jsonb_array_length(p_plan -> 'catalog') > 0 then
    insert into public.calc_catalog_products (code, name, category, tiers, sort_order, active)
    select x.code, x.name, x.category, x.tiers, x.sort_order, true
      from jsonb_to_recordset(p_plan -> 'catalog') as x(code text, name text, category text, tiers jsonb, sort_order integer)
    on conflict (code) do update
      set name = excluded.name, category = excluded.category, tiers = excluded.tiers,
          sort_order = excluded.sort_order, active = true;

    update public.calc_catalog_products set active = false
     where active
       and code not in (select x ->> 'code' from jsonb_array_elements(p_plan -> 'catalog') x);
  end if;

  insert into public.calc_sync_runs (source, status, added, changed, unchanged, invalid, missing, removed, restored,
                                     catalog, catalog_error, error, triggered_by)
  values (
    p_source,
    case when p_error is null and v_catalog_error is null then 'success' else 'error' end,
    coalesce((p_stats ->> 'added')::integer, 0),
    coalesce((p_stats ->> 'changed')::integer, 0),
    coalesce((p_stats ->> 'unchanged')::integer, 0),
    coalesce((p_stats ->> 'invalid')::integer, 0),
    coalesce((p_stats ->> 'missing')::integer, 0),
    coalesce((p_stats ->> 'removed')::integer, 0),
    coalesce((p_stats ->> 'restored')::integer, 0),
    coalesce(jsonb_array_length(case when jsonb_typeof(p_plan -> 'catalog') = 'array' then p_plan -> 'catalog' end), 0),
    v_catalog_error,
    p_error,
    p_user
  )
  returning * into r;
  return r;
end
$$;

revoke execute on function public.calc_apply_sync(text, jsonb, jsonb, text, uuid) from public, anon, authenticated, service_role;
