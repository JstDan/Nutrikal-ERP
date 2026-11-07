-- =====================================================================
-- Production contract per order (owner, Nov 2026; the owner's template
-- "Product Development and Supply Agreement", enlarged). Optional, never
-- blocks an order.
--
-- contract_templates  the text in English and Bulgarian, edited by Admin
--                     under Settings > Contract. Placeholders in {{…}} are
--                     filled from the order when a contract is made:
--                     contract_no, date, order_code, client_name,
--                     client_country, client_address, client_company_id,
--                     client_vat, seller_name, seller_address, seller_id,
--                     currency, deposit_pct, balance_pct.
--                     "# " starts a clause, "- " a bullet.
-- order_contracts     one open contract per order, with Schedule A (the
--                     lines and payments of the order). Clients often ask
--                     for changes (owner, Nov 2026): on the private link the
--                     client accepts the contract or writes comments; the
--                     team answers there and corrects the text or Schedule A
--                     at any time before it is signed. A correction after
--                     sending keeps the earlier version (contract_versions)
--                     and, if it had been accepted, asks for a new acceptance.
--                     Acceptance keeps name, position, e-mail, time, IP and
--                     browser (a simple electronic signature); Admin can mark
--                     a contract signed by hand. A signed one does not change.
--
--                           admin  sales/bookkeeper  accountant  designer, production, client
-- templates: read           yes    yes               read        —
-- templates: edit           yes    —                 —           —
-- contracts: read           yes    yes               read        —
-- make, correct, comment,
--   cancel                  yes    yes               —           —
-- mark signed by hand       yes    —                 —           —
-- the link (anon)           read it, comment, accept; nothing else
-- =====================================================================

create table public.contract_templates (
  locale      text primary key check (locale in ('bg', 'en')),
  body        text not null check (btrim(body) <> ''),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);
select public.enable_audit('public.contract_templates');

create table public.order_contracts (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.sales_orders (id) on delete cascade,
  number          text not null unique,
  locale          text not null check (locale in ('bg', 'en')),
  body            text not null,
  schedule        jsonb not null,             -- {currency, rows: [{description, quantity, unit_price, amount}], subtotal, vat_pct, vat, total, deposit_pct, deposit, balance}
  status          text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'signed', 'cancelled')),
  token           uuid not null unique default gen_random_uuid(),
  version         integer not null default 1,     -- each correction after sending makes a new version
  sent_at         timestamptz,
  accepted_at     timestamptz,
  accepted_name   text,
  accepted_title  text,
  accepted_email  text,
  accepted_ip     text,
  accepted_agent  text,
  signed_at       timestamptz,
  signed_by       uuid references public.profiles (id) on delete set null,
  cancelled_at    timestamptz,
  created_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index order_contracts_open on public.order_contracts (order_id) where status <> 'cancelled';
create trigger order_contracts_updated_at before update on public.order_contracts
  for each row execute function public.set_updated_at();
select public.enable_audit('public.order_contracts');

-- Earlier versions: the text, Schedule A and any acceptance as they were before a correction
create table public.contract_versions (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.order_contracts (id) on delete cascade,
  version     integer not null,
  body        text not null,
  schedule    jsonb not null,
  accepted    jsonb,                          -- {at, name, title, email, ip} when that version had been accepted
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (contract_id, version)
);

-- Comments and requested changes: from the client on the link, or from the team (shown to the client there)
create table public.contract_comments (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references public.order_contracts (id) on delete cascade,
  from_client  boolean not null,
  author_id    uuid references public.profiles (id) on delete set null,
  author_name  text not null,
  author_email text,
  version      integer not null,
  body         text not null check (btrim(body) <> '' and length(body) <= 5000),
  created_at   timestamptz not null default now()
);
create index contract_comments_idx on public.contract_comments (contract_id, created_at);

create table public.contract_counters (
  year     integer primary key,
  last_no  integer not null default 0
);

alter table public.contract_templates enable row level security;
alter table public.order_contracts enable row level security;
alter table public.contract_counters enable row level security;
alter table public.contract_versions enable row level security;
alter table public.contract_comments enable row level security;
create policy contract_templates_select on public.contract_templates for select to authenticated using (public.has_role('admin', 'sales'));
create policy contract_templates_update on public.contract_templates for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy order_contracts_select on public.order_contracts for select to authenticated using (public.has_role('admin', 'sales'));
create policy contract_versions_select on public.contract_versions for select to authenticated using (public.has_role('admin', 'sales'));
create policy contract_comments_select on public.contract_comments for select to authenticated using (public.has_role('admin', 'sales'));
revoke all on public.contract_templates, public.order_contracts, public.contract_counters, public.contract_versions, public.contract_comments
  from anon, authenticated;
