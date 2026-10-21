-- =====================================================================
-- Nutrikal ERP + CRM — views are read only
-- The default privileges gave users every right on every view. Some views
-- run with the owner's rights (production_projects, sales_order_overview,
-- …), and production_projects is a plain one-table view, so Postgres
-- passed writes through it to projects past row-level security (e.g.
-- Production could change a project's status through the Supabase API).
-- All changes go through tables and functions, so users only read views.
-- A new view needs the same revoke (the "no view can be written" test checks it).
-- =====================================================================

do $$
declare
  v record;
begin
  for v in select viewname from pg_views where schemaname = 'public' loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', v.viewname);
  end loop;
end
$$;
