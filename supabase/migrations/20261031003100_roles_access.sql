-- =====================================================================
-- What the new roles may do (owner, Oct 2026):
--  - bookkeeper: works like Sales, and records payments
--  - accountant: sees everything, changes nothing
--  - designer: sees clients, projects and orders, without prices; changes nothing
-- "Changes nothing" is held by the database: their transactions are
-- read only (app_session_start), so no write can pass, whatever the screen does.
-- =====================================================================

create or replace function public.app_session_start()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_app_role() in ('accountant', 'designer') then
    perform set_config('transaction_read_only', 'on', true);
  end if;
end
$$;
revoke execute on function public.app_session_start() from public, anon;
grant execute on function public.app_session_start() to authenticated;

-- The accountant has the reading rights of Admin and Sales, only inside a read-only transaction
create or replace function public.has_role(variadic roles public.app_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(r = any (roles)
           or (r = 'bookkeeper' and 'sales' = any (roles))
           or (r = 'accountant' and current_setting('transaction_read_only') = 'on'
               and ('admin' = any (roles) or 'sales' = any (roles))), false)
    from (select public.current_app_role() as r) x
$$;

create or replace function public.can_see_purchase_prices()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select p.role in ('admin', 'accountant')
        or (p.role in ('sales', 'bookkeeper') and p.can_see_purchase_prices)
    from public.profiles p
    where p.id = auth.uid() and p.is_active
  ), false)
$$;

-- Payments: the bookkeeper too
do $$
declare
  f record;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('add_invoice_payment', 'delete_invoice_payment', 'confirm_order_payment', 'confirm_final_payment', 'cancel_order_payment')
  loop
    execute replace(pg_get_functiondef(f.oid), $q$require_role('admin')$q$, $q$require_role('admin', 'bookkeeper')$q$);
  end loop;
end
$$;

-- Designer: clients, contacts, projects and the overviews of orders, which hold no prices
create policy clients_designer_read on public.clients for select to authenticated using (public.has_role('designer'));
create policy contacts_designer_read on public.contacts for select to authenticated using (public.has_role('designer'));
create policy projects_designer_read on public.projects for select to authenticated using (public.has_role('designer'));

do $$
declare
  v text;
begin
  foreach v in array array['sales_order_overview', 'sales_order_line_overview'] loop
    execute format('create or replace view public.%I as %s', v,
      replace(pg_get_viewdef(format('public.%I', v)::regclass),
              $q$ARRAY['admin'::app_role, 'sales'::app_role]$q$,
              $q$ARRAY['admin'::app_role, 'sales'::app_role, 'designer'::app_role]$q$));
  end loop;
end
$$;
