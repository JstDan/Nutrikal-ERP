-- =====================================================================
-- Nutrikal ERP + CRM — delivery documents in Supabase Storage
-- delivery-docs : waybill photos, COAs of deliveries (private bucket,
--                 path {delivery_id}/{uuid}.{ext}, served by signed URL)
-- Admin reads everything. Production uploads and reads files of
-- deliveries to its locations and deletes only its own files within
-- 24 hours. The lot-documents upload rule loses the Inventory role.
-- (Skipped by the local database: storage needs Supabase itself.)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-docs', 'delivery-docs', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

-- First path segment = the delivery
create or replace function public.delivery_of_path(p_name text)
returns uuid
language sql immutable set search_path = public
as $$
  select case when split_part(p_name, '/', 1) ~* '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end
$$;

create policy delivery_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'delivery-docs' and public.can_access_delivery(public.delivery_of_path(name)));

create policy delivery_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'delivery-docs' and public.can_access_delivery(public.delivery_of_path(name)));

create policy delivery_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'delivery-docs' and public.has_role('production')
         and owner_id = auth.uid()::text and created_at > now() - interval '24 hours');

drop policy lot_documents_bucket_insert on storage.objects;
create policy lot_documents_bucket_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'lot-documents' and public.current_app_role() in ('admin', 'production'));
