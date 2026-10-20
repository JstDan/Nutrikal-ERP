-- =====================================================================
-- Nutrikal ERP + CRM — Formula Calculator (moved in from the separate
-- "nutrikal-calculator" app). Raw material price list synced from the
-- Google Sheet, calculator settings, saved calculator offers and their
-- yearly numbering (NK-YYYY-0001). Tables are prefixed calc_ so the
-- Phase 2 offers / formulation module can replace them cleanly.
--
--                     admin   sales   inventory   partner
-- calc_raw_materials  read*   read    —           —
-- calc_settings       write   read    —           —
-- calc_offers         all     write** —           —
-- calc_sync_runs      read    read    —           —
-- (*  names, prices and active status change only through the sheet
--     sync; admin may edit the regulatory note)
-- (** sales may delete only offers they created)
-- =====================================================================

-- ------------------------------------------------- raw material prices
-- Prices are DDP, EUR per kg, excl. VAT.
create table public.calc_raw_materials (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  price_eur_per_kg  numeric(12, 4) not null check (price_eur_per_kg >= 0),
  regulatory_note   text,
  active            boolean not null default true,
  updated_at        timestamptz not null default now()
);
comment on table public.calc_raw_materials is 'Calculator price list; the Google Sheet is the source of names and prices.';

create trigger calc_raw_materials_updated_at before update on public.calc_raw_materials
  for each row execute function public.set_updated_at();

-- ------------------------------------------------- settings (singleton)
create table public.calc_settings (
  id                          boolean primary key default true check (id),
  fixed_cost_capsules_glass   numeric(10, 2) not null default 2.50,
  fixed_cost_capsules_plastic numeric(10, 2) not null default 2.20,
  fixed_cost_powder           numeric(10, 2) not null default 2.70,
  default_markup              numeric(6, 2) not null default 30,
  default_vat_rate            numeric(5, 2) not null default 20,
  company_name                text not null default 'Nutrikal Ltd',
  company_id                  text not null default 'BG202245000',
  company_vat                 text not null default 'BG202245000',
  company_address             text not null default '133 Knyaz Boriz 1 Blvd., 9000 Varna, Bulgaria',
  company_email               text not null default 'sales@nutrikal.com',
  company_phone               text not null default '',
  bank_iban                   text not null default 'BG04FINV91501017654214 (EUR)',
  bank_name                   text not null default 'First Investment Bank AD',
  bank_bic                    text not null default 'FINVBGSF',
  bank_address                text not null default '37 Dragan Tsankov Blvd, 1797 Sofia, Bulgaria',
  default_payment_terms       text not null default '70% Down Payment and 30% Balance Payment when goods are ready to be shipped',
  vat_exemption_text          text not null default 'VAT Exemption',
  footer_text                 text not null default '',
  websites                    text not null default 'Nutrikal.com',
  service_presets             jsonb not null default '[
    {"description": "Free Sale Certificate", "unit": "pcs.", "price": 300},
    {"description": "Certificate of analysis", "unit": "pcs.", "price": 220},
    {"description": "Label design service", "unit": "pcs.", "price": 200}
  ]'::jsonb,
  logo_data_url               text,
  terms_text                  text not null default 'The prices are EUR/EXW excl. VAT, for the finished, ready-to-sell products and include raw materials, primary packaging materials, mixing, quality assurance, encapsulation where applicable, filling, sealing, capping where applicable, label and foil printing with basic effects, label application and shipment preparation. Lead time and MOQ to be confirmed upon order. This offer is valid for 14 business days.',
  google_sheet_url            text not null default 'https://docs.google.com/spreadsheets/d/1dfylFe0D-xWlQ1PXcVUAGtNrPNS4bGJK/edit?usp=sharing',
  updated_at                  timestamptz not null default now()
);

insert into public.calc_settings (id) values (true) on conflict (id) do nothing;

create trigger calc_settings_updated_at before update on public.calc_settings
  for each row execute function public.set_updated_at();
select public.enable_audit('public.calc_settings');

