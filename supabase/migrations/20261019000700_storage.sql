-- =====================================================================
-- Nutrikal ERP + CRM — Phase 1 — 0007 file storage (Supabase Storage)
-- client-files   : NDAs, briefs, artwork, specs   (admin, sales)
-- lot-documents  : COAs and receipt paperwork     (staff; partner read + upload)
-- Both buckets are private; files are served through signed URLs.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('client-files', 'client-files', false),
       ('lot-documents', 'lot-documents', false)
on conflict (id) do nothing;

create policy client_files_bucket_rw on storage.objects for all to authenticated
  using (bucket_id = 'client-files' and public.has_role('admin', 'sales'))
  with check (bucket_id = 'client-files' and public.has_role('admin', 'sales'));

create policy lot_documents_bucket_read on storage.objects for select to authenticated
  using (bucket_id = 'lot-documents' and public.current_app_role() is not null);

create policy lot_documents_bucket_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'lot-documents' and public.current_app_role() in ('admin', 'inventory', 'partner'));

create policy lot_documents_bucket_delete on storage.objects for delete to authenticated
  using (bucket_id = 'lot-documents' and public.has_role('admin'));
