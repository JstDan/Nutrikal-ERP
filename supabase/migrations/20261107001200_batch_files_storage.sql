-- Photos and files of batches in Supabase Storage: private bucket "batch-files", 25 MB a file.
-- The app reads and writes them after batch_files (row-level security) has decided.
-- (Skipped by the local database: storage needs Supabase.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('batch-files', 'batch-files', false, 26214400, null)
on conflict (id) do nothing;
