-- =====================================================================
-- Nutrikal ERP + CRM — Order Task Manager: files in Supabase Storage and
-- live chat (Supabase Realtime).
-- order-task-files : files of tasks (private bucket, max 25 MB a file,
--                    path {order_id}/{task_id}/{uuid}-{name}, served by
--                    signed URL). Admin and sales read and add the files
--                    of task boards; deleting goes through the app after
--                    delete_order_task_file (own files; admin any).
--                    Production: no access.
-- Realtime          : new and changed messages of a task reach the other
--                    users viewing it (row-level security applies).
-- (Skipped by the local database: storage and realtime need Supabase.)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-task-files', 'order-task-files', false, 26214400, null)
on conflict (id) do nothing;

create policy order_task_files_read on storage.objects for select to authenticated
  using (bucket_id = 'order-task-files' and public.can_access_order_task_path(name));

create policy order_task_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'order-task-files' and public.can_access_order_task_path(name)
              and public.order_task_file_allowed(name));

create policy order_task_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'order-task-files' and public.can_access_order_task_path(name)
         and (owner_id = auth.uid()::text or public.has_role('admin')));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.order_task_comments;
  end if;
end
$$;
