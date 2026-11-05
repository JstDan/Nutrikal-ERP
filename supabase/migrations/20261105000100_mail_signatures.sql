-- =====================================================================
-- Nutrikal ERP + CRM — e-mail signatures (owner, Nov 2026)
-- A document e-mailed from the app carries the signature of the person
-- who sends it. Gmail does not give its named signatures to apps, so each
-- person keeps a copy here: everyone fills in their own, Admin can fill in
-- anyone's. The HTML is cleaned in the app before it is saved.
-- Production and clients: no access (they send no documents). The
-- accountant reads only their own and writes nothing (read-only session).
-- =====================================================================

create table public.mail_signatures (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  html       text not null check (length(html) between 1 and 20000),
  updated_by uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.mail_signatures is
  'E-mail signature of a person (HTML), put under the documents they send. Written only through mail_signature_set().';

alter table public.mail_signatures enable row level security;
-- Own signature, or any for Admin. No write policies: only mail_signature_set()
create policy mail_signatures_select on public.mail_signatures for select to authenticated
  using (user_id = auth.uid() or public.has_role('admin'));
revoke insert, update, delete, truncate on public.mail_signatures from anon, authenticated;

/** Saves (or, when empty, removes) the signature of p_user: one's own, or anyone's for Admin. */
create or replace function public.mail_signature_set(p_user uuid, p_html text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_html text := btrim(coalesce(p_html, ''));
begin
  if auth.uid() is null or coalesce(public.current_app_role()::text, 'client') in ('client', 'production') then
    raise exception 'Not allowed';
  end if;
  if p_user is distinct from auth.uid() and not public.has_role('admin') then
    raise exception 'Not allowed';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and role::text not in ('client', 'production')) then
    raise exception 'Not allowed';
  end if;
  if length(v_html) > 20000 then
    raise exception 'The signature is too long';
  end if;

  if v_html = '' then
    delete from public.mail_signatures where user_id = p_user;
  else
    insert into public.mail_signatures (user_id, html, updated_by, updated_at)
    values (p_user, v_html, auth.uid(), now())
    on conflict (user_id) do update set html = excluded.html, updated_by = excluded.updated_by, updated_at = now();
  end if;
end
$$;

revoke execute on function public.mail_signature_set(uuid, text) from public, anon;
grant execute on function public.mail_signature_set(uuid, text) to authenticated;
