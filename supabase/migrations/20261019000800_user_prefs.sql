-- =====================================================================
-- Nutrikal ERP + CRM — Phase 1 — 0008 user preferences
-- Any signed-in user may change their own interface language
-- (profiles are otherwise Admin-only to edit).
-- =====================================================================

create or replace function public.set_my_locale(p_locale public.app_locale)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  update public.profiles set locale = p_locale where id = auth.uid();
end
$$;

revoke execute on function public.set_my_locale(public.app_locale) from public, anon;
grant execute on function public.set_my_locale(public.app_locale) to authenticated;
