-- =====================================================================
-- Catalogue of stock formulas (owner, Oct 2026)
--  - any recipe can become a catalogue product and be published, also one
--    of a client (owner); it needs an approved version
--  - prices by quantity tiers, EUR per pack, minimum order 500 packs
--  - catalog.nutrikal.com is open to everyone: it reads only through
--    catalog_public() and writes only through catalog_submit_enquiry()
--
--                          admin   sales   accountant  production/design
-- categories, products     write   read    read        —
-- tiers                    write   read    read        —
-- enquiries                write   write   read        —
-- The public side never sees cost, purchase prices, suppliers, overage,
-- client data or unpublished products.
-- =====================================================================

create or replace function public.catalog_min_qty()
returns integer language sql immutable as $$ select 500 $$;

insert into public.number_series (key, label, prefix, next_number, pad_length)
values ('catalog_product', 'Catalogue product', 'NK-S-', 1, 4),
       ('catalog_enquiry', 'Catalogue enquiry', 'CE-', 1, 5)
on conflict (key) do nothing;

create table public.catalog_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  name_bg     text,
  sort_order  integer not null default 0
);
select public.enable_audit('public.catalog_categories');

-- By kind of product, not by health benefit: a name like "for sleep" would be a health claim
insert into public.catalog_categories (name, name_bg, sort_order) values
  ('Vitamins and minerals', 'Витамини и минерали', 10),
  ('Collagen and proteins', 'Колаген и протеини', 20),
  ('Plant extracts', 'Растителни екстракти', 30),
  ('Probiotics and fibre', 'Пробиотици и фибри', 40),
  ('Amino acids', 'Аминокиселини', 50);

