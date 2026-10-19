-- =====================================================================
-- Nutrikal ERP + CRM — Phase 1 — 0001 core
-- Roles, user profiles, company settings, audit log, number series.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------
-- Roles
-- admin      : owner; everything, incl. QC release and settings
-- sales      : clients, projects, offers, orders, invoices
-- inventory  : items, suppliers, lots, stock, purchasing, planning
-- partner    : the partner facility user; production + their stock only
-- ---------------------------------------------------------------------
create type public.app_role   as enum ('admin', 'sales', 'inventory', 'partner');
create type public.app_locale as enum ('bg', 'en');

create table public.profiles (
  id                        uuid primary key references auth.users (id) on delete cascade,
  full_name                 text not null,
  email                     citext not null unique,
  role                      public.app_role not null,
  locale                    public.app_locale not null default 'bg',
  is_active                 boolean not null default true,
  -- Sales users do not see raw material purchase prices unless this is on.
  can_see_purchase_prices   boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
comment on table public.profiles is 'One row per app user (Nutrikal staff and the partner facility user).';

-- ---------------------------------------------------------------------
-- Role helpers (used by RLS policies and functions)
-- ---------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.has_role(variadic roles public.app_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_app_role() = any (roles), false)
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_role('admin', 'sales', 'inventory')
$$;

create or replace function public.can_see_purchase_prices()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select p.role in ('admin', 'inventory')
        or (p.role = 'sales' and p.can_see_purchase_prices)
    from public.profiles p
    where p.id = auth.uid() and p.is_active
  ), false)
$$;

create or replace function public.require_role(variadic roles public.app_role[])
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_role(variadic roles) then
    raise exception 'Not allowed for role %', coalesce(public.current_app_role()::text, 'anonymous')
      using errcode = '42501';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Company settings (single row): Nutrikal's own legal data for documents
-- and default commercial terms.
-- ---------------------------------------------------------------------
create type public.balance_terms as enum ('before_dispatch', 'net_days');

create table public.company_settings (
  id                      boolean primary key default true check (id),  -- singleton
  legal_name              text,
  trade_name              text default 'Nutrikal',
  vat_number              text,
  company_id              text,          -- EIK / UIC
  address_line1           text,
  address_line2           text,
  city                    text,
  postal_code             text,
  country_code            char(2) not null default 'BG',
  email                   citext,
  phone                   text,
  website                 text default 'https://nutrikal.com',
  bank_name               text,
  iban                    text,
  bic                     text,
  base_currency           char(3) not null default 'EUR',
  default_vat_rate        numeric(5, 2) not null default 20.00,
  default_deposit_pct     numeric(5, 2) check (default_deposit_pct between 0 and 100),
  default_balance_terms   public.balance_terms not null default 'before_dispatch',
  default_balance_net_days integer check (default_balance_net_days >= 0),
  expiry_warning_days     integer not null default 90 check (expiry_warning_days > 0),
  updated_at              timestamptz not null default now()
);

create trigger company_settings_updated_at before update on public.company_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Audit log: every insert/update/delete on audited tables
-- ---------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_id      text,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  changed_by  uuid default auth.uid(),
  changed_at  timestamptz not null default now()
);
create index audit_log_table_row_idx on public.audit_log (table_name, row_id);
create index audit_log_changed_at_idx on public.audit_log (changed_at desc);

create or replace function public.audit_trigger()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_log (table_name, row_id, action, old_data, new_data)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then to_jsonb(old) ->> 'id' else to_jsonb(new) ->> 'id' end,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end
$$;

-- Attach the audit trigger to a table: select public.enable_audit('public.clients');
create or replace function public.enable_audit(p_table regclass)
returns void language plpgsql set search_path = public
as $$
begin
  execute format(
    'create trigger audit_%s after insert or update or delete on %s
       for each row execute function public.audit_trigger()',
    replace(p_table::text, 'public.', ''), p_table);
end
$$;

select public.enable_audit('public.profiles');
select public.enable_audit('public.company_settings');

-- ---------------------------------------------------------------------
-- Number series: projects, clients, lots now; invoices and other
-- documents later. Admin can edit next_number (e.g. to continue from
-- the old invoicing tool). Gap/duplicate checks for invoices are added
-- with the invoicing module.
-- ---------------------------------------------------------------------
create table public.number_series (
  key          text primary key,
  label        text not null,
  prefix       text not null default '',
  next_number  bigint not null check (next_number > 0),
  pad_length   integer not null default 4 check (pad_length between 1 and 12),
  updated_at   timestamptz not null default now()
);

create trigger number_series_updated_at before update on public.number_series
  for each row execute function public.set_updated_at();
select public.enable_audit('public.number_series');

-- Atomically takes the next number of a series.
-- Partner user may only draw lot numbers (when receiving goods).
create or replace function public.next_number(p_key text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v public.number_series;
begin
  if not (public.is_staff() or (public.has_role('partner') and p_key = 'lot')) then
    raise exception 'Not allowed to draw numbers from series %', p_key using errcode = '42501';
  end if;

  update public.number_series
     set next_number = next_number + 1
   where key = p_key
  returning * into v;

  if not found then
    raise exception 'Unknown number series %', p_key;
  end if;

  return v.prefix || lpad((v.next_number - 1)::text, v.pad_length, '0');
end
$$;
