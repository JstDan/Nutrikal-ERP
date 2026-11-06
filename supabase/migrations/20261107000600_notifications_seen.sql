-- Owner, Nov 2026: a notification goes away once the thing it points to is seen
-- (the chat channel, the board card, the order, the task), not only when it is
-- opened from the bell. The page or panel tells the database what was seen.

/** Marks one's own unread notifications that point to this address as read; returns how many. */
create or replace function public.mark_notifications_seen(p_link text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_n integer;
begin
  if nullif(p_link, '') is null then
    return 0;
  end if;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null
     and (link = p_link or link like replace(replace(p_link, '%', '\%'), '_', '\_') || '&%');
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke execute on function public.mark_notifications_seen(text) from public, anon;
grant execute on function public.mark_notifications_seen(text) to authenticated;
