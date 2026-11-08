-- VIES checks of clients' VAT numbers (owner, Nov 2026). The app asks the European Commission's VIES service
-- (no key) whether an EU VAT number is valid and, where the country gives them, its name and address. Every answer
-- is kept here as proof for a 0 % VAT invoice to another EU country: the number, the answer, the request number
-- VIES gives when Nutrikal's own VAT number is sent with the question, the time and who asked.
-- clients.vat_validated_at always shows the last valid check of the client's current number.
-- Admin, Sales and the bookkeeper check and read (the accountant reads); Production, designers and clients never.

create table public.vat_checks (
  id           uuid primary key default gen_random_uuid(),
  vat_number   text not null check (vat_number ~ '^[A-Z]{2}[0-9A-Z+*]{2,14}$'),  -- with the country prefix
  valid        boolean not null,
  name         text,
  address      text,
  request_id   text,          -- VIES's consultation number, the proof of the check
  checked_at   timestamptz not null default now(),
  checked_by   uuid references public.profiles (id) default auth.uid()
);
create index vat_checks_number_idx on public.vat_checks (vat_number, checked_at desc);

alter table public.vat_checks enable row level security;

create policy vat_checks_read on public.vat_checks for select
  using (public.has_role('admin', 'sales'));

-- Written only through record_vat_check, so a check always stamps who and when
create or replace function public.record_vat_check(p_vat text, p_valid boolean, p_name text, p_address text, p_request text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_vat text := upper(regexp_replace(coalesce(p_vat, ''), '[\s.-]', '', 'g'));
  v_id uuid;
begin
  if not public.has_role('admin', 'sales') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into vat_checks (vat_number, valid, name, address, request_id, checked_by)
  values (v_vat, p_valid, nullif(btrim(p_name), ''), nullif(btrim(p_address), ''), nullif(btrim(p_request), ''), auth.uid())
  returning id into v_id;
  -- Clients with this number (stored with or without the prefix) follow the answer
  update clients c set vat_validated_at = case when p_valid then now() end
   where upper(regexp_replace(coalesce(c.vat_number, ''), '[\s.-]', '', 'g')) in (v_vat, substr(v_vat, 3))
     and (c.vat_number ~* '^[A-Z]{2}' or c.country_code = case substr(v_vat, 1, 2) when 'EL' then 'GR' when 'XI' then 'GB' else substr(v_vat, 1, 2) end);
  return v_id;
end $$;

revoke all on function public.record_vat_check(text, boolean, text, text, text) from public, anon;
grant execute on function public.record_vat_check(text, boolean, text, text, text) to authenticated;

-- A changed VAT number is cleaned and takes the last valid check of the new number, else none
create or replace function public.clients_vat_validated() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.vat_number is not null then
    new.vat_number := nullif(upper(regexp_replace(new.vat_number, '[\s.-]', '', 'g')), '');
  end if;
  if tg_op = 'INSERT' or new.vat_number is distinct from old.vat_number then
    new.vat_validated_at := (
      select max(v.checked_at) from vat_checks v
       where v.valid and v.vat_number in (new.vat_number, upper(new.country_code) || new.vat_number,
                                          case when new.country_code = 'GR' then 'EL' || new.vat_number end));
  end if;
  return new;
end $$;

create trigger clients_vat_validated before insert or update of vat_number, country_code on public.clients
  for each row execute function public.clients_vat_validated();
