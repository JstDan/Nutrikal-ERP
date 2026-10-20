-- =====================================================================
-- Nutrikal ERP + CRM — Developer role
-- A developer has no data rights of their own. They pick another user
-- from a list and the app then runs every query as that user, so that
-- user's role and row-level security apply unchanged. Each switch is
-- logged (who, as whom, when); the log is readable by Admin and the
-- developer.
-- The new enum value is compared as text below, because a value added
-- by ALTER TYPE cannot be used as an enum in the same transaction.
-- =====================================================================

alter type public.app_role add value if not exists 'developer';

create or replace function public.is_developer()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select p.role::text = 'developer' from public.profiles p
                    where p.id = auth.uid() and p.is_active), false)
$$;

create table public.impersonation_log (
  id            bigint generated always as identity primary key,
  developer_id  uuid not null references public.profiles (id),
  target_id     uuid not null references public.profiles (id),
  started_at    timestamptz not null default now()
);
create index impersonation_log_started_idx on public.impersonation_log (started_at desc);

alter table public.impersonation_log enable row level security;
create policy impersonation_log_select on public.impersonation_log for select to authenticated
  using (public.has_role('admin') or developer_id = auth.uid());
-- no insert/update/delete policy: written only by start_impersonation

-- Users a developer may act as: every active user except developers.
create or replace function public.impersonation_targets()
returns table (id uuid, full_name text, email text, role public.app_role, locale public.app_locale)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_developer() then
    raise exception 'Only a developer can act as another user' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.email::text, p.role, p.locale
      from public.profiles p
     where p.is_active and p.role::text <> 'developer'
     order by array_position(array['admin', 'sales', 'inventory', 'partner'], p.role::text), p.full_name;
end
$$;

-- Start acting as a user (checked and logged).
create or replace function public.start_impersonation(p_target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_developer() then
    raise exception 'Only a developer can act as another user' using errcode = '42501';
  end if;
  if not exists (select 1 from public.impersonation_targets() t where t.id = p_target) then
    raise exception 'User % cannot be selected', p_target using errcode = '42501';
  end if;
  insert into public.impersonation_log (developer_id, target_id) values (auth.uid(), p_target);
end
$$;

revoke execute on function public.is_developer(), public.impersonation_targets(), public.start_impersonation(uuid)
  from public, anon;
grant execute on function public.is_developer(), public.impersonation_targets(), public.start_impersonation(uuid)
  to authenticated;