grant select on public.contract_templates, public.order_contracts, public.contract_versions, public.contract_comments to authenticated;
grant update (body, updated_by, updated_at) on public.contract_templates to authenticated;

create or replace function public.contract_templates_stamp()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end
$$;
create trigger contract_templates_stamp before update on public.contract_templates
  for each row execute function public.contract_templates_stamp();

-- Notifications: the client accepted the contract, or wrote a comment on it
do $$
declare
  v text;
begin
  select pg_get_constraintdef(oid) into v from pg_constraint where conname = 'notifications_kind_check';
  execute 'alter table public.notifications drop constraint notifications_kind_check';
  execute 'alter table public.notifications add constraint notifications_kind_check '
    || replace(v, $q$'client_message'::text$q$, $q$'client_message'::text, 'contract_accepted'::text, 'contract_comment'::text$q$);
end
$$;

-- E-mailing a contract is logged like the other documents
alter table public.document_sends drop constraint document_sends_kind_check;
alter table public.document_sends add constraint document_sends_kind_check
  check (kind in ('calc_offer', 'proforma', 'invoice', 'delivery_note', 'contract'));

create or replace function public.begin_document_send(p_kind text, p_ref uuid, p_to text, p_cc text, p_subject text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_ok boolean;
  v_id uuid;
begin
  perform public.require_role('admin', 'sales');
  if coalesce(p_to, '') !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
     or (nullif(btrim(coalesce(p_cc, '')), '') is not null and p_cc !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$') then
    raise exception 'Enter a valid e-mail address';
  end if;
  if nullif(btrim(coalesce(p_subject, '')), '') is null then
    raise exception 'Enter the subject';
  end if;
  v_ok := case p_kind
    when 'calc_offer' then exists (select 1 from public.calc_offers where id = p_ref)
    when 'proforma' then exists (select 1 from public.sales_orders where id = p_ref)
      or exists (select 1 from public.invoices where id = p_ref and proforma_no is not null)
    when 'invoice' then exists (select 1 from public.invoices where id = p_ref and status = 'issued')
    when 'delivery_note' then exists (select 1 from public.dispatches where id = p_ref)
    when 'contract' then exists (select 1 from public.order_contracts where id = p_ref and status <> 'cancelled')
    else false end;
  if not v_ok then
    raise exception 'This document cannot be sent';
  end if;
  -- A contract that goes out is no longer a draft
  if p_kind = 'contract' then
    update public.order_contracts set status = 'sent', sent_at = coalesce(sent_at, now()) where id = p_ref and status = 'draft';
  end if;
  insert into public.document_sends (kind, ref_id, recipient, cc, subject)
  values (p_kind, p_ref, btrim(p_to), nullif(btrim(coalesce(p_cc, '')), ''), btrim(p_subject))
  returning id into v_id;
  return v_id;
end
$$;

-- ---------------------------------------------------------------------
-- Making a contract
-- ---------------------------------------------------------------------
/** Schedule A of an order: its lines, VAT and the two payments, as they are now. */
create or replace function public.contract_schedule(p_order uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  so     public.sales_orders;
  v_rows jsonb;
  v_sub  numeric;
  v_vat  numeric;
  v_dep  numeric;
begin
  select * into so from public.sales_orders where id = p_order;
  -- A line from an offer is named after its product (the line itself may have no description)
  select coalesce(jsonb_agg(jsonb_build_object('description', coalesce(nullif(l.description, ''), co.product_name, f.name, ''), 'quantity', l.quantity,
                                               'unit_price', l.unit_price, 'amount', round(l.quantity * l.unit_price, 2)) order by l.sort_order), '[]'),
         coalesce(sum(round(l.quantity * l.unit_price, 2)), 0)
    into v_rows, v_sub
    from public.sales_order_lines l
    left join public.calc_offers co on co.id = l.calc_offer_id
    left join public.formula_versions v on v.id = l.formula_version_id
    left join public.formulas f on f.id = v.formula_id
   where l.order_id = p_order;
  v_vat := round(v_sub * coalesce(public.order_vat_rate(p_order), 0) / 100, 2);
  v_dep := round((v_sub + v_vat) * coalesce(so.deposit_pct, 0) / 100, 2);
  return jsonb_build_object('currency', so.currency, 'rows', v_rows, 'subtotal', v_sub, 'vat_pct', coalesce(public.order_vat_rate(p_order), 0),
    'vat', v_vat, 'total', v_sub + v_vat, 'deposit_pct', coalesce(so.deposit_pct, 0), 'deposit', v_dep, 'balance', v_sub + v_vat - v_dep);
end
$$;

/** A contract for an order from the template in the language asked (else the client's), filled from the order; p_country: the client's country named in that language. */
create or replace function public.create_order_contract(p_order uuid, p_locale text default null, p_country text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  so      public.sales_orders;
  c       public.clients;
  s       record;
  v_loc   text;
  v_body  text;
  v_no    text;
  v_year  integer := extract(year from now())::integer;
  v_n     integer;
  v_id    uuid;
  v_bg    jsonb;
begin
  perform public.require_role('admin', 'sales');
  select * into so from public.sales_orders where id = p_order;
  if not found then
    raise exception 'Order not found';
  end if;
  if so.status = 'cancelled' then
    raise exception 'The order is cancelled';
  end if;
  if exists (select 1 from public.order_contracts where order_id = p_order and status <> 'cancelled') then
    raise exception 'The order already has a contract; cancel it to make a new one';
  end if;
  select * into c from public.clients where id = so.client_id;
  v_loc := coalesce(p_locale, case when c.preferred_locale = 'bg' then 'bg' else 'en' end);
  select body into v_body from public.contract_templates where locale = v_loc;
  if v_body is null then
    raise exception 'There is no contract template in this language';
  end if;
  select company_name, company_id, company_vat, company_address into s from public.calc_settings limit 1;
  v_bg := public.company_bg();

  insert into public.contract_counters (year, last_no) values (v_year, 1)
  on conflict (year) do update set last_no = public.contract_counters.last_no + 1
  returning last_no into v_n;
  v_no := format('C-%s-%s', v_year, lpad(v_n::text, 4, '0'));

  v_body := replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(v_body,
    '{{contract_no}}', v_no),
    '{{date}}', to_char((now() at time zone 'Europe/Sofia')::date, 'DD/MM/YYYY')),
    '{{order_code}}', so.code),
    '{{client_name}}', c.legal_name),
    '{{client_country}}', coalesce(nullif(btrim(p_country), ''), c.country_code)),
    '{{client_address}}', concat_ws(', ', nullif(coalesce(nullif(c.registration_address, ''), c.address_line1), ''), nullif(concat_ws(' ', c.postal_code, c.city), ''))),
    '{{client_company_id}}', coalesce(nullif(c.company_id, ''), '—')),
    '{{client_vat}}', coalesce(nullif(c.vat_number, ''), '—')),
    '{{seller_name}}', case when v_loc = 'bg' then coalesce(nullif(v_bg ->> 'name', ''), s.company_name) else s.company_name end),
    '{{seller_address}}', case when v_loc = 'bg' then coalesce(nullif(v_bg ->> 'address', ''), s.company_address) else s.company_address end),
    '{{seller_id}}', coalesce(s.company_id, '')),
    '{{currency}}', so.currency),
    '{{deposit_pct}}', trim(to_char(coalesce(so.deposit_pct, 0), 'FM990.##'))),
    '{{balance_pct}}', trim(to_char(100 - coalesce(so.deposit_pct, 0), 'FM990.##')));

  insert into public.order_contracts (order_id, number, locale, body, schedule)
  values (p_order, v_no, v_loc, v_body, public.contract_schedule(p_order))
  returning id into v_id;
  return v_id;
