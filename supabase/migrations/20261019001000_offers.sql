-- =====================================================================
-- Nutrikal ERP + CRM — Phase 2 — 0010 costing and offers
-- Cost per unit from an approved formula version, packaging and the
-- production costs of the product format; offers with quantity tiers.
--
-- Rules
-- * An offer is for one client and one APPROVED formula version (the
--   client's own formula or a stock formula).
-- * Cost per pack = ingredients (input incl. overage and material loss)
--   + capsule shells + packaging, each at the current purchase price
--   for the quantity of that tier (price breaks apply)
--   + production fees of the format + set-up fee spread over the tier.
-- * A tier is priced from a margin on the price, or from a manual price
--   (the margin is then calculated). Costs are recalculated whenever a
--   tier or the packaging changes, and frozen once the offer is sent.
-- * Only draft offers can be changed. Set an offer back to draft to edit.
-- * Purchase prices per item stay hidden: the cost breakdown is only for
--   users who may see purchase prices. Sales see cost and margin per
--   tier.
--
--                         admin   sales   inventory   partner
-- offers, tiers, packaging all     all     —           —
-- format costing          write   read    —           —
-- cost breakdown          yes     price flag only     —
-- =====================================================================

create type public.offer_status as enum ('draft', 'sent', 'accepted', 'rejected', 'expired');

-- ---------------------------------------------------------------------
-- Production costs per product format (Admin keeps them up to date)
-- ---------------------------------------------------------------------
create table public.format_costing (
  product_format      public.product_format primary key,
  fee_per_pack        numeric(12, 4) not null default 0 check (fee_per_pack >= 0),        -- filling, labelling, boxing
  fee_per_1000_units  numeric(12, 4) not null default 0 check (fee_per_1000_units >= 0),  -- encapsulation / tableting
  fee_per_kg          numeric(12, 4) not null default 0 check (fee_per_kg >= 0),          -- blending, powder filling
  setup_fee           numeric(12, 2) not null default 0 check (setup_fee >= 0),           -- per batch
  loss_pct            numeric(5, 2)  not null default 3 check (loss_pct >= 0 and loss_pct < 100),
  default_margin_pct  numeric(5, 2)  not null default 30 check (default_margin_pct >= 0 and default_margin_pct < 100),
  min_order_packs     integer check (min_order_packs > 0),
  notes               text,
  updated_at          timestamptz not null default now()
);
create trigger format_costing_updated_at before update on public.format_costing
  for each row execute function public.set_updated_at();
select public.enable_audit('public.format_costing');

insert into public.format_costing (product_format)
select unnest(enum_range(null::public.product_format))
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Offers
-- ---------------------------------------------------------------------
create table public.offers (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,                           -- e.g. OF-00001
  client_id           uuid not null references public.clients (id),
  project_id          uuid references public.projects (id),
  formula_version_id  uuid not null references public.formula_versions (id),
  status              public.offer_status not null default 'draft',
  locale              public.app_locale,                              -- document language; default: client's
  currency            char(3) not null default 'EUR',
  incoterm            text not null default 'EXW',
  valid_until         date,
  deposit_pct         numeric(5, 2) check (deposit_pct between 0 and 100),
  balance_terms       public.balance_terms,
  balance_net_days    integer check (balance_net_days >= 0),
  notes               text,                                           -- printed on the offer
  internal_notes      text,
  sent_at             timestamptz,
  created_by          uuid default auth.uid() references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index offers_client_idx  on public.offers (client_id);
create index offers_project_idx on public.offers (project_id);

create table public.offer_packaging (
  id            uuid primary key default gen_random_uuid(),
  offer_id      uuid not null references public.offers (id) on delete cascade,
  item_id       uuid not null references public.items (id),
  qty_per_pack  numeric(12, 4) not null default 1 check (qty_per_pack > 0),
  unique (offer_id, item_id)
);

create table public.offer_tiers (
  id               uuid primary key default gen_random_uuid(),
  offer_id         uuid not null references public.offers (id) on delete cascade,
  quantity         integer not null check (quantity > 0),               -- packs
  margin_pct       numeric(5, 2) check (margin_pct < 100),
  unit_price       numeric(12, 4) check (unit_price > 0),
  price_is_manual  boolean not null default false,
  unit_cost        numeric(12, 4),
  cost_complete    boolean not null default false,                      -- every item had a purchase price
  unique (offer_id, quantity)
);
create index offer_tiers_offer_idx on public.offer_tiers (offer_id);

create trigger offers_updated_at before update on public.offers
  for each row execute function public.set_updated_at();
select public.enable_audit('public.offers');
select public.enable_audit('public.offer_packaging');
select public.enable_audit('public.offer_tiers');

-- ---------------------------------------------------------------------
-- Costing (internal: not callable by users, used by the triggers and
-- the role-checked functions below)
-- ---------------------------------------------------------------------

-- Current purchase price per base unit for the quantity bought.
-- Preferred supplier first, then the best price break that applies.
create or replace function public.item_unit_price(p_item uuid, p_qty numeric)
returns numeric
language sql stable security definer set search_path = public
as $$
  select sp.price
    from public.supplier_prices sp
    join public.supplier_items si on si.id = sp.supplier_item_id
   where si.item_id = p_item
     and sp.currency = 'EUR'
     and sp.min_quantity <= greatest(coalesce(p_qty, 0), 0)
     and sp.valid_from <= current_date
     and (sp.valid_to is null or sp.valid_to >= current_date)
   order by si.is_preferred desc, sp.min_quantity desc, sp.valid_from desc, sp.created_at desc
   limit 1
$$;

-- Cost lines per pack for an offer at a quantity (packs).
-- kind: ingredient | shell | packaging | production | setup
create or replace function public.offer_cost_lines(p_offer uuid, p_qty integer)
returns table (
  kind text, item_id uuid, sku text, name text, name_bg text,
  qty_per_pack numeric, base_unit public.base_unit, unit_price numeric, cost_per_pack numeric
)
language sql stable security definer set search_path = public
as $$
  with o as (
    select o.id, o.formula_version_id, f.product_format, f.serving_size, f.serving_unit, f.servings_per_pack, f.shell_item_id,
           fc.fee_per_pack, fc.fee_per_1000_units, fc.fee_per_kg, fc.setup_fee, fc.loss_pct
      from public.offers o
      join public.formula_versions v on v.id = o.formula_version_id
      join public.formulas f on f.id = v.formula_id
      join public.format_costing fc on fc.product_format = f.product_format
     where o.id = p_offer
  ),
  mat as (
    select 'ingredient'::text as kind, i.id, i.sku, i.name, i.name_bg, i.base_unit, 1 as ord, l.sort_order,
           l.amount_mg * (1 + l.overage_pct / 100) * o.servings_per_pack * (1 + o.loss_pct / 100)
             / case i.base_unit when 'kg' then 1000000 when 'g' then 1000 end as qty
      from o
      join public.formula_lines l on l.version_id = o.formula_version_id
      join public.items i on i.id = l.item_id
    union all
    select 'shell', i.id, i.sku, i.name, i.name_bg, i.base_unit, 2, 0,
           o.serving_size * o.servings_per_pack * (1 + o.loss_pct / 100)
      from o join public.items i on i.id = o.shell_item_id
     where o.serving_unit = 'pcs'
    union all
    select 'packaging', i.id, i.sku, i.name, i.name_bg, i.base_unit, 3, 0, op.qty_per_pack
      from public.offer_packaging op join public.items i on i.id = op.item_id
     where op.offer_id = p_offer
  ),
  priced as (
    select m.*, public.item_unit_price(m.id, m.qty * p_qty) as price from mat m
  )
  select * from (
    select kind, id, sku, name, name_bg, qty, base_unit, price, qty * price
      from priced
    union all
    select 'production', null, null, null, null, null, null, null,
           o.fee_per_pack
           + case when o.serving_unit = 'pcs' then o.fee_per_1000_units * o.serving_size * o.servings_per_pack / 1000 else 0 end
           + o.fee_per_kg * coalesce((select sum(l.amount_mg * (1 + l.overage_pct / 100))
                                        from public.formula_lines l where l.version_id = o.formula_version_id), 0)
             * o.servings_per_pack / 1000000
      from o
    union all
    select 'setup', null, null, null, null, null, null, null, o.setup_fee / p_qty
      from o
  ) x
$$;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create or replace function public.offers_defaults()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_status   public.formula_status;
  v_fclient  uuid;
  v_servings integer;
begin
  if tg_op = 'UPDATE' and old.status <> 'draft' and new.status = old.status then
    raise exception 'Only draft offers can be changed. Set the offer back to draft first.';
  end if;

  if tg_op = 'INSERT' then
    if new.code is null or new.code = '' then
      new.code := public.next_number('offer');
    end if;
    select coalesce(new.locale, c.preferred_locale),
           coalesce(new.deposit_pct, c.deposit_pct, s.default_deposit_pct),
           coalesce(new.balance_terms, c.balance_terms, s.default_balance_terms),
           coalesce(new.balance_net_days, c.balance_net_days, s.default_balance_net_days),
           coalesce(new.currency, c.currency)
      into new.locale, new.deposit_pct, new.balance_terms, new.balance_net_days, new.currency
      from public.clients c left join public.company_settings s on true
     where c.id = new.client_id;
    new.valid_until := coalesce(new.valid_until, current_date + 30);
  end if;

  if new.project_id is not null then
    select client_id into new.client_id from public.projects where id = new.project_id;
  end if;

  if tg_op = 'INSERT' or new.formula_version_id <> old.formula_version_id or new.client_id <> old.client_id then
    select v.status, f.client_id, f.servings_per_pack into v_status, v_fclient, v_servings
      from public.formula_versions v join public.formulas f on f.id = v.formula_id
     where v.id = new.formula_version_id;
    if v_status is distinct from 'approved' then
      raise exception 'An offer needs an approved formula version';
    end if;
    if v_fclient is not null and v_fclient <> new.client_id then
      raise exception 'This formula belongs to another client';
    end if;
    if v_servings is null then
      raise exception 'Set the servings per pack on the formula before making an offer';
    end if;
  end if;

  if new.status = 'sent' and (tg_op = 'INSERT' or old.status <> 'sent') then
    new.sent_at := now();
  end if;
  return new;
end
$$;

create trigger offers_defaults before insert or update on public.offers
  for each row execute function public.offers_defaults();

-- Tiers and packaging change only while the offer is a draft
create or replace function public.offer_draft_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_status public.offer_status;
begin
  select status into v_status from public.offers
   where id = case when tg_op = 'DELETE' then old.offer_id else new.offer_id end;
  if v_status is null and tg_op = 'DELETE' then
    return old;   -- the offer itself is being deleted
  end if;
  if v_status <> 'draft' then
    raise exception 'This offer is %; only draft offers can be changed.', v_status;
  end if;
  if tg_table_name = 'offer_packaging' and tg_op <> 'DELETE'
     and (select type from public.items where id = new.item_id) <> 'packaging' then
    raise exception 'Only packaging items can be added as packaging';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger offer_packaging_guard before insert or update or delete on public.offer_packaging
  for each row execute function public.offer_draft_guard();

-- Cost and price of a tier, calculated on every write
create or replace function public.offer_tiers_price()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_cost    numeric;
  v_missing integer;
  v_default numeric;
begin
  if (select status from public.offers where id = new.offer_id) <> 'draft' then
    raise exception 'Only draft offers can be changed.';
  end if;

  select sum(cost_per_pack), count(*) filter (where cost_per_pack is null)
    into v_cost, v_missing
    from public.offer_cost_lines(new.offer_id, new.quantity);
  new.unit_cost := round(coalesce(v_cost, 0), 4);
  new.cost_complete := v_missing = 0;

  if new.price_is_manual and new.unit_price is not null then
    new.margin_pct := round(100 * (new.unit_price - new.unit_cost) / new.unit_price, 2);
  else
    select fc.default_margin_pct into v_default
      from public.offers o
      join public.formula_versions v on v.id = o.formula_version_id
      join public.formulas f on f.id = v.formula_id
      join public.format_costing fc on fc.product_format = f.product_format
     where o.id = new.offer_id;
    new.price_is_manual := false;
    new.margin_pct := coalesce(new.margin_pct, v_default);
    new.unit_price := nullif(round(new.unit_cost / (1 - new.margin_pct / 100), 2), 0);
  end if;
  return new;
end
$$;

create trigger offer_tiers_price before insert or update on public.offer_tiers
  for each row execute function public.offer_tiers_price();

create or replace function public.offer_tiers_guard_delete()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (select status from public.offers where id = old.offer_id) <> 'draft' then
    raise exception 'Only draft offers can be changed.';
  end if;
  return old;
end
$$;

create trigger offer_tiers_guard_delete before delete on public.offer_tiers
  for each row execute function public.offer_tiers_guard_delete();

-- Recalculate the tiers when what they are made of changes
create or replace function public.offer_refresh_tiers()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_offer uuid;
begin
  if tg_table_name = 'offers' then
    if new.status <> 'draft' or new.formula_version_id = old.formula_version_id then
      return null;
    end if;
    v_offer := new.id;
  elsif tg_op = 'DELETE' then
    v_offer := old.offer_id;
  else
    v_offer := new.offer_id;
  end if;
  if exists (select 1 from public.offers where id = v_offer and status = 'draft') then
    update public.offer_tiers set quantity = quantity where offer_id = v_offer;
  end if;
  return null;
end
$$;

create trigger offer_packaging_refresh after insert or update or delete on public.offer_packaging
  for each row execute function public.offer_refresh_tiers();
create trigger offers_refresh after update on public.offers
  for each row execute function public.offer_refresh_tiers();

-- ---------------------------------------------------------------------
-- Functions for the app
-- ---------------------------------------------------------------------

-- Re-reads current purchase prices and format costs into the tiers
create or replace function public.recalc_offer(p_offer uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  if (select status from public.offers where id = p_offer) is distinct from 'draft' then
    raise exception 'Only draft offers can be recalculated';
  end if;
  update public.offer_tiers set quantity = quantity where offer_id = p_offer;
end
$$;

-- Cost lines with purchase prices: only for users who may see them
create or replace function public.offer_cost_breakdown(p_offer uuid, p_qty integer)
returns table (
  kind text, item_id uuid, sku text, name text, name_bg text,
  qty_per_pack numeric, base_unit public.base_unit, unit_price numeric, cost_per_pack numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (public.has_role('admin', 'sales') and public.can_see_purchase_prices()) then
    raise exception 'Not allowed to see purchase prices' using errcode = '42501';
  end if;
  return query select * from public.offer_cost_lines(p_offer, p_qty);
end
$$;

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.format_costing  enable row level security;
alter table public.offers          enable row level security;
alter table public.offer_packaging enable row level security;
alter table public.offer_tiers     enable row level security;

create policy format_costing_select on public.format_costing for select to authenticated
  using (public.has_role('admin', 'sales'));
create policy format_costing_update on public.format_costing for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy offers_select on public.offers for select to authenticated
  using (public.has_role('admin', 'sales'));
create policy offers_insert on public.offers for insert to authenticated
  with check (public.has_role('admin', 'sales'));
create policy offers_update on public.offers for update to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));
create policy offers_delete on public.offers for delete to authenticated
  using (public.has_role('admin', 'sales') and status = 'draft');

create policy offer_packaging_all on public.offer_packaging for all to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));
create policy offer_tiers_all on public.offer_tiers for all to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));

revoke execute on function
  public.item_unit_price(uuid, numeric),
  public.offer_cost_lines(uuid, integer),
  public.offers_defaults(),
  public.offer_draft_guard(),
  public.offer_tiers_price(),
  public.offer_tiers_guard_delete(),
  public.offer_refresh_tiers(),
  public.recalc_offer(uuid),
  public.offer_cost_breakdown(uuid, integer)
from public, anon, authenticated;

grant execute on function
  public.recalc_offer(uuid),
  public.offer_cost_breakdown(uuid, integer)
to authenticated;
