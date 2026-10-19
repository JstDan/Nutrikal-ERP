-- =====================================================================
-- Nutrikal ERP + CRM — Phase 2 — 0009 formulation
-- Formulas per serving, versions, nutrients with NRV, health claims and
-- the checks that run before a version is approved.
--
-- Rules
-- * A formula has numbered versions. Only a draft can be changed; an
--   approved version is locked (even for the database owner) and the
--   way to change it is a new version. Approving a version archives the
--   previously approved one.
-- * Admin and Sales write drafts; only Admin approves.
-- * Approval is refused without lines, without a shelf life, or with an
--   ingredient that is Novel Food "not authorised".
-- * Label amounts and % NRV are calculated from the declared amounts
--   (without overage) and the nutrient content of each item.
--
--                         admin   sales   inventory   partner
-- formulas / versions     all     write   read        —
-- lines / claims on them  write   write   read        —
-- nutrients, claims list  write   read    read        —
-- item nutrient content   write   read    write       —
-- (partner: nothing until production instructions arrive in Phase 3)
-- =====================================================================

create type public.formula_status as enum ('draft', 'approved', 'archived');
create type public.dose_unit      as enum ('mg', 'mcg', 'g');
create type public.serving_unit   as enum ('pcs', 'g', 'ml');

insert into public.number_series (key, label, prefix, next_number, pad_length)
values ('formula', 'Formula code', 'NK-F-', 1, 4)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Nutrients and reference intakes (NRV, Reg. (EU) 1169/2011 Annex XIII
-- part A). Substances without an NRV can be added with nrv = null.
-- ---------------------------------------------------------------------
create table public.nutrients (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  name_bg     text,
  unit        public.dose_unit not null check (unit in ('mg', 'mcg')),
  nrv         numeric(12, 4) check (nrv > 0),
  sort_order  integer not null default 0
);
select public.enable_audit('public.nutrients');

insert into public.nutrients (code, name, name_bg, unit, nrv, sort_order) values
  ('vit_a',       'Vitamin A',        'Витамин A',          'mcg',  800,  10),
  ('vit_d',       'Vitamin D',        'Витамин D',          'mcg',    5,  20),
  ('vit_e',       'Vitamin E',        'Витамин E',          'mg',    12,  30),
  ('vit_k',       'Vitamin K',        'Витамин K',          'mcg',   75,  40),
  ('vit_c',       'Vitamin C',        'Витамин C',          'mg',    80,  50),
  ('thiamin',     'Thiamin',          'Тиамин',             'mg',   1.1,  60),
  ('riboflavin',  'Riboflavin',       'Рибофлавин',         'mg',   1.4,  70),
  ('niacin',      'Niacin',           'Ниацин',             'mg',    16,  80),
  ('vit_b6',      'Vitamin B6',       'Витамин B6',         'mg',   1.4,  90),
  ('folic_acid',  'Folic acid',       'Фолиева киселина',   'mcg',  200, 100),
  ('vit_b12',     'Vitamin B12',      'Витамин B12',        'mcg',  2.5, 110),
  ('biotin',      'Biotin',           'Биотин',             'mcg',   50, 120),
  ('pantothenic', 'Pantothenic acid', 'Пантотенова киселина', 'mg',   6, 130),
  ('potassium',   'Potassium',        'Калий',              'mg',  2000, 140),
  ('chloride',    'Chloride',         'Хлорид',             'mg',   800, 150),
  ('calcium',     'Calcium',          'Калций',             'mg',   800, 160),
  ('phosphorus',  'Phosphorus',       'Фосфор',             'mg',   700, 170),
  ('magnesium',   'Magnesium',        'Магнезий',           'mg',   375, 180),
  ('iron',        'Iron',             'Желязо',             'mg',    14, 190),
  ('zinc',        'Zinc',             'Цинк',               'mg',    10, 200),
  ('copper',      'Copper',           'Мед',                'mg',     1, 210),
  ('manganese',   'Manganese',        'Манган',             'mg',     2, 220),
  ('fluoride',    'Fluoride',         'Флуорид',            'mg',   3.5, 230),
  ('selenium',    'Selenium',         'Селен',              'mcg',   55, 240),
  ('chromium',    'Chromium',         'Хром',               'mcg',   40, 250),
  ('molybdenum',  'Molybdenum',       'Молибден',           'mcg',   50, 260),
  ('iodine',      'Iodine',           'Йод',                'mcg',  150, 270)