create table public.catalog_products (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  formula_id      uuid not null unique references public.formulas (id),
  category_id     uuid references public.catalog_categories (id),
  name            text not null,
  name_bg         text,
  description     text,
  description_bg  text,
  sort_order      integer not null default 0,
  is_published    boolean not null default false,
  published_at    timestamptz,
  created_by      uuid default auth.uid() references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index catalog_products_category_idx on public.catalog_products (category_id);

create table public.catalog_price_tiers (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.catalog_products (id) on delete cascade,
  min_qty     integer not null check (min_qty >= public.catalog_min_qty()),
  unit_price  numeric(12, 2) not null check (unit_price > 0),
  unique (product_id, min_qty)
);
select public.enable_audit('public.catalog_price_tiers');

-- What stands between a product and publication: the same answer for the button and for catalog_public()
create or replace function public.catalog_publish_problem(p_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when not f.is_active then 'inactive_recipe'
    when not exists (select 1 from formula_versions v where v.formula_id = f.id and v.status = 'approved') then 'not_approved'
    when not exists (select 1 from catalog_price_tiers t where t.product_id = p.id and t.min_qty = catalog_min_qty()) then 'no_minimum_tier'
  end
  from catalog_products p join formulas f on f.id = p.formula_id
  where p.id = p_id
$$;

create or replace function public.catalog_products_defaults()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.code := public.next_number('catalog_product');
  end if;
  if new.is_published and (tg_op = 'INSERT' or not old.is_published) then
    if public.catalog_publish_problem(new.id) is not null or tg_op = 'INSERT' then
      raise exception 'catalog_%', coalesce(public.catalog_publish_problem(new.id), 'no_minimum_tier');
    end if;
    new.published_at := now();
  end if;
  return new;
end
$$;
create trigger catalog_products_defaults before insert or update on public.catalog_products
  for each row execute function public.catalog_products_defaults();
create trigger catalog_products_updated_at before update on public.catalog_products
  for each row execute function public.set_updated_at();
select public.enable_audit('public.catalog_products');

-- A recipe becomes a product in one step. Admin only, like every write to the catalogue.
create or replace function public.catalog_from_formula(p_formula uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.require_role('admin');
  select id into v_id from catalog_products where formula_id = p_formula;
  if v_id is null then
    insert into catalog_products (formula_id, name, name_bg, description)
    select id, name, name_bg, description from formulas where id = p_formula
    returning id into v_id;
  end if;
  if v_id is null then raise exception 'Recipe not found'; end if;
  return v_id;
end
$$;

create table public.catalog_enquiries (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,
  company       text not null,
  contact_name  text not null,
  email         citext not null,
  phone         text,
  country_code  char(2),
  message       text,
  locale        public.app_locale not null default 'en',
  status        text not null default 'new' check (status in ('new', 'handled', 'spam')),
  client_id     uuid references public.clients (id),
  created_at    timestamptz not null default now()
);
create index catalog_enquiries_status_idx on public.catalog_enquiries (status, created_at desc);
create index catalog_enquiries_email_idx on public.catalog_enquiries (email, created_at desc);

create table public.catalog_enquiry_lines (
  id            uuid primary key default gen_random_uuid(),
  enquiry_id    uuid not null references public.catalog_enquiries (id) on delete cascade,
  product_id    uuid not null references public.catalog_products (id),
  product_code  text not null,
  product_name  text not null,
  quantity      integer not null check (quantity >= public.catalog_min_qty()),
  unit_price    numeric(12, 2) not null          -- the price the client saw
);
create index catalog_enquiry_lines_enquiry_idx on public.catalog_enquiry_lines (enquiry_id);

-- ---------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------
alter table public.catalog_categories enable row level security;
alter table public.catalog_products enable row level security;
alter table public.catalog_price_tiers enable row level security;
alter table public.catalog_enquiries enable row level security;
alter table public.catalog_enquiry_lines enable row level security;

create policy catalog_categories_read on public.catalog_categories for select to authenticated using (public.has_role('admin', 'sales'));
create policy catalog_categories_write on public.catalog_categories for all to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy catalog_products_read on public.catalog_products for select to authenticated using (public.has_role('admin', 'sales'));
create policy catalog_products_write on public.catalog_products for all to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy catalog_tiers_read on public.catalog_price_tiers for select to authenticated using (public.has_role('admin', 'sales'));
create policy catalog_tiers_write on public.catalog_price_tiers for all to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy catalog_enquiries_read on public.catalog_enquiries for select to authenticated using (public.has_role('admin', 'sales'));
create policy catalog_enquiries_update on public.catalog_enquiries for update to authenticated using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));
create policy catalog_enquiry_lines_read on public.catalog_enquiry_lines for select to authenticated using (public.has_role('admin', 'sales'));

-- The answer of an enquiry can change, what the client wrote cannot
revoke all on public.catalog_enquiries, public.catalog_enquiry_lines from anon, authenticated;
grant select on public.catalog_enquiries, public.catalog_enquiry_lines to authenticated;
grant update (status, client_id) on public.catalog_enquiries to authenticated;
revoke all on public.catalog_categories, public.catalog_products, public.catalog_price_tiers from anon;

-- ---------------------------------------------------------------------
-- The public side: what the open page may read. Listed field by field.
-- ---------------------------------------------------------------------
create or replace function public.catalog_public()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'name_bg', c.name_bg) order by c.sort_order, c.name)
        from catalog_categories c
       where exists (select 1 from catalog_products p
                      where p.category_id = c.id and p.is_published and catalog_publish_problem(p.id) is null)), '[]'),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', p.code, 'name', p.name, 'name_bg', p.name_bg,
               'description', p.description, 'description_bg', p.description_bg,
               'category_id', p.category_id, 'format', f.product_format,
               'serving_size', f.serving_size, 'serving_unit', f.serving_unit, 'servings_per_pack', f.servings_per_pack,
               'tiers', (select jsonb_agg(jsonb_build_object('min_qty', t.min_qty, 'unit_price', t.unit_price) order by t.min_qty)
                           from catalog_price_tiers t where t.product_id = p.id),
               'ingredients', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'name_bg', i.name_bg, 'amount', l.amount, 'unit', l.unit)
                                                         order by l.sort_order, l.amount_mg desc), '[]')
                                 from formula_lines l join items i on i.id = l.item_id where l.version_id = v.id),
               'claims', (select coalesce(jsonb_agg(jsonb_build_object('en', h.claim_en, 'bg', h.claim_bg)), '[]')
                            from formula_version_claims c join health_claims h on h.id = c.claim_id
                           where c.version_id = v.id and h.is_active)
             ) order by p.sort_order, p.name)
        from catalog_products p
        join formulas f on f.id = p.formula_id
        join formula_versions v on v.formula_id = f.id and v.status = 'approved'
       where p.is_published and catalog_publish_problem(p.id) is null), '[]'))
$$;

-- An enquiry from the open page. The prices come from the database, never from the browser.
create or replace function public.catalog_submit_enquiry(p jsonb)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_no text;
  v_email text := lower(trim(p ->> 'email'));
  v_company text := trim(p ->> 'company');
  v_name text := trim(p ->> 'contact_name');
  v_country text := upper(nullif(trim(p ->> 'country_code'), ''));
  v_lines jsonb := p -> 'lines';
  v_series public.number_series;
  l jsonb;
  v_qty integer;
  v_product record;
  v_price numeric;
