-- =====================================================================
-- Nutrikal ERP + CRM — Phase 1 — 0003 item master and suppliers
-- One item table for raw materials, excipients, packaging, semi-finished
-- and finished goods. Purchase prices live in their own table so the
-- partner facility and (by default) sales never see them.
-- =====================================================================

create type public.item_type as enum (
  'raw_material', 'excipient', 'packaging', 'semi_finished', 'finished_good'
);
create type public.base_unit as enum ('kg', 'g', 'l', 'ml', 'pcs');
create type public.novel_food_status as enum (
  'not_novel',        -- history of consumption before 15 May 1997
  'authorised',       -- on the Union list (Reg. 2015/2283 / 2017/2470)
  'pending',          -- application or consultation pending
  'not_authorised',   -- novel and not authorised: must not be used in food supplements
  'unknown'           -- not yet assessed
);
-- The 14 allergens of Annex II, Reg. (EU) 1169/2011
create type public.eu_allergen as enum (
  'cereals_gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk',
  'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs'
);

-- ---------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------
create table public.items (
  id                   uuid primary key default gen_random_uuid(),
  sku                  text not null unique,
  type                 public.item_type not null,
  name                 text not null,                 -- English
  name_bg              text,                          -- Bulgarian
  base_unit            public.base_unit not null,     -- all stock quantities use this unit
  is_active            boolean not null default true,
  is_lot_tracked       boolean not null default true,

  -- Raw materials and excipients
  latin_name           text,
  plant_part           text,
  extract_ratio        text,                          -- e.g. 10:1, or standardisation
  active_content_pct   numeric(7, 4) check (active_content_pct > 0 and active_content_pct <= 100),
  assay_basis          text,                          -- e.g. "elemental magnesium"
  excipient_function   text,                          -- filler, flow agent, coating...
  novel_food_status    public.novel_food_status,
  novel_food_reference text,                          -- Union list entry / conditions of use
  allergens            public.eu_allergen[] not null default '{}',
  is_vegan             boolean,
  is_vegetarian        boolean,
  storage_conditions   text,
  shelf_life_months    integer check (shelf_life_months > 0),
  regulatory_notes     text,

  -- Packaging
  capacity             numeric(12, 3),                -- e.g. 300 (ml) or 60 (count)
  capacity_unit        text,
  material             text,
  dimensions           text,

  -- Finished / semi-finished goods belong to a client project
  client_id            uuid references public.clients (id),
  project_id           uuid references public.projects (id),

  reorder_level        numeric(14, 4) check (reorder_level >= 0),
  notes                text,
  created_by           uuid default auth.uid() references public.profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint items_novel_food_required check (
    type not in ('raw_material', 'excipient') or novel_food_status is not null
  ),
  constraint items_finished_good_owner check (
    type <> 'finished_good' or (client_id is not null and project_id is not null)
  )
);
create index items_type_idx    on public.items (type) where is_active;
create index items_name_idx    on public.items (lower(name));
create index items_project_idx on public.items (project_id);

create trigger items_updated_at before update on public.items
  for each row execute function public.set_updated_at();
select public.enable_audit('public.items');

-- ---------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------
create table public.suppliers (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  country_code     char(2) check (country_code ~ '^[A-Z]{2}$'),
  vat_number       text,
  contact_name     text,
  email            citext,
  phone            text,
  website          text,
  address          text,
  is_approved      boolean not null default false,   -- supplier qualification done
  approval_notes   text,
  notes            text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index suppliers_name_uidx on public.suppliers (lower(name));

create trigger suppliers_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();
select public.enable_audit('public.suppliers');

-- Which supplier sells which item, and on what terms (no prices here)
create table public.supplier_items (
  id               uuid primary key default gen_random_uuid(),
  supplier_id      uuid not null references public.suppliers (id) on delete cascade,
  item_id          uuid not null references public.items (id) on delete cascade,
  supplier_sku     text,
  manufacturer     text,
  moq              numeric(14, 4) check (moq > 0),   -- in the item's base unit
  lead_time_days   integer check (lead_time_days >= 0),
  is_preferred     boolean not null default false,
  notes            text,
  created_at       timestamptz not null default now(),
  unique (supplier_id, item_id)
);
create index supplier_items_item_idx on public.supplier_items (item_id);
create unique index supplier_items_one_preferred_idx on public.supplier_items (item_id) where is_preferred;

-- Purchase prices with validity. History is kept; the current price is
-- the latest valid_from that is not past valid_to.
create table public.supplier_prices (
  id                uuid primary key default gen_random_uuid(),
  supplier_item_id  uuid not null references public.supplier_items (id) on delete cascade,
  price             numeric(14, 4) not null check (price >= 0),  -- per 1 base unit of the item
  currency          char(3) not null default 'EUR',
  min_quantity      numeric(14, 4) not null default 0,           -- price break
  valid_from        date not null default current_date,
  valid_to          date,
  source            text not null default 'manual',              -- manual, drive_sync
  created_by        uuid default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now(),
  constraint supplier_prices_dates_chk check (valid_to is null or valid_to >= valid_from)
);
create index supplier_prices_lookup_idx on public.supplier_prices (supplier_item_id, valid_from desc);
select public.enable_audit('public.supplier_prices');

-- Current price per supplier item and price break (RLS of the base tables applies)
create view public.current_supplier_prices
with (security_invoker = true) as
select distinct on (sp.supplier_item_id, sp.min_quantity)
       sp.supplier_item_id,
       si.supplier_id,
       si.item_id,
       sp.min_quantity,
       sp.price,
       sp.currency,
       sp.valid_from,
       sp.valid_to
  from public.supplier_prices sp
  join public.supplier_items si on si.id = sp.supplier_item_id
 where sp.valid_from <= current_date
   and (sp.valid_to is null or sp.valid_to >= current_date)
 order by sp.supplier_item_id, sp.min_quantity, sp.valid_from desc;