-- ------------------------------------------------------------- offers
-- `data` holds every form input incl. a snapshot of the raw material
-- prices and fixed costs used, so later price changes never alter old offers.
create table public.calc_offers (
  id              uuid primary key default gen_random_uuid(),
  offer_no        text not null unique,
  receiver_name   text not null,
  receiver_email  text not null,
  company_name    text,
  product_name    text,
  product_type    text check (product_type in ('capsules_glass', 'capsules_plastic', 'powder')),
  total_excl_vat  numeric(14, 2) not null default 0,
  total_incl_vat  numeric(14, 2) not null default 0,
  data            jsonb not null,
  results         jsonb not null,
  created_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index calc_offers_created_at_idx on public.calc_offers (created_at desc);

create trigger calc_offers_updated_at before update on public.calc_offers
  for each row execute function public.set_updated_at();
select public.enable_audit('public.calc_offers');

-- Sequential offer numbers per year: NK-YYYY-0001
create table public.calc_offer_counters (
  year     integer primary key,
  last_no  integer not null default 0
);

create or replace function public.calc_next_offer_no()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  y integer := extract(year from now())::integer;
  n integer;
begin
  perform public.require_role('admin', 'sales');
  insert into public.calc_offer_counters (year, last_no) values (y, 1)
  on conflict (year) do update set last_no = public.calc_offer_counters.last_no + 1
  returning last_no into n;
  return 'NK-' || y || '-' || lpad(n::text, 4, '0');
end
$$;

-- -------------------------------------------------- price-list sync
create table public.calc_sync_runs (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  source        text not null check (source in ('manual', 'scheduled', 'auto')),
  status        text not null check (status in ('success', 'error')),
  added         integer not null default 0,
  changed       integer not null default 0,
  unchanged     integer not null default 0,
  invalid       integer not null default 0,
  missing       integer not null default 0,
  removed       integer not null default 0,
  restored      integer not null default 0,
  error         text,
  triggered_by  uuid references public.profiles (id) on delete set null
);
create index calc_sync_runs_created_at_idx on public.calc_sync_runs (created_at desc);

-- Applies a sync plan built by the app from the Google Sheet (or logs a
-- failed run when p_error is set). Upserts by name, deactivates materials
-- no longer in the sheet; never deletes.
create or replace function public.calc_record_sync(p_source text, p_plan jsonb, p_stats jsonb, p_error text default null)
returns public.calc_sync_runs
language plpgsql security definer set search_path = public
as $$
declare
  r public.calc_sync_runs;
begin
  perform public.require_role('admin', 'sales');
  if p_source not in ('manual', 'auto') then
    raise exception 'Invalid sync source %', p_source;
  end if;

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

  insert into public.calc_sync_runs (source, status, added, changed, unchanged, invalid, missing, removed, restored, error, triggered_by)
  values (
    p_source,
    case when p_error is null then 'success' else 'error' end,
    coalesce((p_stats ->> 'added')::integer, 0),
    coalesce((p_stats ->> 'changed')::integer, 0),
    coalesce((p_stats ->> 'unchanged')::integer, 0),
    coalesce((p_stats ->> 'invalid')::integer, 0),
    coalesce((p_stats ->> 'missing')::integer, 0),
    coalesce((p_stats ->> 'removed')::integer, 0),
    coalesce((p_stats ->> 'restored')::integer, 0),
    p_error,
    auth.uid()
  )
  returning * into r;
  return r;
end
$$;

revoke execute on function public.calc_next_offer_no() from public, anon;
grant execute on function public.calc_next_offer_no() to authenticated;
revoke execute on function public.calc_record_sync(text, jsonb, jsonb, text) from public, anon;
grant execute on function public.calc_record_sync(text, jsonb, jsonb, text) to authenticated;

-- -------------------------------------------------- row-level security
alter table public.calc_raw_materials  enable row level security;
alter table public.calc_settings       enable row level security;
alter table public.calc_offers         enable row level security;
alter table public.calc_offer_counters enable row level security; -- no policies: only via calc_next_offer_no()
alter table public.calc_sync_runs      enable row level security; -- written only by calc_record_sync()

create policy calc_raw_materials_select on public.calc_raw_materials for select to authenticated
  using (public.has_role('admin', 'sales'));
create policy calc_raw_materials_update on public.calc_raw_materials for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
revoke insert, update, delete, truncate on public.calc_raw_materials from anon, authenticated;
grant select on public.calc_raw_materials to authenticated;
grant update (regulatory_note) on public.calc_raw_materials to authenticated;

create policy calc_settings_select on public.calc_settings for select to authenticated
  using (public.has_role('admin', 'sales'));
create policy calc_settings_update on public.calc_settings for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy calc_offers_select on public.calc_offers for select to authenticated
  using (public.has_role('admin', 'sales'));
create policy calc_offers_insert on public.calc_offers for insert to authenticated
  with check (public.has_role('admin', 'sales'));
create policy calc_offers_update on public.calc_offers for update to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));
create policy calc_offers_delete on public.calc_offers for delete to authenticated
  using (public.has_role('admin') or (public.has_role('sales') and created_by = auth.uid()));

create policy calc_sync_runs_select on public.calc_sync_runs for select to authenticated
  using (public.has_role('admin', 'sales'));
