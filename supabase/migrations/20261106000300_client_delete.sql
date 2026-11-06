-- =====================================================================
-- Nutrikal ERP + CRM — deleting a client (owner, Nov 2026)
-- Admin deletes any client; Sales (and the bookkeeper, who works like
-- Sales) only the clients they are responsible for (clients.owner_id).
-- A client with offers, orders, recipes, projects, own items or invoices
-- is never deleted: those records are deleted or moved first, so no
-- document disappears. With the client go its contacts, CRM notes, files,
-- portal access and messages, and the mail saved from Gmail for it
-- (client_emails; the mail stays in Gmail). Catalogue enquiries stay and
-- are unlinked. Every delete is in audit_log (clients are audited).
--
--                      admin   sales / bookkeeper      production, designer, accountant, client
-- delete_client         any     own (owner_id = me)     no
-- =====================================================================

create or replace function public.delete_client(p_id uuid)
returns text[]                     -- Storage paths of the client's files, for the app to remove
language plpgsql security definer set search_path = public
as $$
declare
  v_owner uuid;
  v_found boolean;
  v_used  text;
  v_files text[];
begin
  select owner_id, true into v_owner, v_found from public.clients where id = p_id;
  if v_found is null then
    raise exception 'Client not found';
  end if;
  if not (public.has_role('admin') or (public.has_role('sales') and v_owner = auth.uid())) then
    raise exception 'Only Admin, or the salesperson responsible for the client, can delete it' using errcode = '42501';
  end if;

  select string_agg(format('%s %s', n, what), ', ') into v_used from (
    select (select count(*) from public.calc_offers   where client_id = p_id) as n, 'offer(s)' as what union all
    select (select count(*) from public.offers        where client_id = p_id), 'older offer(s)' union all
    select (select count(*) from public.sales_orders  where client_id = p_id), 'order(s)' union all
    select (select count(*) from public.formulas      where client_id = p_id), 'recipe(s)' union all
    select (select count(*) from public.projects      where client_id = p_id), 'project(s)' union all
    select (select count(*) from public.items         where client_id = p_id), 'item(s)' union all
    select (select count(*) from public.invoices      where client_id = p_id), 'invoice(s)'
  ) x where n > 0;
  if v_used is not null then
    raise exception 'The client still has %; delete or move them first', v_used;
  end if;

  select coalesce(array_agg(storage_path), '{}') into v_files from public.client_files where client_id = p_id;
  update public.catalog_enquiries set client_id = null where client_id = p_id;
  delete from public.clients where id = p_id;
  return v_files;
end
$$;

revoke execute on function public.delete_client(uuid) from public, anon;
grant execute on function public.delete_client(uuid) to authenticated;
