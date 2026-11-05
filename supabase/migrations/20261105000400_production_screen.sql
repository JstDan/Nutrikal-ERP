-- Production screen (owner, Nov 2026): Admin opens the app exactly as the production account sees it
-- and can do what that account does, from Admin's own sign-in. Like a developer acting as someone,
-- every query then runs as the production account; each opening is logged in impersonation_log.
create or replace function public.production_screen_targets()
returns table (id uuid, full_name text, email text, role public.app_role, locale public.app_locale)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles me where me.id = auth.uid() and me.role = 'admin' and me.is_active) then
    raise exception 'Only Admin opens the Production screen' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.email::text, p.role, p.locale
      from public.profiles p
     where p.is_active and p.role = 'production'
     order by p.full_name;
end
$$;

create or replace function public.start_production_screen(p_target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.production_screen_targets() t where t.id = p_target) then
    raise exception 'Not a production account' using errcode = '42501';
  end if;
  insert into public.impersonation_log (developer_id, target_id) values (auth.uid(), p_target);
end
$$;

revoke execute on function public.production_screen_targets(), public.start_production_screen(uuid) from public, anon;
grant execute on function public.production_screen_targets(), public.start_production_screen(uuid) to authenticated;
