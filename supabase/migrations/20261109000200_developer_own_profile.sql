-- =====================================================================
-- Developer: an own profile with Admin rights, and mentionable in the chat (owner, Nov 2026)
-- The developer picks their own profile in the Acting as list (the first choice, also after
-- signing in) and then works under their own name, photo and notifications with Admin rights.
-- Acting as someone else is unchanged: every query then runs as that person.
-- current_app_role() returns 'admin' for a developer, so has_role() and every rule built on it
-- give the developer what Admin has. is_developer(), impersonation_targets() and
-- start_impersonation() read profiles.role directly and are unchanged.
-- chat_people() now lists the developer, so the team can mention them and write to them.
-- =====================================================================

create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select case when role::text = 'developer' then 'admin'::public.app_role else role end
    from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.can_see_purchase_prices()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select p.role::text in ('admin', 'accountant', 'developer')
        or (p.role in ('sales', 'bookkeeper') and p.can_see_purchase_prices)
    from public.profiles p
    where p.id = auth.uid() and p.is_active
  ), false)
$$;

create or replace function public.chat_people(p_channel uuid default null)
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name from public.profiles p
   where p.is_active and p.role <> 'client' and p.id <> auth.uid()
     and public.current_app_role() is not null and public.current_app_role() <> 'client'
     and (public.current_app_role() <> 'production' or p_channel is not null)
     and (p.role <> 'production' or (select kind from public.chat_channels where id = p_channel) = 'external')
     and (p_channel is null or public.chat_can(p_channel))
     and ((select kind from public.chat_channels where id = p_channel) is distinct from 'direct'
          or exists (select 1 from public.chat_channel_members m where m.channel_id = p_channel and m.user_id = p.id))
   order by lower(p.full_name)
$$;