on conflict (code) do nothing;

-- How much of a nutrient an item contains, e.g. magnesium bisglycinate
-- ≈ 14 % elemental magnesium, vitamin C (ascorbic acid) 100 % vitamin C.
create table public.item_nutrients (
  item_id      uuid not null references public.items (id) on delete cascade,
  nutrient_id  uuid not null references public.nutrients (id),
  content_pct  numeric(7, 4) not null check (content_pct > 0 and content_pct <= 100),
  primary key (item_id, nutrient_id)
);
select public.enable_audit('public.item_nutrients');

-- Authorised health claims (EU Register, Reg. (EC) 1924/2006 and
-- Reg. (EU) 432/2012) with the minimum amount per serving. Wording must
-- be copied exactly from the Register in each language.
create table public.health_claims (
  id              uuid primary key default gen_random_uuid(),
  nutrient_id     uuid not null references public.nutrients (id),
  claim_en        text not null,
  claim_bg        text,
  register_ref    text,                                   -- EU Register entry / ID
  min_pct_nrv     numeric(6, 2) not null default 15 check (min_pct_nrv >= 0),
  min_amount_mg   numeric(14, 6) check (min_amount_mg > 0),  -- for nutrients without an NRV
  conditions      text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
select public.enable_audit('public.health_claims');

-- ---------------------------------------------------------------------
-- Formulas
-- ---------------------------------------------------------------------
create table public.formulas (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,                 -- e.g. NK-F-0001
  name               text not null,
  name_bg            text,
  product_format     public.product_format not null,
  client_id          uuid references public.clients (id),  -- empty = stock / catalogue formula
  project_id         uuid references public.projects (id),
  serving_size       numeric(10, 3) not null check (serving_size > 0),  -- e.g. 2 (capsules) or 5 (g)
  serving_unit       public.serving_unit not null default 'pcs',
  servings_per_pack  integer check (servings_per_pack > 0),
  shell_item_id      uuid references public.items (id),    -- capsule shell
  description        text,
  is_active          boolean not null default true,
  created_by         uuid default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index formulas_project_idx on public.formulas (project_id);
create index formulas_client_idx  on public.formulas (client_id);

create or replace function public.formulas_defaults()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' and (new.code is null or new.code = '') then
    new.code := public.next_number('formula');
  end if;
  -- The client always follows the project
  if new.project_id is not null then
    select client_id into new.client_id from public.projects where id = new.project_id;
  end if;
  if new.shell_item_id is not null
     and (select type from public.items where id = new.shell_item_id) <> 'packaging' then
    raise exception 'The capsule shell must be a packaging item';
  end if;
  return new;
end
$$;

create trigger formulas_defaults before insert or update on public.formulas
  for each row execute function public.formulas_defaults();
create trigger formulas_updated_at before update on public.formulas
  for each row execute function public.set_updated_at();
select public.enable_audit('public.formulas');

-- ---------------------------------------------------------------------
-- Versions
-- ---------------------------------------------------------------------
create table public.formula_versions (
  id                 uuid primary key default gen_random_uuid(),
  formula_id         uuid not null references public.formulas (id) on delete cascade,
  version            integer not null check (version > 0),
  status             public.formula_status not null default 'draft',
  shelf_life_months  integer check (shelf_life_months > 0),
  change_note        text,
  notes              text,
  approved_by        uuid references public.profiles (id),
  approved_at        timestamptz,
  created_by         uuid default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (formula_id, version)
);
create unique index formula_versions_one_draft_idx    on public.formula_versions (formula_id) where status = 'draft';
create unique index formula_versions_one_approved_idx on public.formula_versions (formula_id) where status = 'approved';

create trigger formula_versions_updated_at before update on public.formula_versions
  for each row execute function public.set_updated_at();
select public.enable_audit('public.formula_versions');

-- Version 1 is created with the formula
create or replace function public.formulas_first_version()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.formula_versions (formula_id, version, created_by) values (new.id, 1, auth.uid());
  return new;
end
$$;

create trigger formulas_first_version after insert on public.formulas
  for each row execute function public.formulas_first_version();

-- ---------------------------------------------------------------------
-- Lines: ingredients per serving
-- ---------------------------------------------------------------------
create table public.formula_lines (
  id           uuid primary key default gen_random_uuid(),
  version_id   uuid not null references public.formula_versions (id) on delete cascade,
  item_id      uuid not null references public.items (id),
  amount       numeric(14, 4) not null check (amount > 0),   -- declared amount per serving
  unit         public.dose_unit not null default 'mg',
  amount_mg    numeric generated always as (
                 amount * case unit when 'mg' then 1 when 'mcg' then 0.001 else 1000 end
               ) stored,
  overage_pct  numeric(6, 2) not null default 0 check (overage_pct >= 0 and overage_pct <= 100),
  sort_order   integer not null default 0,
  notes        text,
  created_at   timestamptz not null default now()
);
create index formula_lines_version_idx on public.formula_lines (version_id);
select public.enable_audit('public.formula_lines');

create table public.formula_version_claims (
  version_id  uuid not null references public.formula_versions (id) on delete cascade,
  claim_id    uuid not null references public.health_claims (id),
  primary key (version_id, claim_id)
);

-- Lines and claims can change only while the version is a draft
create or replace function public.formula_draft_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_status public.formula_status;
  v_type   public.item_type;
begin
  select status into v_status from public.formula_versions
   where id = case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  -- the version itself is being deleted (cascade)
  if v_status is null and tg_op = 'DELETE' then
    return old;
  end if;
  if v_status <> 'draft' then
    raise exception 'This formula version is %; only drafts can be changed. Create a new version instead.', v_status;
  end if;
  if tg_op = 'UPDATE' and new.version_id <> old.version_id then
    raise exception 'A line cannot be moved to another version';
  end if;
  if tg_table_name = 'formula_lines' and tg_op <> 'DELETE' then
    select type into v_type from public.items where id = new.item_id;
    if v_type not in ('raw_material', 'excipient', 'semi_finished') then
      raise exception 'Only raw materials, excipients and semi-finished goods can be formula ingredients';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger formula_lines_guard before insert or update or delete on public.formula_lines
  for each row execute function public.formula_draft_guard();
create trigger formula_version_claims_guard before insert or update or delete on public.formula_version_claims
  for each row execute function public.formula_draft_guard();

-- Status changes and the approval checks
create or replace function public.formula_versions_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_lines   integer;
  v_blocked text;
begin
  if new.formula_id <> old.formula_id or new.version <> old.version then
    raise exception 'Formula and version number cannot be changed';
  end if;

  if old.status = 'archived' then
    raise exception 'Archived formula versions cannot be changed';
  end if;

  if old.status = 'approved' then
    if new.status = 'archived'
       and public.has_role('admin')
       and new.shelf_life_months is not distinct from old.shelf_life_months
       and new.notes is not distinct from old.notes
       and new.change_note is not distinct from old.change_note then
      return new;
    end if;
    raise exception 'Approved formula versions are locked. Create a new version instead.';
  end if;

  -- old.status = 'draft'
  if new.status = 'approved' then
    if not public.has_role('admin') then
      raise exception 'Only Admin can approve a formula version' using errcode = '42501';
    end if;
    select count(*) into v_lines from public.formula_lines where version_id = new.id;
    if v_lines = 0 then
      raise exception 'A formula version without ingredients cannot be approved';
    end if;
    if new.shelf_life_months is null then
      raise exception 'Set the shelf life before approving';
    end if;
    select string_agg(i.name, ', ' order by i.name) into v_blocked
      from public.formula_lines l join public.items i on i.id = l.item_id
     where l.version_id = new.id and i.novel_food_status = 'not_authorised';
    if v_blocked is not null then
      raise exception 'Not authorised Novel Food ingredients: %', v_blocked;
    end if;

    update public.formula_versions set status = 'archived'
     where formula_id = new.formula_id and status = 'approved' and id <> new.id;
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif new.status = 'archived' then
    if not public.has_role('admin', 'sales') then
      raise exception 'Not allowed to discard a draft' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create trigger formula_versions_guard before update on public.formula_versions
  for each row execute function public.formula_versions_guard();

create or replace function public.formula_versions_no_delete()
returns trigger language plpgsql set search_path = public
as $$
begin
  if old.status <> 'draft' and pg_trigger_depth() = 1 then
    raise exception 'Approved or archived formula versions cannot be deleted';
  end if;
  return old;
end
$$;

create trigger formula_versions_no_delete before delete on public.formula_versions
  for each row execute function public.formula_versions_no_delete();

-- ---------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------

-- New draft version copied from the latest version (lines and claims)
create or replace function public.new_formula_version(p_formula uuid, p_change_note text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_src  public.formula_versions;
  v_new  uuid;
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

  insert into public.formula_version_claims (version_id, claim_id)
  select v_new, claim_id from public.formula_version_claims where version_id = v_src.id;

  return v_new;
end
$$;

create or replace function public.approve_formula_version(p_version uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin');
  update public.formula_versions set status = 'approved' where id = p_version and status = 'draft';
  if not found then
    raise exception 'Only a draft version can be approved';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Views (RLS of the base tables applies)
-- ---------------------------------------------------------------------

-- Lines with the quantities used in production
create view public.formula_line_details
with (security_invoker = true) as
select l.id, l.version_id, l.item_id, l.amount, l.unit, l.amount_mg, l.overage_pct, l.sort_order, l.notes,
       i.sku, i.name, i.name_bg, i.type as item_type, i.novel_food_status, i.shelf_life_months,
       i.allergens, i.is_vegan, i.is_vegetarian,
       l.amount_mg * (1 + l.overage_pct / 100)                                  as input_mg_per_serving,
       case when f.serving_unit = 'pcs'
            then l.amount_mg * (1 + l.overage_pct / 100) / f.serving_size end    as input_mg_per_unit,
       case when f.servings_per_pack is not null
            then l.amount_mg * (1 + l.overage_pct / 100) * f.servings_per_pack / 1000 end
                                                                                 as kg_per_1000_packs
  from public.formula_lines l
  join public.formula_versions v on v.id = l.version_id
  join public.formulas f on f.id = v.formula_id
  join public.items i on i.id = l.item_id;

-- Amount per serving and % NRV of each nutrient (declared amounts, no overage)
create view public.formula_version_nutrients
with (security_invoker = true) as
select l.version_id, n.id as nutrient_id, n.code, n.name, n.name_bg, n.unit, n.nrv, n.sort_order,
       sum(l.amount_mg * inn.content_pct / 100) as amount_mg,
       sum(l.amount_mg * inn.content_pct / 100) / case n.unit when 'mg' then 1 else 0.001 end as amount,
       case when n.nrv is not null
            then round(100 * sum(l.amount_mg * inn.content_pct / 100)
                       / case n.unit when 'mg' then 1 else 0.001 end / n.nrv, 1) end as pct_nrv
  from public.formula_lines l
  join public.item_nutrients inn on inn.item_id = l.item_id
  join public.nutrients n on n.id = inn.nutrient_id
 group by l.version_id, n.id;

-- Checks shown on the formula page and used before approval
create view public.formula_version_checks
with (security_invoker = true) as
select v.id as version_id, v.formula_id, v.status, v.shelf_life_months,
       count(l.id)::int                                                            as line_count,
       count(l.id) filter (where i.novel_food_status = 'not_authorised')::int      as novel_not_authorised,
       count(l.id) filter (where i.novel_food_status in ('pending', 'unknown'))::int as novel_to_review,
       min(i.shelf_life_months)                                                    as min_item_shelf_life,
       coalesce(v.shelf_life_months > min(i.shelf_life_months), false)             as shelf_life_exceeds_items,
       (select coalesce(array_agg(distinct a order by a), '{}')
          from public.formula_lines l2 join public.items i2 on i2.id = l2.item_id
          cross join lateral unnest(i2.allergens) a
         where l2.version_id = v.id)                                               as allergens,
       case when count(l.id) = 0 then null
            when bool_or(i.is_vegan is false) then false
            when bool_or(i.is_vegan is null) then null else true end               as is_vegan,
       case when count(l.id) = 0 then null
            when bool_or(i.is_vegetarian is false) then false
            when bool_or(i.is_vegetarian is null) then null else true end          as is_vegetarian,
       coalesce(sum(l.amount_mg * (1 + l.overage_pct / 100)), 0)                    as fill_mg_per_serving,
       case when f.serving_unit = 'pcs'
            then coalesce(sum(l.amount_mg * (1 + l.overage_pct / 100)), 0) / f.serving_size end as fill_mg_per_unit,
       case when s.capacity_unit = 'mg' then s.capacity end                        as shell_capacity_mg
  from public.formula_versions v
  join public.formulas f on f.id = v.formula_id
  left join public.items s on s.id = f.shell_item_id
  left join public.formula_lines l on l.version_id = v.id
  left join public.items i on i.id = l.item_id
 group by v.id, f.id, s.id;

-- Claims chosen for a version and whether the formula meets their conditions
create view public.formula_version_claim_checks
with (security_invoker = true) as
select vc.version_id, c.id as claim_id, c.claim_en, c.claim_bg, c.register_ref, c.min_pct_nrv, c.min_amount_mg,
       c.conditions, n.name as nutrient, n.name_bg as nutrient_bg, vn.amount_mg, vn.pct_nrv,
       coalesce(case when c.min_amount_mg is not null then vn.amount_mg >= c.min_amount_mg
                     else vn.pct_nrv >= c.min_pct_nrv end, false) as is_met
  from public.formula_version_claims vc
  join public.health_claims c on c.id = vc.claim_id
  join public.nutrients n on n.id = c.nutrient_id
  left join public.formula_version_nutrients vn on vn.version_id = vc.version_id and vn.nutrient_id = c.nutrient_id;

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.nutrients              enable row level security;
alter table public.item_nutrients         enable row level security;
alter table public.health_claims          enable row level security;
alter table public.formulas               enable row level security;
alter table public.formula_versions       enable row level security;
alter table public.formula_lines          enable row level security;
alter table public.formula_version_claims enable row level security;

create policy nutrients_select on public.nutrients for select to authenticated
  using (public.is_staff());
create policy nutrients_write on public.nutrients for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy item_nutrients_select on public.item_nutrients for select to authenticated
  using (public.is_staff());
create policy item_nutrients_write on public.item_nutrients for all to authenticated
  using (public.has_role('admin', 'inventory')) with check (public.has_role('admin', 'inventory'));

create policy health_claims_select on public.health_claims for select to authenticated
  using (public.is_staff());
create policy health_claims_write on public.health_claims for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy formulas_select on public.formulas for select to authenticated
  using (public.is_staff());
create policy formulas_insert on public.formulas for insert to authenticated
  with check (public.has_role('admin', 'sales'));
create policy formulas_update on public.formulas for update to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));
create policy formulas_delete on public.formulas for delete to authenticated
  using (public.has_role('admin'));

-- Versions are created by the formula trigger and new_formula_version();
-- status changes are checked by formula_versions_guard.
create policy formula_versions_select on public.formula_versions for select to authenticated
  using (public.is_staff());
create policy formula_versions_update on public.formula_versions for update to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));

create policy formula_lines_select on public.formula_lines for select to authenticated
  using (public.is_staff());
create policy formula_lines_write on public.formula_lines for all to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));

create policy formula_version_claims_select on public.formula_version_claims for select to authenticated
  using (public.is_staff());
create policy formula_version_claims_write on public.formula_version_claims for all to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));

revoke execute on function
  public.new_formula_version(uuid, text),
  public.approve_formula_version(uuid),
  public.formulas_defaults(),
  public.formulas_first_version(),
  public.formula_draft_guard(),
  public.formula_versions_guard()
from public, anon;

grant execute on function
  public.new_formula_version(uuid, text),
  public.approve_formula_version(uuid)
to authenticated;
