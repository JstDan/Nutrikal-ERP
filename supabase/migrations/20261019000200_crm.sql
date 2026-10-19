-- =====================================================================
-- Nutrikal ERP + CRM — Phase 1 — 0002 CRM
-- Clients, contacts, projects, activities, client files.
-- CRM lives in the same database as stock and production: projects are
-- the thread that links a client to formulas, offers, orders, batches,
-- reservations and invoices.
-- =====================================================================

create type public.client_status  as enum ('lead', 'active', 'inactive');
create type public.project_status as enum (
  'inquiry', 'formulation', 'offer', 'order', 'production', 'completed', 'on_hold', 'lost'
);
create type public.product_format as enum (
  'capsule', 'tablet', 'softgel', 'powder', 'sachet', 'stick_pack', 'liquid', 'gummy', 'bar', 'other'
);
create type public.activity_type  as enum ('note', 'call', 'email', 'meeting', 'task');

-- ---------------------------------------------------------------------
-- Clients (companies)
-- ---------------------------------------------------------------------
create table public.clients (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,                  -- e.g. NK-C-0001
  legal_name            text not null,
  trade_name            text,
  status                public.client_status not null default 'lead',
  country_code          char(2) not null default 'BG' check (country_code ~ '^[A-Z]{2}$'),
  vat_number            text,                                  -- incl. country prefix, e.g. BG123456789
  vat_validated_at      timestamptz,                           -- last successful VIES check
  company_id            text,                                  -- EIK / foreign registry number
  address_line1         text,
  address_line2         text,
  city                  text,
  postal_code           text,
  billing_email         citext,
  phone                 text,
  website               text,
  preferred_locale      public.app_locale not null default 'en',
  currency              char(3) not null default 'EUR',
  -- Payment terms; null = use company_settings defaults
  deposit_pct           numeric(5, 2) check (deposit_pct between 0 and 100),
  balance_terms         public.balance_terms,
  balance_net_days      integer check (balance_net_days >= 0),
  credit_limit          numeric(14, 2) check (credit_limit >= 0),
  owner_id              uuid references public.profiles (id),  -- account manager
  source                text,                                  -- website, referral, trade fair...
  notes                 text,
  created_by            uuid default auth.uid() references public.profiles (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint clients_net_days_chk check (balance_terms is distinct from 'net_days' or balance_net_days is not null)
);
create index clients_owner_idx  on public.clients (owner_id);
create index clients_status_idx on public.clients (status);
create index clients_name_idx   on public.clients (lower(legal_name));

create or replace function public.clients_defaults()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.code is null or new.code = '' then
    new.code := public.next_number('client');
  end if;
  if new.vat_number is not null then
    new.vat_number := upper(regexp_replace(new.vat_number, '[\s.-]', '', 'g'));
  end if;
  return new;
end
$$;

create trigger clients_defaults before insert on public.clients
  for each row execute function public.clients_defaults();
create trigger clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
select public.enable_audit('public.clients');

-- ---------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------
create table public.contacts (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  first_name    text not null,
  last_name     text,
  position      text,
  email         citext,
  phone         text,
  locale        public.app_locale,
  is_primary    boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index contacts_client_idx on public.contacts (client_id);
create unique index contacts_one_primary_idx on public.contacts (client_id) where is_primary;

create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();
select public.enable_audit('public.contacts');

-- ---------------------------------------------------------------------
-- Projects: one per product a client wants made.
-- The partner facility sees projects only by code (see partner_projects view).
-- ---------------------------------------------------------------------
create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,                    -- e.g. NK-P-0001
  client_id        uuid not null references public.clients (id),
  name             text not null,                           -- working product name
  product_format   public.product_format,
  status           public.project_status not null default 'inquiry',
  owner_id         uuid references public.profiles (id),
  expected_units   integer check (expected_units > 0),
  target_date      date,
  nda_signed       boolean not null default false,
  description      text,
  lost_reason      text,
  created_by       uuid default auth.uid() references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index projects_client_idx on public.projects (client_id);
create index projects_status_idx on public.projects (status);
create index projects_owner_idx  on public.projects (owner_id);

create or replace function public.projects_defaults()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.code is null or new.code = '' then
    new.code := public.next_number('project');
  end if;
  return new;
end
$$;

create trigger projects_defaults before insert on public.projects
  for each row execute function public.projects_defaults();
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
select public.enable_audit('public.projects');

-- ---------------------------------------------------------------------
-- Activities: notes, calls, emails, meetings, tasks
-- ---------------------------------------------------------------------
create table public.activities (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  project_id    uuid references public.projects (id) on delete set null,
  contact_id    uuid references public.contacts (id) on delete set null,
  type          public.activity_type not null default 'note',
  subject       text not null,
  body          text,
  due_at        timestamptz,
  done_at       timestamptz,
  assigned_to   uuid references public.profiles (id),
  created_by    uuid default auth.uid() references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index activities_client_idx  on public.activities (client_id, created_at desc);
create index activities_project_idx on public.activities (project_id);
create index activities_open_tasks_idx on public.activities (assigned_to, due_at)
  where type = 'task' and done_at is null;

create trigger activities_updated_at before update on public.activities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Client files: NDAs, briefs, artwork, specs (stored in Supabase Storage)
-- ---------------------------------------------------------------------
create table public.client_files (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients (id) on delete cascade,
  project_id     uuid references public.projects (id) on delete set null,
  category       text not null default 'other',   -- nda, brief, artwork, spec, other
  file_name      text not null,
  storage_path   text not null unique,            -- bucket "client-files"
  uploaded_by    uuid default auth.uid() references public.profiles (id),
  created_at     timestamptz not null default now()
);
create index client_files_client_idx on public.client_files (client_id);