end
$$;

-- ---------------------------------------------------------------------
-- Corrections and comments
-- ---------------------------------------------------------------------
/** Internal: a sent or accepted contract keeps its current version before a correction; an accepted one must be accepted again. */
create or replace function public.contract_new_version(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  k public.order_contracts;
begin
  select * into k from public.order_contracts where id = p_id for update;
  if not found or k.status = 'cancelled' then
    raise exception 'Contract not found';
  end if;
  if k.status = 'signed' then
    raise exception 'A signed contract does not change; cancel it and make a new one';
  end if;
  if k.status = 'draft' then
    return;
  end if;
  insert into public.contract_versions (contract_id, version, body, schedule, accepted)
  values (k.id, k.version, k.body, k.schedule,
          case when k.accepted_at is not null then jsonb_build_object('at', k.accepted_at, 'name', k.accepted_name, 'title', k.accepted_title,
                                                                     'email', k.accepted_email, 'ip', k.accepted_ip) end);
  update public.order_contracts
     set version = version + 1, status = 'sent', accepted_at = null, accepted_name = null, accepted_title = null,
         accepted_email = null, accepted_ip = null, accepted_agent = null
   where id = k.id;
end
$$;

/** The text is corrected (any time before it is signed). */
create or replace function public.save_order_contract(p_id uuid, p_body text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  if nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception 'The contract has no text';
  end if;
  if (select body from public.order_contracts where id = p_id) = p_body then
    return;
  end if;
  perform public.contract_new_version(p_id);
  update public.order_contracts set body = p_body where id = p_id;
end
$$;

/** Schedule A again from the order as it is now (after the order was corrected). */
create or replace function public.refresh_contract_schedule(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  perform public.contract_new_version(p_id);
  update public.order_contracts set schedule = public.contract_schedule(order_id) where id = p_id;
end
$$;

/** The team writes on the contract; the client sees it on the link. */
create or replace function public.add_contract_comment(p_id uuid, p_body text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  k public.order_contracts;
begin
  perform public.require_role('admin', 'sales');
  select * into k from public.order_contracts where id = p_id and status <> 'cancelled';
  if not found then
    raise exception 'Contract not found';
  end if;
  insert into public.contract_comments (contract_id, from_client, author_id, author_name, version, body)
  values (k.id, false, auth.uid(), (select full_name from public.profiles where id = auth.uid()), k.version, btrim(p_body));
end
$$;

/** The private link was given to the client by hand: the draft counts as sent. */
create or replace function public.mark_order_contract_sent(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_token uuid;
begin
  perform public.require_role('admin', 'sales');
  update public.order_contracts set status = case when status = 'draft' then 'sent' else status end, sent_at = coalesce(sent_at, now())
   where id = p_id and status <> 'cancelled' returning token into v_token;
  if v_token is null then
    raise exception 'Contract not found';
  end if;
  return v_token;
end
$$;

create or replace function public.cancel_order_contract(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  update public.order_contracts set status = 'cancelled', cancelled_at = now() where id = p_id and status <> 'cancelled';
  if not found then
    raise exception 'Contract not found';
  end if;
end
$$;

/** Admin: signed on paper (or otherwise outside the link). */
create or replace function public.mark_order_contract_signed(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin');
  update public.order_contracts set status = 'signed', signed_at = now(), signed_by = auth.uid(), sent_at = coalesce(sent_at, now())
   where id = p_id and status in ('draft', 'sent', 'accepted');
  if not found then
    raise exception 'Only an open contract is marked as signed';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- The private link (anon): read, comment, accept
-- ---------------------------------------------------------------------
/** What the client sees through the link: the contract and its comments, never the order or anything else. */
create or replace function public.contract_public(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('number', k.number, 'locale', k.locale, 'body', k.body, 'schedule', k.schedule, 'status', k.status,
                            'version', k.version, 'updated_at', k.updated_at, 'created_at', k.created_at,
                            'accepted_at', k.accepted_at, 'accepted_name', k.accepted_name, 'accepted_title', k.accepted_title,
                            'accepted_email', k.accepted_email, 'accepted_ip', k.accepted_ip, 'signed_at', k.signed_at,
                            'client', (select c.legal_name from public.clients c join public.sales_orders so on so.client_id = c.id where so.id = k.order_id),
                            'seller', (select jsonb_build_object('name', case when k.locale = 'bg' then coalesce(nullif(cs.company_name_bg, ''), cs.company_name) else cs.company_name end,
                                                        'address', case when k.locale = 'bg' then coalesce(nullif(cs.company_address_bg, ''), cs.company_address) else cs.company_address end,
                                                        'email', cs.company_email, 'phone', cs.company_phone, 'company_id', cs.company_id)
                                         from public.calc_settings cs limit 1),
                            'comments', coalesce((select jsonb_agg(jsonb_build_object('from_client', m.from_client, 'name', m.author_name,
                                                                                     'body', m.body, 'at', m.created_at, 'version', m.version) order by m.created_at)
                                                    from public.contract_comments m where m.contract_id = k.id), '[]'))
    from public.order_contracts k
   where k.token = p_token and k.status <> 'cancelled'
$$;

/** Internal: tells the team about something the client did on the link. */
create or replace function public.contract_notify(k public.order_contracts, p_kind text, p_name text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.app_role;
begin
  foreach r in array array['admin', 'sales', 'bookkeeper']::public.app_role[] loop
    perform public.notify_role(r, p_kind,
      jsonb_build_object('no', k.number, 'code', (select code from public.sales_orders where id = k.order_id),
                         'client', (select c.legal_name from public.clients c join public.sales_orders so on so.client_id = c.id where so.id = k.order_id),
                         'name', p_name),
      '/orders/' || k.order_id::text);
  end loop;
end
$$;

/** The client asks for changes or asks a question on the link; the team is told. */
create or replace function public.contract_comment_public(p_token uuid, p_name text, p_email text, p_body text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  k public.order_contracts;
begin
  select * into k from public.order_contracts where token = p_token;
  if not found or k.status in ('cancelled', 'signed') then
    raise exception 'This contract is not available';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null or nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception 'Enter your name and the comment';
  end if;
  insert into public.contract_comments (contract_id, from_client, author_name, author_email, version, body)
  values (k.id, true, left(btrim(p_name), 200), left(nullif(btrim(coalesce(p_email, '')), ''), 200), k.version, left(btrim(p_body), 5000));
  perform public.contract_notify(k, 'contract_comment', btrim(p_name));
  return public.contract_public(p_token);
end
$$;

/** The client accepts on the link: name, title, e-mail, time, IP and browser are kept; the team is told. */
create or replace function public.contract_accept(p_token uuid, p_name text, p_title text, p_email text, p_ip text, p_agent text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  k public.order_contracts;
begin
  select * into k from public.order_contracts where token = p_token for update;
  if not found or k.status = 'cancelled' then
    raise exception 'This contract is not available';
  end if;
  if k.status in ('accepted', 'signed') then
    raise exception 'This contract is already accepted';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null or coalesce(p_email, '') !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter your name and e-mail';
  end if;
  update public.order_contracts
     set status = 'accepted', accepted_at = now(), accepted_name = left(btrim(p_name), 200), accepted_title = left(nullif(btrim(coalesce(p_title, '')), ''), 200),
         accepted_email = left(btrim(p_email), 200), accepted_ip = left(p_ip, 100), accepted_agent = left(p_agent, 400), sent_at = coalesce(sent_at, now())
   where id = k.id;
  perform public.contract_notify(k, 'contract_accepted', btrim(p_name));
  return public.contract_public(p_token);
end
$$;

revoke execute on function public.contract_schedule(uuid), public.contract_new_version(uuid), public.contract_notify(public.order_contracts, text, text),
  public.contract_templates_stamp() from public, anon, authenticated;
revoke execute on function public.create_order_contract(uuid, text, text), public.save_order_contract(uuid, text), public.refresh_contract_schedule(uuid),
  public.add_contract_comment(uuid, text), public.mark_order_contract_sent(uuid), public.cancel_order_contract(uuid),
  public.mark_order_contract_signed(uuid) from public, anon;
grant execute on function public.create_order_contract(uuid, text, text), public.save_order_contract(uuid, text), public.refresh_contract_schedule(uuid),
  public.add_contract_comment(uuid, text), public.mark_order_contract_sent(uuid), public.cancel_order_contract(uuid),
  public.mark_order_contract_signed(uuid) to authenticated;
revoke execute on function public.contract_public(uuid), public.contract_accept(uuid, text, text, text, text, text),
  public.contract_comment_public(uuid, text, text, text) from public;
grant execute on function public.contract_public(uuid), public.contract_accept(uuid, text, text, text, text, text),
  public.contract_comment_public(uuid, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- The owner's template, enlarged (Admin edits it under Settings > Contract)
-- ---------------------------------------------------------------------
insert into public.contract_templates (locale, body) values ('en', $tpl$PRODUCT DEVELOPMENT AND SUPPLY AGREEMENT
No {{contract_no}} of {{date}}, for order {{order_code}}

This Agreement is made by and between:
{{seller_name}}, UIC {{seller_id}}, a company incorporated and existing under the laws of Bulgaria, with its principal office at {{seller_address}} ("Manufacturer"), and
{{client_name}}, company ID {{client_company_id}}, VAT No {{client_vat}}, a company incorporated and existing under the laws of {{client_country}}, with its principal office at {{client_address}} ("Client"),
together the "Parties".

# 1. Project Scope and Product Specifications
1.1. The Manufacturer agrees to develop, manufacture and supply the dietary supplement products described in Schedule A (the products, formats, quantities and prices of order {{order_code}}).
1.2. The specification of each product consists of:
- the final formula and ingredient list;
- the product label and packaging artwork;
- the capsule/tablet count and packaging format.
1.3. The specification is final once the Client approves it in writing (an e-mail is sufficient). Changes after approval require written agreement and may change the price and the production timeline.

# 2. Pricing and Terms
2.1. Prices for each product are listed per unit in Schedule A, in {{currency}}, excluding VAT.
2.2. Prices are EXW (Ex Works) Incoterms 2020, from the Manufacturer's facility in Varna, Bulgaria.
2.3. Unless Schedule A states otherwise, prices include manufacturing, the container with lid, and label printing and application; label design, batch testing with a Certificate of Analysis, shipping and VAT are not included.

# 3. Payment Terms
3.1. {{deposit_pct}}% of the total order value is payable upfront to confirm the order and commence production.
3.2. The remaining {{balance_pct}}% is payable prior to shipment.
3.3. Orders will not be released for shipping until full payment is received.
3.4. The Client may request samples of the finished product or photographic evidence for approval prior to shipping. The Manufacturer will accommodate such requests within reasonable limits and timelines.

# 4. Quantities
4.1. Because of production yields, the quantity produced may differ from the quantity ordered by up to five percent (±5%). The final invoice reflects the quantity actually produced and delivered.

# 5. Shipping, Collection and Storage
5.1. The Client is responsible for arranging pickup, shipping and customs clearance.
5.2. Upon written request, the Manufacturer may assist with arranging shipping, recommending freight partners, supporting communication with logistics providers and offering insurance options at the Client's cost. The Manufacturer assumes no responsibility for any delays, losses or damages to goods once they leave the Manufacturer's facility.
5.3. The Client shall collect the goods within thirty (30) days of the notice that they are ready and paid. After that, the Manufacturer may charge storage at cost, and the goods are stored at the Client's risk.

# 6. Production Timeline
6.1. Standard production time is estimated at six to ten (6-10) weeks from the date of order confirmation, receipt of the initial deposit, and written confirmation from the printing house that all artwork is approved and ready for print.
6.2. Delays caused by raw material shortages, supply chain disruptions, force majeure or late payment may extend production timelines. The Manufacturer will keep the Client informed of any significant delays.

# 7. Raw Material Minimum Order Quantities (MOQs)
7.1. Some raw materials require MOQ purchases. If MOQs exceed the needs of the current order, the Client agrees to either:
- pay for the excess inventory upfront, or
- use it in a subsequent order within six (6) months.
7.2. Additional costs associated with special raw material sourcing will be communicated and require written approval.
7.3. The Manufacturer may require a deposit to secure raw materials or packaging components. This deposit will be deducted from the next order or credited accordingly. If excess raw materials or packaging components are paid for in a previous order, the Manufacturer shall credit these amounts in future orders where applicable. The requirement and terms will be clearly communicated and require written approval from both Parties.

# 8. Product Quality, Compliance and Complaints
8.1. The Manufacturer guarantees that the products will be produced according to the agreed specifications and applicable standards, and keeps batch records that trace every raw material to each batch (Regulation (EC) No 178/2002).
8.2. Documentation such as Certificates of Analysis (COAs), MSDS and technical datasheets will be provided upon request.
8.3. Regulatory compliance in the destination market, including the texts and claims on the label, is the responsibility of the Client, unless otherwise agreed in writing. Any regulatory review by the Manufacturer is advisory.
8.4. Visible defects and differences in quantity must be reported in writing, with photographs, within fourteen (14) days of pickup. If a complaint is confirmed, the Manufacturer will, at its choice, replace the affected goods or credit their price.

# 9. Intellectual Property
9.1. The Client's brand names, logos and artwork remain the property of the Client. The Manufacturer uses them only to perform this Agreement.
9.2. The Manufacturer's catalogue (stock) formulas and its know-how remain the property of the Manufacturer.

# 10. Liability
10.1. The Manufacturer's total liability under each order is limited to the value of that order. Neither Party is liable for indirect or consequential damages, including lost profit.

# 11. Force Majeure
11.1. Neither Party is liable for failure or delay caused by events beyond its reasonable control (force majeure). The affected Party will inform the other without delay.

# 12. Confidentiality
12.1. Both Parties agree to keep all shared information, including formulas, pricing and trade secrets, strictly confidential.
12.2. This obligation survives the termination of this Agreement for a period of five (5) years.

# 13. Personal Data
13.1. Each Party processes the personal data of the other Party's contact persons only to perform this Agreement, in accordance with Regulation (EU) 2016/679 (GDPR).

# 14. Term and Termination
14.1. This Agreement remains in force until terminated by either Party with thirty (30) days' written notice.
14.2. Termination does not affect obligations already in effect, including outstanding payments or undelivered orders.

# 15. Governing Law
15.1. This Agreement is governed by and construed in accordance with the laws of Bulgaria.
15.2. Any disputes are subject to the exclusive jurisdiction of the courts of Varna, Bulgaria.

# 16. Acceptance
16.1. The Client may accept this Agreement electronically through the link sent by the Manufacturer. The name, position and e-mail of the person accepting, the time and the IP address are recorded; this acceptance has the effect of a signature (simple electronic signature, Regulation (EU) No 910/2014). The Agreement may also be signed on paper.
16.2. This Agreement is made in English.$tpl$),
('bg', $tpl$ДОГОВОР ЗА РАЗРАБОТКА И ДОСТАВКА НА ПРОДУКТИ
№ {{contract_no}} от {{date}}, към поръчка {{order_code}}

Настоящият договор се сключва между:
{{seller_name}}, ЕИК {{seller_id}}, дружество, учредено и съществуващо съгласно законите на България, със седалище и адрес на управление {{seller_address}} („Производител“), и
{{client_name}}, ЕИК/рег. № {{client_company_id}}, ДДС № {{client_vat}}, дружество, учредено и съществуващо съгласно законите на {{client_country}}, със седалище и адрес на управление {{client_address}} („Клиент“),
наричани заедно „Страните“.

# 1. Предмет и спецификация на продуктите
1.1. Производителят се задължава да разработи, произведе и достави хранителните добавки, описани в Приложение А (продуктите, форматите, количествата и цените по поръчка {{order_code}}).
1.2. Спецификацията на всеки продукт включва:
- окончателната формула и списъка на съставките;
- етикета и дизайна на опаковката;
- броя капсули/таблетки и формата на опаковката.
1.3. Спецификацията е окончателна, след като Клиентът я одобри писмено (достатъчен е имейл). Промени след одобрението изискват писмено съгласие и могат да променят цената и срока за производство.

# 2. Цени и условия
2.1. Цените на продуктите са посочени за единица в Приложение А, в {{currency}}, без ДДС.
2.2. Цените са EXW (франко завода) Incoterms 2020, обекта на Производителя във Варна, България.
2.3. Освен ако в Приложение А не е посочено друго, цените включват производството, опаковката с капачка, печата и поставянето на етикета; дизайнът на етикета, изпитването на партидата със сертификат за анализ, транспортът и ДДС не са включени.

# 3. Плащане
3.1. {{deposit_pct}}% от общата стойност на поръчката се плащат авансово за потвърждаване на поръчката и започване на производството.
3.2. Остатъкът от {{balance_pct}}% се плаща преди експедицията.
3.3. Поръчката не се освобождава за експедиция преди пълното плащане.
3.4. Клиентът може да поиска мостри от готовия продукт или снимки за одобрение преди експедицията. Производителят ще ги осигури в разумни граници и срокове.

# 4. Количества
4.1. Поради производствения добив произведеното количество може да се различава от поръчаното с до пет процента (±5%). Окончателната фактура отразява действително произведеното и доставено количество.

# 5. Експедиция, получаване и съхранение
5.1. Клиентът отговаря за получаването, транспорта и митническото оформяне.
5.2. По писмено искане Производителят може да съдейства за организиране на транспорта, да препоръча спедитори, да подпомогне комуникацията с логистичните фирми и да предложи застраховка за сметка на Клиента. Производителят не носи отговорност за забавяния, загуби или повреди на стоката, след като тя напусне обекта му.
5.3. Клиентът получава стоката до тридесет (30) дни от уведомлението, че е готова и платена. След този срок Производителят може да начисли разходите за съхранение, а стоката се съхранява на риск на Клиента.

# 6. Срок за производство
6.1. Стандартният срок за производство е от шест до десет (6-10) седмици от потвърждаването на поръчката, получаването на аванса и писменото потвърждение от печатницата, че целият дизайн е одобрен и готов за печат.
6.2. Недостиг на суровини, прекъсвания във веригата на доставки, непреодолима сила или забавено плащане могат да удължат срока. Производителят ще уведомява Клиента за всяко съществено забавяне.

# 7. Минимални количества на суровините (MOQ)
7.1. Някои суровини се купуват в минимални количества. Ако минималното количество надхвърля нуждите на текущата поръчка, Клиентът се съгласява:
- да заплати излишъка предварително, или
- да го използва в следваща поръчка до шест (6) месеца.
7.2. Допълнителните разходи за специални суровини се съобщават предварително и изискват писмено одобрение.
7.3. Производителят може да поиска депозит за осигуряване на суровини или опаковки. Депозитът се приспада от следващата поръчка или се кредитира. Ако излишни суровини или опаковки са платени в предишна поръчка, Производителят ги приспада в следващите поръчки, когато е приложимо. Изискването и условията се съобщават ясно и изискват писмено одобрение от двете Страни.

# 8. Качество, съответствие и рекламации
8.1. Производителят гарантира, че продуктите се произвеждат според договорената спецификация и приложимите стандарти, и води документация, която проследява всяка суровина до всяка партида (Регламент (ЕО) № 178/2002).
8.2. Сертификати за анализ (COA), информационни листове за безопасност (MSDS) и технически спецификации се предоставят при поискване.
8.3. Съответствието с изискванията на пазара на крайна продажба, включително текстовете и претенциите на етикета, е отговорност на Клиента, освен ако е договорено друго писмено. Всяка регулаторна проверка от Производителя има препоръчителен характер.
8.4. Видими дефекти и разлики в количеството се заявяват писмено, със снимки, до четиринадесет (14) дни от получаването. При потвърдена рекламация Производителят по свой избор заменя засегнатата стока или кредитира цената ѝ.

# 9. Интелектуална собственост
9.1. Търговските марки, логата и дизайнът на Клиента остават негова собственост. Производителят ги използва само за изпълнението на този договор.
9.2. Каталожните (стандартни) формули на Производителя и неговото ноу-хау остават собственост на Производителя.

# 10. Отговорност
10.1. Общата отговорност на Производителя по всяка поръчка е ограничена до стойността на тази поръчка. Никоя от Страните не отговаря за косвени или последващи вреди, включително пропуснати ползи.

# 11. Непреодолима сила
11.1. Никоя от Страните не отговаря за неизпълнение или забава, причинени от събития извън нейния разумен контрол (непреодолима сила). Засегнатата Страна уведомява другата без забавяне.

# 12. Поверителност
12.1. Страните се задължават да пазят в тайна цялата споделена информация, включително формули, цени и търговски тайни.
12.2. Задължението остава в сила пет (5) години след прекратяването на договора.

# 13. Лични данни
13.1. Всяка Страна обработва личните данни на лицата за контакт на другата Страна само за изпълнението на този договор, съгласно Регламент (ЕС) 2016/679 (GDPR).

# 14. Срок и прекратяване
14.1. Договорът е в сила до прекратяването му от всяка от Страните с тридесетдневно (30) писмено предизвестие.
14.2. Прекратяването не засяга възникналите задължения, включително дължими плащания и недоставени поръчки.

# 15. Приложимо право
15.1. Договорът се урежда и тълкува съгласно законите на Република България.
15.2. Споровете се решават от компетентния съд във Варна, България.

# 16. Приемане
16.1. Клиентът може да приеме договора електронно чрез връзката, изпратена от Производителя. Записват се името, длъжността и имейлът на приелото лице, часът и IP адресът; приемането има силата на подпис (обикновен електронен подпис, Регламент (ЕС) № 910/2014). Договорът може да бъде подписан и на хартия.
16.2. Договорът е съставен на български език.$tpl$);

