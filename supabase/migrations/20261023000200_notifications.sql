-- =====================================================================
-- Nutrikal ERP + CRM — notifications and production settings
-- * notifications: one row per recipient. The text is not stored: the
--   app renders `kind` + `params` in the reader's language. Admin
--   notifications are also e-mailed by the Edge Function notify-admins
--   (Supabase database webhook on insert; see README).
-- * Each user reads and marks only their own notifications. Rows are
--   written only by the functions of the app (notify_role).
-- * company_settings gains the usage tolerance for production reports
--   and the waybill-photo rule for receiving deliveries.
-- =====================================================================

create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in (
                'stock_corrected', 'delivery_received', 'mo_completed', 'mo_sent', 'delivery_ordered')),
  params      jsonb not null default '{}',
  link        text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  emailed_at  timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
-- No insert/update/delete policies: written by notify_role, read flag by mark_notifications_read.

-- Internal: one notification for every active user of a role
create or replace function public.notify_role(p_role public.app_role, p_kind text, p_params jsonb, p_link text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_n integer;
begin
  insert into public.notifications (user_id, kind, params, link)
  select p.id, p_kind, coalesce(p_params, '{}'), p_link
    from public.profiles p
   where p.role = p_role and p.is_active;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- Mark the caller's notifications read (all of them when p_ids is null)
create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_n integer;
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke execute on function public.notify_role(public.app_role, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.mark_notifications_read(bigint[]) from public, anon;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
alter table public.company_settings
  add column production_variance_pct numeric(5, 2) not null default 5
    check (production_variance_pct >= 0 and production_variance_pct <= 100),
  add column require_waybill_photo boolean not null default true;