begin
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or coalesce(length(v_company), 0) not between 1 and 200
     or coalesce(length(v_name), 0) not between 1 and 200
     or length(coalesce(p ->> 'phone', '')) > 50
     or length(coalesce(p ->> 'message', '')) > 2000
     or (v_country is not null and v_country !~ '^[A-Z]{2}$')
     or jsonb_typeof(v_lines) is distinct from 'array'
     or jsonb_array_length(v_lines) not between 1 and 50 then
    raise exception 'catalog_invalid';
  end if;

  -- Enough for a real client, little for a script
  if (select count(*) from catalog_enquiries where email = v_email::citext and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from catalog_enquiries where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'catalog_busy';
  end if;

  update number_series set next_number = next_number + 1 where key = 'catalog_enquiry' returning * into v_series;
  v_no := v_series.prefix || lpad((v_series.next_number - 1)::text, v_series.pad_length, '0');

  insert into catalog_enquiries (number, company, contact_name, email, phone, country_code, message, locale)
  values (v_no, v_company, v_name, v_email::citext, nullif(trim(p ->> 'phone'), ''), v_country, nullif(trim(p ->> 'message'), ''),
          case when p ->> 'locale' = 'bg' then 'bg'::app_locale else 'en'::app_locale end)
  returning id into v_id;

  for l in select * from jsonb_array_elements(v_lines) loop
    v_qty := case when l ->> 'quantity' ~ '^\d{1,9}$' then (l ->> 'quantity')::integer end;
    select id, code, name into v_product from catalog_products
     where code = l ->> 'code' and is_published and catalog_publish_problem(id) is null;
    if v_product.id is null or v_qty is null or v_qty < catalog_min_qty() then
      raise exception 'catalog_invalid';
    end if;
    select unit_price into v_price from catalog_price_tiers
     where product_id = v_product.id and min_qty <= v_qty order by min_qty desc limit 1;
    insert into catalog_enquiry_lines (enquiry_id, product_id, product_code, product_name, quantity, unit_price)
    values (v_id, v_product.id, v_product.code, v_product.name, v_qty, v_price);
  end loop;

  perform public.notify_role(r, 'catalog_enquiry', jsonb_build_object('no', v_no, 'company', v_company), '/catalog/enquiries')
    from unnest(array['admin', 'sales', 'bookkeeper']::public.app_role[]) r;
  return v_no;
end
$$;

-- The enquiry joins the CRM: the known client by e-mail, else a new lead
create or replace function public.catalog_enquiry_to_client(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  e public.catalog_enquiries;
  v_client uuid;
  v_first text;
  v_last text;
  v_lines text;
begin
  perform public.require_role('admin', 'sales');
  select * into e from catalog_enquiries where id = p_id for update;
  if e.id is null then raise exception 'Enquiry not found'; end if;
  if e.client_id is not null then return e.client_id; end if;

  select id into v_client from clients where billing_email = e.email limit 1;
  if v_client is null then
    select client_id into v_client from contacts where email = e.email limit 1;
  end if;
  if v_client is null then
    insert into clients (legal_name, status, country_code, billing_email, phone, preferred_locale, source, owner_id)
    values (e.company, 'lead', coalesce(e.country_code, 'BG'), e.email, e.phone, e.locale, 'catalogue', auth.uid())
    returning id into v_client;
    v_first := split_part(e.contact_name, ' ', 1);
    v_last := nullif(trim(substr(e.contact_name, length(v_first) + 1)), '');
    insert into contacts (client_id, first_name, last_name, email, phone, locale, is_primary)
    values (v_client, v_first, v_last, e.email, e.phone, e.locale, true);
  end if;

  select string_agg(product_code || ' ' || product_name || ': ' || quantity, E'\n' order by product_code)
    into v_lines from catalog_enquiry_lines where enquiry_id = e.id;
  insert into activities (client_id, type, subject, body)
  values (v_client, 'note', e.number, concat_ws(E'\n\n', v_lines, e.message));

  update catalog_enquiries set client_id = v_client, status = 'handled' where id = e.id;
  return v_client;
end
$$;

revoke execute on function public.catalog_public() from public;
revoke execute on function public.catalog_submit_enquiry(jsonb) from public;
revoke execute on function public.catalog_from_formula(uuid) from public, anon;
revoke execute on function public.catalog_enquiry_to_client(uuid) from public, anon;
revoke execute on function public.catalog_publish_problem(uuid) from public, anon;
grant execute on function public.catalog_public() to anon, authenticated;
grant execute on function public.catalog_submit_enquiry(jsonb) to anon;
grant execute on function public.catalog_from_formula(uuid) to authenticated;
grant execute on function public.catalog_enquiry_to_client(uuid) to authenticated;
grant execute on function public.catalog_publish_problem(uuid) to authenticated;

-- A new kind of notification
do $$
declare
  v text;
begin
  select pg_get_constraintdef(oid) into v from pg_constraint where conname = 'notifications_kind_check';
  execute 'alter table public.notifications drop constraint notifications_kind_check';
  execute 'alter table public.notifications add constraint notifications_kind_check '
    || replace(v, $q$'chat_mention'::text$q$, $q$'chat_mention'::text, 'catalog_enquiry'::text$q$);
end
$$;
