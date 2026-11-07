-- =====================================================================
-- Phone and desktop notifications (owner, Nov 2026): the installed app
-- (or the browser) subscribes on a device; every new notification of the
-- user is then also pushed there by the job that runs every minute.
-- A user sees and removes only their own subscriptions.
-- =====================================================================

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh      text not null check (length(p256dh) between 80 and 100),
  auth        text not null check (length(auth) between 16 and 30),
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;

alter table public.notifications add column pushed_at timestamptz;

/** This device gets the signed-in user's notifications (a device moves to whoever subscribes last). */
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_agent text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_agent, 300))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
                                       user_agent = excluded.user_agent, created_at = now();
end
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

/** The job: notifications of the last two hours not pushed yet, with the devices of their users. */
create or replace function public.push_jobs()
returns table (notification_id bigint, kind text, params jsonb, link text, locale text, subscription_id uuid, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = public
as $$
  select n.id, n.kind, n.params, n.link, coalesce(p.locale::text, 'bg'), s.id, s.endpoint, s.p256dh, s.auth
    from public.notifications n
    join public.profiles p on p.id = n.user_id and p.is_active
    join public.push_subscriptions s on s.user_id = n.user_id
   where n.pushed_at is null and n.read_at is null and n.created_at > now() - interval '2 hours'
   order by n.id
   limit 200
$$;

/** The job: these were pushed (or tried); these devices are gone and are forgotten. */
create or replace function public.push_done(p_notifications bigint[], p_gone uuid[], p_ok uuid[])
returns void
language sql security definer set search_path = public
as $$
  update public.notifications set pushed_at = now() where id = any (p_notifications);
  delete from public.push_subscriptions where id = any (p_gone);
  update public.push_subscriptions set last_ok_at = now() where id = any (p_ok);
$$;

-- Older notifications are never pushed when the feature starts
update public.notifications set pushed_at = coalesce(read_at, created_at) where pushed_at is null;

revoke execute on function public.save_push_subscription(text, text, text, text), public.delete_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text), public.delete_push_subscription(text) to authenticated;
revoke execute on function public.push_jobs(), public.push_done(bigint[], uuid[], uuid[]) from public, anon, authenticated;
