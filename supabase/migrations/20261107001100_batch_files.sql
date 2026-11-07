-- =====================================================================
-- Photos and files of batches (owner, Nov 2026): the finished product,
-- the labels, the packed pallets, protocols. Kept on the batch (the
-- manufacturing order), in the private bucket "batch-files"
-- ({mo_id}/{uuid}.{ext}). The partner adds them from the production
-- screen, the team from the batch page; Admin and Sales choose which the
-- client sees in the customer panel (like a shared COA).
--
--                       admin  sales  production (released batches)  client (portal)
-- see                   yes    yes    yes                             shared ones of its orders
-- add                   yes    yes    yes                             —
-- delete                any    own    own                             —
-- share with client     yes    yes    —                               —
-- =====================================================================

create table public.batch_files (
  id                  uuid primary key default gen_random_uuid(),
  mo_id               uuid not null references public.manufacturing_orders (id) on delete cascade,
  storage_path        text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif|pdf)$'),
  name                text not null check (btrim(name) <> '' and length(name) <= 200),
  mime                text,
  size                bigint not null check (size > 0 and size <= 26214400),
  note                text check (length(note) <= 500),
  shared_with_client  boolean not null default false,
  uploaded_by         uuid not null default auth.uid() references public.profiles (id),
  created_at          timestamptz not null default now()
);
create index batch_files_mo_idx on public.batch_files (mo_id, created_at);
select public.enable_audit('public.batch_files');

create or replace function public.batch_files_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.uploaded_by := auth.uid();
  new.created_at := now();
  new.shared_with_client := false;
  if split_part(new.storage_path, '/', 1) <> new.mo_id::text then
    raise exception 'Invalid file path';
  end if;
  return new;
end
$$;
create trigger batch_files_guard before insert on public.batch_files
  for each row execute function public.batch_files_guard();
revoke execute on function public.batch_files_guard() from public, anon, authenticated;

alter table public.batch_files enable row level security;
create policy batch_files_select on public.batch_files for select to authenticated
  using (public.has_role('admin', 'sales') or (public.has_role('production') and public.mo_is_released(mo_id)));
create policy batch_files_insert on public.batch_files for insert to authenticated
  with check (public.has_role('admin', 'sales') or (public.has_role('production') and public.mo_is_released(mo_id)));
create policy batch_files_delete on public.batch_files for delete to authenticated
  using (public.has_role('admin') or (uploaded_by = auth.uid() and (public.has_role('sales') or (public.has_role('production') and public.mo_is_released(mo_id)))));
revoke all on public.batch_files from anon, authenticated;
grant select, insert, delete on public.batch_files to authenticated;

/** Admin and Sales: the client sees this file in the customer panel (or no longer). */
create or replace function public.share_batch_file(p_id uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'sales');
  update public.batch_files set shared_with_client = coalesce(p_on, false) where id = p_id;
  if not found then
    raise exception 'File not found';
  end if;
end
$$;

/** Customer panel: the shared files of the batches of one of the client's orders. */
create or replace function public.portal_batch_files(p_order uuid)
returns table (id uuid, name text, mime text, created_at timestamptz, batch text)
language sql stable security definer set search_path = public
as $$
  select f.id, f.name, f.mime, f.created_at, coalesce(m.batch_number, m.code)
    from public.batch_files f
    join public.manufacturing_orders m on m.id = f.mo_id
    join public.sales_order_lines l on l.id = m.sales_order_line_id
    join public.sales_orders so on so.id = l.order_id
   where so.id = p_order and so.client_id = public.portal_client() and so.status <> 'draft' and f.shared_with_client
   order by f.created_at
$$;

/** Customer panel: where one shared file is kept, if it is the client's. */
create or replace function public.portal_batch_file(p_id uuid)
returns table (storage_path text, name text, mime text)
language sql stable security definer set search_path = public
as $$
  select f.storage_path, f.name, f.mime
    from public.batch_files f
    join public.manufacturing_orders m on m.id = f.mo_id
    join public.sales_order_lines l on l.id = m.sales_order_line_id
    join public.sales_orders so on so.id = l.order_id
   where f.id = p_id and f.shared_with_client and so.client_id = public.portal_client()
$$;

revoke execute on function public.share_batch_file(uuid, boolean), public.portal_batch_files(uuid), public.portal_batch_file(uuid) from public, anon;
grant execute on function public.share_batch_file(uuid, boolean), public.portal_batch_files(uuid), public.portal_batch_file(uuid) to authenticated;
