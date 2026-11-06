-- =====================================================================
-- Profile photos (owner, Nov 2026): every account may have a photo,
-- shown in the chat, on boards, tasks and wherever people are named.
-- Each user sets their own; Admin sets anyone's. The file is a small
-- square picture in the private bucket "avatars" ({user_id}/{uuid}.webp),
-- served by /api/avatar/{user_id}; without a photo the initials show.
-- Who sees a photo: any account of the team (Production too, who sees
-- the names in its chat channels); a client account only its own.
-- =====================================================================

alter table public.profiles
  add column avatar_path text check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$'),
  add column avatar_updated_at timestamptz;

/** Name and photo of a person, when the signed-in account may see them. */
create or replace function public.avatar_of(p_user uuid)
returns table (full_name text, avatar_path text, avatar_updated_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select p.full_name, p.avatar_path, p.avatar_updated_at
    from public.profiles p
   where p.id = p_user
     and (p_user = auth.uid() or coalesce(public.current_app_role() <> 'client', false))
$$;
revoke execute on function public.avatar_of(uuid) from public, anon;
grant execute on function public.avatar_of(uuid) to authenticated;

/** Sets (or clears, p_path null) a photo: one's own, or anyone's by Admin. Returns the old file to remove. */
create or replace function public.set_avatar(p_user uuid, p_path text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_old text;
begin
  if auth.uid() is null or (p_user is distinct from auth.uid() and not public.has_role('admin')) then
    raise exception 'Only Admin changes the photo of another account' using errcode = '42501';
  end if;
  if p_path is not null and split_part(p_path, '/', 1) <> p_user::text then
    raise exception 'Invalid file path';
  end if;
  select avatar_path into v_old from public.profiles where id = p_user for update;
  if not found then
    raise exception 'User not found';
  end if;
  update public.profiles set avatar_path = p_path, avatar_updated_at = now() where id = p_user;
  return v_old;
end
$$;
revoke execute on function public.set_avatar(uuid, text) from public, anon;
grant execute on function public.set_avatar(uuid, text) to authenticated;
