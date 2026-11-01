-- Certificates of lots: staff and Production read the bucket; a client gets a shared certificate only through the app
drop policy lot_documents_bucket_read on storage.objects;
create policy lot_documents_bucket_read on storage.objects for select to authenticated
  using (bucket_id = 'lot-documents' and public.current_app_role() <> 'client');
